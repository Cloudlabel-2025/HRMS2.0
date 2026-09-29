/**
 * Single source of truth for attendance statistics.
 *
 * Client-safe (no mongoose imports) so the Team report UI, the Excel export
 * and the PDF export all compute from THIS module and can never disagree.
 *
 * Definitions (locked):
 *  - Days Worked  = any WORKING-day row with a clock-in (present, late,
 *    short-hours, half-day-leave-worked all count as 1). Holidays/week-offs
 *    are excluded even when worked (see workedOffDays).
 *  - Leave        = leave/half_day rows with NO clock-in. A half-day-leave
 *    day with a clock-in counts as worked, never both.
 *  - Late         = every 'late' row, including arrivals past the half-day
 *    threshold. Late is never LOP for payroll; this is display only.
 *
 * Reconciliation identity (always holds when the register is complete):
 *   workingDays === daysWorked + leave + absent + notArrived
 *   totalRows   === workingDays + offDays
 */

export function hasImportedPresence(rec) {
  return !!rec?.importedPresence?.source;
}

export function isWorkedDay(rec) {
  return !!(rec?.clockIn || hasImportedPresence(rec));
}

export function isOffDay(rec) {
  return rec?.status === 'holiday';
}

export function isWeeklyOff(rec) {
  return rec?.status === 'holiday' && rec?.nonWorkingDayType === 'weekly_off';
}

export function isNamedHoliday(rec) {
  return rec?.status === 'holiday' && rec?.nonWorkingDayType !== 'weekly_off';
}

export function isNotArrived(rec) {
  return !!(rec?.notArrived || rec?.displayStatus === 'not_arrived');
}

export function isLate(rec) {
  return rec?.status === 'late';
}

export function isLatePastThreshold(rec) {
  return rec?.status === 'late' && !!rec?.halfDayThresholdExceeded;
}

export function isHalfDayLeave(rec) {
  return rec?.status === 'half_day' || !!rec?.approvedHalfDayLeave;
}

export function hasApprovedPermission(rec) {
  return !!(
    rec?.permission?.requestId ||
    rec?.permission?.startTime ||
    rec?._permissionStatus === 'approved'
  );
}

export function hasPendingPermission(rec) {
  return !hasApprovedPermission(rec) && !!(rec?.pendingPermission || rec?._permissionStatus === 'pending');
}

export function isShortHours(rec) {
  return !!(rec?.shortHours) && !hasApprovedPermission(rec);
}

/**
 * Single display-status resolver shared by the Team report table and the
 * Excel/PDF exports. Rules:
 *  - server-derived displayStatus (not_arrived) always wins;
 *  - an approved permission forces Present ONLY on a worked day — a past
 *    permission day with no clock-in shows Absent (with the permission
 *    badge), matching the Absence page;
 *  - a worked half-day-leave day shows Half Day; an unworked one shows Leave.
 */
export function displayStatusOf(rec) {
  if (rec?.displayStatus) return rec.displayStatus;
  if (isWorkedDay(rec) && hasApprovedPermission(rec)) return 'present';
  if (rec?.status === 'half_day' || rec?.approvedHalfDayLeave) {
    return isWorkedDay(rec) ? 'half_day' : 'leave';
  }
  return rec?.status || 'absent';
}

/** True when the row's Present badge comes from an approved permission. */
export function showsAsPresentViaPermission(rec) {
  return displayStatusOf(rec) === 'present' && hasApprovedPermission(rec);
}

/** Remarks text shared by the Team report table and the exports. */
export function remarksOf(rec) {
  if (rec?.status === 'holiday') {
    return rec?.nonWorkingDayType === 'weekly_off'
      ? 'Week-off'
      : (rec?.holidayName ? `Holiday · ${rec.holidayName}` : 'Holiday');
  }
  if (isNotArrived(rec)) return 'Not arrived yet';
  return rec?.absenceReason || '—';
}

export function computeAttendanceStats(records) {
  const rows = Array.isArray(records) ? records : [];
  const off = rows.filter(isOffDay);
  const working = rows.filter(r => !isOffDay(r));

  // Working-day buckets (precedence: worked > leave > absent > notArrived).
  const worked = working.filter(isWorkedDay);
  const notWorked = working.filter(r => !isWorkedDay(r));
  const notArrived = notWorked.filter(isNotArrived);
  const decided = notWorked.filter(r => !isNotArrived(r));
  const absent = decided.filter(r => r.status === 'absent');
  const leave = decided.filter(r => r.status === 'leave' || r.status === 'half_day');
  // Data-integrity bucket: rows that are neither worked, leave, absent nor
  // not-arrived (e.g. a 'present' row with no clock-in). Normally 0; when
  // non-zero the reconciliation below fails loudly instead of hiding them.
  const other = decided.filter(r => !['absent', 'leave', 'half_day'].includes(r.status));

  const present = worked.filter(r => r.status === 'present').length;
  const late = worked.filter(isLate).length;
  const latePastThreshold = worked.filter(isLatePastThreshold).length;
  const shortHours = worked.filter(isShortHours).length;
  const permission = worked.filter(hasApprovedPermission).length;
  const halfDayLeaveWorked = worked.filter(isHalfDayLeave).length;

  const holidays = off.filter(isNamedHoliday).length;
  const weeklyOffs = off.filter(isWeeklyOff).length;
  const workedOffDays = off.filter(isWorkedDay).length;

  const stats = {
    totalRows: rows.length,
    workingDays: working.length,
    offDays: off.length,
    holidays,
    weeklyOffs,
    workedOffDays,
    daysWorked: worked.length,
    present,
    late,
    latePastThreshold,
    shortHours,
    permission,
    leave: leave.length,
    halfDayLeave: leave.filter(isHalfDayLeave).length + halfDayLeaveWorked,
    halfDayLeaveWorked,
    absent: absent.length,
    notArrived: notArrived.length,
    other: other.length,
  };
  stats.reconciles =
    stats.workingDays === stats.daysWorked + stats.leave + stats.absent + stats.notArrived + stats.other &&
    stats.totalRows === stats.workingDays + stats.offDays;
  return stats;
}

/** One-line proof string rendered under the cards and in exports. */
export function reconciliationLine(s) {
  return `${s.workingDays} working = ${s.daysWorked} worked + ${s.leave} leave + ${s.absent} absent + ${s.notArrived} not arrived`;
}
