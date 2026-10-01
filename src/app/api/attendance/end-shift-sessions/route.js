import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import { Shift } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getTzTime } from '@/lib/timezone';
import { getShiftEndMinutes } from '@/lib/shift-utils';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getShiftConfig, calculateHoursWorked } from '@/lib/attendance-constants';
import { calculateBreakDeduction } from '@/lib/attendance-breaks';
import { finalizeDayWork } from '@/lib/attendance-utils';
import { closePermissionEarly } from '@/lib/permission-work';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const body = await req.json();
    if (!body.shiftId) return fail('shiftId is required', 400);

    const shiftDoc = await Shift.findById(body.shiftId).lean();
    if (!shiftDoc) return fail('Shift not found', 404);

    const now = await getTzTime();
    const globalConfig = await getGlobalConfig();
    const shiftCfg = getShiftConfig(shiftDoc, globalConfig);
    const endMins = getShiftEndMinutes(shiftDoc, shiftCfg);

    const users = await User.find({
      $or: [{ shiftId: shiftDoc._id }, { shift: shiftDoc.name }],
      status: 'active',
      role: { $ne: 'super_admin' },
    }).select('_id').lean();
    const userIds = users.map(u => u._id);
    if (userIds.length === 0) return ok({ message: 'No employees are assigned to this shift.', count: 0, records: [] });

    // Admin force: close even regularizationOutOpen sessions (criteria 5,6 — no permanent suppression)
    const records = await Attendance.find({
      userId: { $in: userIds },
      clockIn: { $ne: null },
      clockOut: null,
    }).lean();

    let count = 0;
    const ended = [];
    for (const record of records) {
      const [ih, im] = record.clockIn.split(':').map(Number);
      const clockInMins = ih * 60 + im;
      const recordDateMs = new Date(record.date + 'T00:00:00').getTime();

      // Clock out at the earlier of: the shift end (minutes since record-date
      // midnight) or "now". Never later than now; never earlier than clock-in.
      const elapsedNowMins = Math.max(clockInMins, Math.floor((now.getTime() - recordDateMs) / 60000));
      const finalMins = Math.min(endMins, elapsedNowMins);
      const foh = Math.floor(finalMins / 60) % 24;
      const fom = finalMins % 60;
      const clockOutTime = String(foh).padStart(2, '0') + ':' + String(fom).padStart(2, '0');

      const finalMinutes = Math.max(0, finalMins - clockInMins);
      const updatedBreaks = (record.breaks || []).map(b =>
        b.start && !b.end ? { ...b, end: clockOutTime } : b
      );
      // Recompute from actual break records — never trust stored deduction.
      const deduction = calculateBreakDeduction(updatedBreaks, shiftCfg.breaks);
      const { baseHours, hoursWorked, payableHours, shortHours: rawShortHours } = calculateHoursWorked(finalMinutes, deduction, shiftCfg);
      const hasPermission = !!(record.permission?.requestId || record.permission?.startTime);
      const shortHours = hasPermission ? false : rawShortHours;

      // Permission auto-end on forced session close: an open permission is
      // closed at the close time and flagged late when past its window.
      let permEndedLate = false;
      if (record.permission?.requestId && !record.permission?.endedAt) {
        try {
          const endRes = closePermissionEarly(record, clockOutTime, 'auto_logout');
          if (!endRes.error) permEndedLate = !!endRes.endedLate;
        } catch (e) { console.error('Permission end-shift end failed:', e?.message || e); }
      }
      // A worked half of an approved half-day leave finalises as Present
      // (never late on the leave-adjusted day); the marker drives the 0.5
      // credit and the Half Day display.
      const status = record.approvedHalfDayLeave ? 'present' : (record.lateFlag || permEndedLate ? 'late' : 'present');
      const lateFlag = record.approvedHalfDayLeave ? false : !!(record.lateFlag || permEndedLate);

      const finalized = finalizeDayWork(record.workProgress, clockOutTime, record.date);

      const result = await Attendance.findOneAndUpdate(
        { _id: record._id, clockOut: null },
        {
          $set: {
            clockOut: clockOutTime,
            autoLoggedOut: true,
            regularizationOutOpen: false,
            status,
            lateFlag,
            hoursWorked,
            payableHours,
            shortHours,
            baseHoursWorked: baseHours,
            breakDeduction: deduction,
            breaks: updatedBreaks,
            workProgress: finalized,
            permission: record.permission,
          },
        },
        { new: true }
      );
      if (result) {
        count++;
        ended.push({ userId: record.userId, date: record.date, clockIn: record.clockIn, clockOut: clockOutTime });
      }
    }

    const ip = req.headers.get('x-forwarded-for') || '';
    await auditLog('End Shift Sessions', 'Attendance', user._id, `Ended ${count} session(s) for shift "${shiftDoc.name}"`, 'medium', ip, null, user._id);

    return ok({ message: `Ended ${count} session(s) for "${shiftDoc.name}".`, count, records: ended });
  } catch (e) {
    return fail(e.message, 500);
  }
}
