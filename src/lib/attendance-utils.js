import { calculateHoursWorked, computeWorkRowDuration, getShiftConfig } from './attendance-constants';
import { calculateBreakDeduction } from './attendance-breaks';
import { getShiftEndMinutes, resolveShift } from './shift-utils';
import { isWorkingDay, getGlobalConfig, parseShiftStartTime } from './payroll-cycle';
import { getAttendanceDate } from './attendance-date';
import { Holiday, Employee } from './models/index';
import User from './models/User';
import Attendance from './models/Attendance';
import { Leave } from './models/index';
import { notify } from './notify';
import { connectDB } from './db';
import { getTzTime } from '@/lib/timezone';

export { toMinutes, diffMins } from './attendance-constants';

export function finalizeDayWork(rows, finalClockOut, dateStr) {
  return (rows || []).map(row => {
    const base = row.toObject ? row.toObject() : row;
    if (base.type === 'task' && ['pending', 'work_in_progress', 'stopped'].includes(base.status)) {
      if (base.endTime) {
        const next = {
          ...base,
          status: 'completed',
          carriedForward: false,
          completedAt: base.completedAt || base.endTime,
          completedDate: base.completedDate || dateStr || '',
          tries: base.tries ?? 1,
        };
        return { ...next, duration: computeWorkRowDuration(next) };
      }
      const next = { ...base, endTime: base.endTime || finalClockOut, status: 'pending', carriedForward: true };
      return { ...next, duration: computeWorkRowDuration(next) };
    }
    if (base.startTime && !base.endTime) {
      const next = { ...base, endTime: finalClockOut, status: base.status === 'work_in_progress' ? 'stopped' : base.status };
      return { ...next, duration: computeWorkRowDuration(next) };
    }
    return { ...base, duration: computeWorkRowDuration(base) };
  });
}

export async function checkAndApplyAutoLogout(record, now, cfg, shiftDoc, isEmployerUser = false, options = {}) {
  const { force = false } = options;
  if (isEmployerUser) return false;
  if (!now) now = await getTzTime();
  if (!record.clockIn || record.clockOut) return false;

  const shiftCfg = cfg || { expectedHours: 480, absentThreshold: 240, breaks: [{ type: 'break', maxDuration: 30 }, { type: 'lunch', maxDuration: 60 }] };

  const [ih, im] = record.clockIn.split(':').map(Number);
  const clockInMinutes = ih * 60 + im;
  const recordDateMs = new Date(record.date + 'T00:00:00').getTime();

  const endMins = getShiftEndMinutes(shiftDoc, shiftCfg);
  const deadlineMins = endMins + (shiftCfg.autoLogoutBuffer ?? 360);
  if (deadlineMins <= 0) return false;

  const deadlineMs = recordDateMs + deadlineMins * 60 * 1000;
  // regularizationOutOpen defers auto-logout only until the grace deadline
  // (shift end + autoLogoutAfterShiftEnd). After deadline it no longer suppresses (criteria 5/6).
  // Current-day "not yet" remains open within the grace window (criterion 7) and overnight
  // deadlines use shift-aware end via getShiftEndMinutes (criterion 8).
  if (!force && now.getTime() < deadlineMs) return false;

  const elapsedNowMins = Math.floor((now.getTime() - recordDateMs) / 60000);
  const clockOutMinutes = force
    ? Math.min(deadlineMins, Math.max(clockInMinutes, elapsedNowMins))
    : deadlineMins;
  const oh = Math.floor(clockOutMinutes / 60) % 24;
  const om = clockOutMinutes % 60;
  const clockOutTime = String(oh).padStart(2, '0') + ':' + String(om).padStart(2, '0');

  record.clockOut = clockOutTime;
  record.autoLoggedOut = true;
  record.regularizationOutOpen = false;

  if (record.breaks) {
    record.breaks = record.breaks.map(b => {
      if (b.start && !b.end) {
        return { type: b.type, start: b.start, end: clockOutTime };
      }
      return b;
    });
  }

  if (record.workProgress) {
    record.workProgress = finalizeDayWork(record.workProgress, clockOutTime, record.date);
  }

  const elapsedMins = Math.max(0, clockOutMinutes - clockInMinutes);
  const deduction = calculateBreakDeduction(record.breaks, shiftCfg.breaks);
  const { baseHours, hoursWorked, payableHours, shortHours: rawShortHours } = calculateHoursWorked(elapsedMins, deduction, shiftCfg);
  record.baseHoursWorked = baseHours;
  record.breakDeduction = deduction;
  record.hoursWorked = hoursWorked;
  record.payableHours = payableHours;
  // Permission day: suppress shortHours — highlight hours only, no impact.
  const hasPermission = !!(record.permission?.requestId || record.permission?.startTime);
  record.shortHours = hasPermission ? false : rawShortHours;
  if (record.approvedHalfDayLeave) {
    record.status = 'half_day';
    record.lateFlag = false;
  } else if (!['leave', 'holiday'].includes(record.status)) {
    record.status = record.lateFlag ? 'late' : 'present';
  }

  return true;
}

