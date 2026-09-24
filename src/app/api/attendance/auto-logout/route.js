import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Shift } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getTzTime } from '@/lib/timezone';
import { getShiftConfig, calculateHoursWorked } from '@/lib/attendance-constants';
import { calculateBreakDeduction } from '@/lib/attendance-breaks';
import { finalizeDayWork } from '@/lib/attendance-utils';
import { getShiftEndMinutes, resolveShift, resolveShiftForDate } from '@/lib/shift-utils';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { publishAttendance } from '@/lib/sse';

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// getTodayStr is removed as we get the timezone-aware date string directly in POST

export async function POST(req) {
  try {
    // Auth: support either super_admin JWT or CRON_SECRET header
    const cronSecret = req.headers.get('x-cron-secret');
    const envCronSecret = process.env.CRON_SECRET;

    if (cronSecret !== envCronSecret) {
      const { user, error } = await requireAuth(req);
      if (error) return error;
      if (user.role !== 'super_admin') {
        return fail('Access denied. super_admin role or valid CRON_SECRET required.', 403);
      }
    }

    await connectDB();

    const now = await getTzTime();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const globalConfig = await getGlobalConfig();
    const autoLoggedOut = [];

    // Criteria 5,6,8: close ALL forgotten clock-outs after the configured grace
    // deadline (shift end + autoLogoutAfterShiftEnd). regularizationOutOpen only
    // defers until the deadline — it does not permanently suppress. Overnight
    // deadlines are shift-aware via getShiftEndMinutes (end +24h when crossing midnight).
    // We query all open records directly so past forgotten sessions are not missed
    // when the per-shift calendar gate would otherwise skip them.
    const openRecords = await Attendance.find({
      clockIn: { $ne: null },
      clockOut: null,
      autoLoggedOut: { $ne: true },
    }).lean();

    if (openRecords.length) {
      const openUserIds = [...new Set(openRecords.map(r => String(r.userId)))];
      const openUsers = await User.find({ _id: { $in: openUserIds } }).select('shift shiftId name').lean();
      const usersById = new Map(openUsers.map(u => [String(u._id), u]));

      for (const record of openRecords) {
        const [ih, im] = record.clockIn.split(':').map(Number);
        const clockInMins = ih * 60 + im;

        const recordUser = usersById.get(String(record.userId));
        // Use historical shift for past dates (criterion 2) so grace deadline matches that day's shift
        let userShift = null;
        try {
          userShift = await resolveShiftForDate(recordUser, record.date);
        } catch { userShift = null; }
        if (!userShift) {
          try { userShift = await resolveShift(recordUser); } catch { userShift = null; }
        }
        // Fallback to any shift if user has no resolvable shift (still allow past forgotten to close)
        if (!userShift) {
          const fallbackShift = await Shift.findOne({}).lean().catch(() => null);
          userShift = fallbackShift;
        }
        const recordShiftCfg = getShiftConfig(userShift, globalConfig);
        const endMins = getShiftEndMinutes(userShift, globalConfig);
        const deadlineMins = endMins + (recordShiftCfg.autoLogoutBuffer ?? 360);
        const recordDateMs = new Date(record.date + 'T00:00:00').getTime();
        const deadlineMs = recordDateMs + deadlineMins * 60 * 1000;
        if (now.getTime() < deadlineMs) continue;
        const elapsedNowMins = Math.max(clockInMins, Math.floor((now.getTime() - recordDateMs) / 60000));
        const finalClockOutMins = Math.min(deadlineMins, elapsedNowMins);
        const foh = Math.floor(finalClockOutMins / 60) % 24;
        const fom = finalClockOutMins % 60;
        const finalClockOut = String(foh).padStart(2, '0') + ':' + String(fom).padStart(2, '0');
        const finalMinutes = Math.max(0, finalClockOutMins - clockInMins);

        const updatedBreaks = (record.breaks || []).map(row => (
          row.start && !row.end ? { ...row, end: finalClockOut } : row
        ));
        // Recompute from actual break records — never trust stored deduction.
        const deduction = calculateBreakDeduction(updatedBreaks, recordShiftCfg.breaks);
        const { baseHours, hoursWorked, payableHours, shortHours: rawShortHours } = calculateHoursWorked(finalMinutes, deduction, recordShiftCfg);
        const hasPermission = !!(record.permission?.requestId || record.permission?.startTime);
        const shortHours = hasPermission ? false : rawShortHours;
        const status = record.approvedHalfDayLeave ? 'half_day' : (record.lateFlag ? 'late' : 'present');

        const finalized = finalizeDayWork(record.workProgress, finalClockOut, record.date);

        // Atomically claim AND finalize — single operation prevents race & crash-orphaning
        const result = await Attendance.findOneAndUpdate(
          { _id: record._id, clockOut: null, autoLoggedOut: { $ne: true } },
          {
            $set: {
              clockOut: finalClockOut,
              autoLoggedOut: true,
              breaks: updatedBreaks,
              workProgress: finalized,
              baseHoursWorked: baseHours,
              breakDeduction: deduction,
              hoursWorked,
              payableHours,
              shortHours,
              status,
            }
          },
          { new: true }
        );
        if (!result) continue; // Another cron instance already processed this record

        try {
          publishAttendance({
            type: 'clockout',
            userId: record.userId.toString(),
            name: usersById.get(record.userId.toString())?.name || null,
            date: record.date,
            clockIn: record.clockIn,
            clockOut: finalClockOut,
            hoursWorked,
            status,
            autoLoggedOut: true,
          });
        } catch (e) { /* non-fatal */ }

        autoLoggedOut.push({
          userId: record.userId,
          date: record.date,
          clockIn: record.clockIn,
          clockOut: finalClockOut,
        });
      }
    }

    try {
      const { markAbsentEmployees } = await import('@/lib/attendance-utils');
      await markAbsentEmployees(todayStr);
    } catch (e) { console.error('markAbsentEmployees failed:', e); }

    return ok({
      message: `Auto-logout completed. ${autoLoggedOut.length} employee(s) were auto-logged out.`,
      count: autoLoggedOut.length,
      records: autoLoggedOut,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
