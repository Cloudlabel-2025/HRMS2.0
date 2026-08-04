import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Shift, Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime } from '@/lib/timezone';
import { getShiftConfig, calculateHoursWorked } from '@/lib/attendance-constants';
import { getShiftEndMinutes, resolveShift } from '@/lib/shift-utils';
import { getGlobalConfig } from '@/lib/payroll-cycle';

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

    // Get all shifts
    const shifts = await Shift.find({}).lean();
    const globalConfig = await getGlobalConfig();
    const autoLoggedOut = [];

    for (const shift of shifts) {
      if (!shift.startTime || !shift.endTime) continue;

      const endMinutes = parseTimeToMinutes(shift.endTime);
      if (endMinutes === null) continue;

      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      // Check if 5 hours have passed since shift end
      // For overnight shifts (end < start), add 24h to end time
      const startMinutes = parseTimeToMinutes(shift.startTime);
      let effectiveEndMinutes = endMinutes;
      if (startMinutes !== null && endMinutes < startMinutes) {
        effectiveEndMinutes = endMinutes + 24 * 60;
      }

      const effectiveNowMinutes = nowMinutes < effectiveEndMinutes ? nowMinutes + 24 * 60 : nowMinutes;

      const shiftCfg = getShiftConfig(shift, globalConfig);
      if (effectiveNowMinutes < effectiveEndMinutes + shiftCfg.autoLogoutBuffer) continue;

      // Resolve attendance date for this shift at the current time
      let attendanceToday;
      try {
        attendanceToday = getAttendanceDate(now, shift.startTime, shift.endTime);
      } catch {
        attendanceToday = todayStr;
      }

      // Also check yesterday (in case of overnight shifts where attendance date might be yesterday)
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');

      const searchDates = [attendanceToday];
      if (attendanceToday !== yesterdayStr) {
        searchDates.push(yesterdayStr);
      }

      // Find users on this shift (by shiftId first, falling back to the shift
      // name so a stale user.shift string still matches) who haven't clocked out
      const users = await User.find({
        $or: [{ shift: shift.name }, { shiftId: shift._id }],
        status: 'active',
        role: { $ne: 'super_admin' },
      }).select('shift shiftId').lean();
      const userIds = users.map(u => u._id);
      const usersById = new Map(users.map(u => [u._id.toString(), u]));

      if (userIds.length === 0) continue;

      const records = await Attendance.find({
        userId: { $in: userIds },
        date: { $in: searchDates },
        clockIn: { $ne: null },
        clockOut: null,
        autoLoggedOut: { $ne: true },
      }).lean();

      for (const record of records) {
        const [ih, im] = record.clockIn.split(':').map(Number);
        const clockInMins = ih * 60 + im;

        // Resolve the record owner's ACTUAL shift so a stale user.shift name can
        // never trigger the wrong shift's deadline.
        const recordUser = usersById.get(record.userId.toString());
        const userShift = (await resolveShift(recordUser)) || shift;
        const recordShiftCfg = getShiftConfig(userShift, globalConfig);
        const endMins = getShiftEndMinutes(userShift, globalConfig);
        const deadlineMins = endMins + (recordShiftCfg.autoLogoutBuffer ?? 360);
        if (deadlineMins <= clockInMins) continue;

        const foh = Math.floor(deadlineMins / 60) % 24;
        const fom = deadlineMins % 60;
        const finalClockOut = String(foh).padStart(2, '0') + ':' + String(fom).padStart(2, '0');
        const finalMinutes = deadlineMins - clockInMins;

        const deduction = record.breakDeduction || 0;
        const { baseHours, hoursWorked } = calculateHoursWorked(finalMinutes, deduction, recordShiftCfg);
        let status = record.status;
        if (hoursWorked < recordShiftCfg.absentThreshold) {
          status = 'absent';
        } else {
          status = 'present';
        }

        const updatedBreaks = (record.breaks || []).map(row => (
          row.start && !row.end ? { ...row, end: finalClockOut } : row
        ));
        const updatedWorkProgress = (record.workProgress || []).map(row => (
          row.startTime && !row.endTime
            ? { ...row, endTime: finalClockOut, status: row.status === 'work_in_progress' ? 'stopped' : row.status }
            : row
        ));

        // Atomically claim AND finalize — single operation prevents race & crash-orphaning
        const result = await Attendance.findOneAndUpdate(
          { _id: record._id, clockOut: null, autoLoggedOut: { $ne: true } },
          {
            $set: {
              clockOut: finalClockOut,
              autoLoggedOut: true,
              breaks: updatedBreaks,
              workProgress: updatedWorkProgress,
              baseHoursWorked: record.baseHoursWorked ?? baseHours,
              breakDeduction: deduction,
              hoursWorked,
              status,
            }
          },
          { new: true }
        );
        if (!result) continue; // Another cron instance already processed this record

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
