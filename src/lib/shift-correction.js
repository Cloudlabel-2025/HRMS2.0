import { getShiftConfig, determineStatus, calculateHoursWorked, diffMins, toMinutes } from './attendance-constants';
import { calculateBreakDeduction } from './attendance-breaks';
import { snapshotShift } from './shift-schedule';

// Rejudge recorded facts; never manufacture punches or rewrite work entries.
export function correctedAttendance(record, shift, config, leave = null) {
  const cfg = getShiftConfig(shift, config);
  const patch = {
    scheduleSnapshot: snapshotShift(shift), shiftId: shift._id,
    shiftName: shift.name, shiftStartTime: shift.startTime,
    shiftEndTime: shift.endTime, shiftLateThreshold: cfg.lateThreshold,
  };
  const start = toMinutes(shift.startTime);
  let end = toMinutes(shift.endTime);
  if (end <= start) end += 1440;
  if (record.clockIn && record.clockOut) {
    // Old rule indices belong to the previous schedule. Match names/types
    // against the replacement rules instead, without altering stored breaks.
    const breaks = (record.breaks || []).map(entry => ({ ...entry, ruleIdx: null }));
    const deduction = calculateBreakDeduction(breaks, cfg.breaks);
    const elapsed = diffMins(record.clockIn, record.clockOut);
    let out = toMinutes(record.clockOut);
    if (end >= 1440 && out < start) out += 1440;
    const hours = calculateHoursWorked(elapsed, deduction, cfg, {
      clockOutMins: out, shiftStartMins: start, shiftEndMins: end,
      breakExcessMins: deduction,
    });
    Object.assign(patch, hours, { baseHoursWorked: hours.baseHours, breakDeduction: deduction });
    delete patch.baseHours;
    let late = toMinutes(record.clockIn) - start;
    if (late < -720) late += 1440;
    if (late > 720) late -= 1440;
    Object.assign(patch, determineStatus(late, cfg), { earlyLogin: late < 0 });
  } else {
    Object.assign(patch, { status: record.importedPresence?.source === 'bulk_upload' ? 'present' : 'absent',
      lateFlag: false, halfDayThresholdExceeded: false });
  }
  // Leave and manual non-working decisions retain their priority and balances.
  if (leave || record.approvedHalfDayLeave || record.status === 'leave' || record.leaveOverride?.status === 'rejected') {
    patch.status = leave?.halfDay || record.approvedHalfDayLeave ? 'half_day' : 'leave';
    patch.lateFlag = false;
    patch.halfDayThresholdExceeded = false;
  }
  if (record.nonWorkingDayType && record.nonWorkingDayType !== 'none') {
    patch.status = 'holiday'; patch.lateFlag = false; patch.halfDayThresholdExceeded = false;
  }
  return patch;
}