export async function markAbsentEmployees(dateStr, options = {}) {
  await connectDB();

  const config = await getGlobalConfig();
  const holidays = await Holiday.find({ date: dateStr }).lean();

  if (!isWorkingDay(dateStr, config, holidays)) return 0;

  const now = options.now || await getTzTime();
  const calToday = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  // Future dates are never absent — the absence view shows them as blank and
  // payroll excludes them from LOP (mid-cycle preview).
  if (dateStr > calToday) return 0;

  const employees = await Employee.find({ status: 'active' })
    .populate('userId', 'name teamLeadId teamAdminId role shift shiftId')
    .lean();

  const activeEmployees = employees.filter(e => e.userId?.role && e.userId.role !== 'super_admin');

  if (activeEmployees.length === 0) return 0;

  const userIds = activeEmployees.map(e => e.userId?._id).filter(Boolean);

  const existingRecords = await Attendance.find({ userId: { $in: userIds }, date: dateStr }).select('userId').lean();
  const attendedIds = new Set(existingRecords.map(r => r.userId.toString()));

  const onLeave = await Leave.find({
    userId: { $in: userIds },
    status: 'approved',
    from: { $lte: dateStr },
    to: { $gte: dateStr },
  }).select('userId').lean();
  const onLeaveIds = new Set(onLeave.map(l => l.userId.toString()));

  // Batch-load shifts once (no N+1 resolveShift per employee where possible).
  const { Shift } = await import('./models/index');
  const allShifts = await Shift.find({}).lean().catch(() => []);
  const shiftById = new Map((allShifts || []).map(s => [String(s._id), s]));
  const shiftByName = new Map((allShifts || []).map(s => [s.name, s]));

  let count = 0;

  for (const emp of activeEmployees) {
    const uid = emp.userId?._id?.toString();
    if (!uid) continue;
    if (attendedIds.has(uid)) continue;
    if (onLeaveIds.has(uid)) continue;

    // Threshold gate: a missing clock-in becomes 'absent' ONLY after the
    // employee's halfDayThreshold has elapsed on their shift-aware today.
    // Before that the absence view derives 'not_arrived' with no DB row.
    try {
      let shiftDoc = null;
      const sid = emp.userId?.shiftId ? String(emp.userId.shiftId) : (emp.shiftId ? String(emp.shiftId) : null);
      if (sid && shiftById.has(sid)) shiftDoc = shiftById.get(sid);
      else {
        const sname = emp.shift || emp.userId?.shift;
        if (sname && shiftByName.has(sname)) shiftDoc = shiftByName.get(sname);
        else if (sid || sname) shiftDoc = await resolveShift({ shiftId: emp.userId?.shiftId || emp.shiftId, shift: emp.shift || emp.userId?.shift }).catch(() => null);
      }
      const cfg = getShiftConfig(shiftDoc, config);
      const userToday = getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
      if (dateStr === userToday) {
        let shiftStartMins = null;
        if (shiftDoc?.startTime) {
          const [sh, sm] = String(shiftDoc.startTime).split(':').map(Number);
          if (!Number.isNaN(sh) && !Number.isNaN(sm)) shiftStartMins = sh * 60 + sm;
        }
        if (shiftStartMins === null) {
          const parsed = parseShiftStartTime(emp.shift || emp.userId?.shift);
          if (parsed) {
            const [sh, sm] = parsed.split(':').map(Number);
            shiftStartMins = sh * 60 + sm;
          } else {
            shiftStartMins = 9 * 60;
          }
        }
        let elapsed = now.getHours() * 60 + now.getMinutes() - shiftStartMins;
        if (elapsed < -720) elapsed += 1440;
        if (elapsed > 720) elapsed -= 1440;
        if (elapsed < (cfg.halfDayThreshold ?? 180)) continue; // not arrived yet — no DB write
      }
    } catch { /* on any shift-resolution failure, fall through and mark absent for past dates */ }

    await Attendance.findOneAndUpdate(
      { userId: uid, date: dateStr },
      { $set: { userId: uid, date: dateStr, status: 'absent' } },
      { upsert: true, new: true }
    );

    const recipients = [];
    if (emp.userId?.teamLeadId) recipients.push(emp.userId.teamLeadId);
    if (emp.userId?.teamAdminId) recipients.push(emp.userId.teamAdminId);

    const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
    recipients.push(...admins.map(a => a._id));

    const uniqueRecipients = [...new Set(recipients.map(String))];
    if (uniqueRecipients.length > 0) {
      await notify(
        uniqueRecipients,
        'Absence Alert',
        `${emp.name || 'Employee'} did not clock in on ${dateStr}.`,
        'attendance'
      );
    }

    count++;
  }

  return count;
}
