import { determineStatus } from '@/lib/attendance-constants';
import { hasImportedPresence } from '@/lib/attendance-stats';

function toMins(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Unified day-status engine (Keep A: 8-hour stays informational).
 *
 * Priority:
 *  1. rejected leaveOverride / explicit holiday -> 'holiday' | 'leave'
 *  1b. non-working calendar day (holiday / weekly_off) -> 'holiday'.
 *      The calendar is authoritative: a clock-in on a holiday is tracked
 *      (hours) but the day is labelled holiday, never present/late.
 *  2. approved half-day leave -> judged by the actual clock-in (present/late,
 *     never late from the leave-adjusted expectation; callers clear lateFlag).
 *     The approvedHalfDayLeave marker (not this status) drives the 0.5
 *     payroll credit and the Half Day display.
 *  3. approved late-arrival permission window (covers shift start),
 *     strict end-inclusive (grace 0):
 *     actualMins <= permEndMins -> 'present' (permissionApplied: true)
 *     Mid-day permissions (window does not include shift start) never
 *     affect late — they only consume the monthly allowance.
 *  4. lateThreshold from shift -> 'late' | 'present'.
 *     'late' is money-bearing: past the threshold the day is worth half, and
 *     at/over halfDayThreshold nothing. See classifyDayPay below.
 *
 * @param {Object} params
 * @param {string|null} params.clockIn - HH:MM actually clocked (wall time, never faked)
 * @param {Object|null} params.permission - { startTime, endTime } or null
 * @param {boolean} params.approvedHalfDayLeave
 * @param {string} params.nonWorkingDayType - 'none'|'holiday'|'weekly_off'
 * @param {string} params.leaveOverrideStatus - 'none'|'pending'|'approved'|'rejected'
 * @param {number} params.minutesSinceShiftStart
 * @param {number|null} params.shiftStartMins - minutes since midnight for shift start
 * @param {Object} params.cfg - shift config (lateThreshold)
 * @returns {{ status: string, lateFlag: boolean, permissionApplied: boolean, isMidDayPermission: boolean }}
 */
export function resolveDayStatus({
  clockIn,
  permission,
  approvedHalfDayLeave,
  nonWorkingDayType,
  leaveOverrideStatus,
  minutesSinceShiftStart,
  shiftStartMins = null,
  cfg,
}) {
  if (leaveOverrideStatus === 'rejected') {
    return {
      status: nonWorkingDayType !== 'none' ? 'holiday' : 'leave',
      lateFlag: false,
      halfDayThresholdExceeded: false,
      permissionApplied: false,
      isMidDayPermission: false,
    };
  }
  // Calendar-authoritative: a non-working day is labelled holiday even when
  // someone clocks in. Hours are still recorded; payroll excludes the date
  // from the working set so it can never become LOP.
  if (nonWorkingDayType && nonWorkingDayType !== 'none') {
    return {
      status: 'holiday',
      lateFlag: false,
      halfDayThresholdExceeded: false,
      permissionApplied: false,
      isMidDayPermission: false,
    };
  }
  // A worked half of an approved half-day leave is judged by the actual
  // clock-in below (present/late like any worked day). The
  // approvedHalfDayLeave flag is intentionally not consulted here: it is a
  // payroll/display marker, not a status override.
  if (permission?.endTime && clockIn) {
    const nowMins = toMins(clockIn);
    const endMins = toMins(permission.endTime);
    const startMins = toMins(permission.startTime);
    const lateThreshold = Number(cfg?.lateThreshold ?? 15);
    const coversShiftStart =
      startMins !== null && shiftStartMins !== null && shiftStartMins !== undefined
        ? startMins <= shiftStartMins + lateThreshold
        : true;
    if (!coversShiftStart) {
      const result = determineStatus(minutesSinceShiftStart, cfg);
      return { ...result, permissionApplied: false, isMidDayPermission: true };
    }
    if (nowMins !== null && endMins !== null && nowMins <= endMins) {
      return { status: 'present', lateFlag: false, halfDayThresholdExceeded: false, permissionApplied: true, isMidDayPermission: false };
    }
    if (nowMins !== null && endMins !== null && nowMins > endMins) {
      const result = determineStatus(minutesSinceShiftStart, cfg);
      return { ...result, permissionApplied: false, isMidDayPermission: false };
    }
  }
  const result = determineStatus(minutesSinceShiftStart, cfg);
  return { ...result, permissionApplied: false, isMidDayPermission: false };
}

/**
 * Day-count classifier for attendance/report surfaces (no money).
 *
 * Delegates to classifyDayPay with lateLopMode 'none' so a late-arrival LOP
 * rule can never change an attendance report figure. See classifyDayPay below
 * for the payroll money rules.
 */
export function classifyPresence(rec, lopConfig = {}) { // eslint-disable-line no-unused-vars
  // Attendance/report consumers only need the day count, never the money.
  // Passing lateLopMode 'none' guarantees this stays independent of the late
  // LOP rule so a payslip change can never shift an attendance figure.
  return classifyDayPay(rec, { lateLopMode: 'none' }).presence;
}

/**
 * Single classifier for a working day's MONEY: how much presence it credits
 * and how many LOP days it withholds.
 *
 *   Situation                              presence  lopDays
 *   --------------------------------------  --------  -------
 *   on time / present                            1.0       0
 *   short hours, break excess, permission         1.0       0   <- never LOP
 *   imported presence (bulk-import correction)    1.0       0
 *   approved half-day leave (worked other half)   0.5       0
 *   late, within lateGraceMinutes                 1.0       0
 *   late, past lateGraceMinutes (default)         0.5      0.5
 *   late, at/over halfDayThreshold                0.0      1.0
 *   absent (no clock-in)                          0.0      1.0
 *   paid leave day (no clock-in)                  0.0       0
 *
 * Late deduction is governed by lopConfig.lateLopMode:
 *   'half' (default) 0.5 day · 'full' 1.0 day · 'none' no deduction at all.
 * Crossing the shift's halfDayThreshold escalates to a full day whenever
 * lopConfig.halfDayThresholdFullLop is true, unless the mode is 'none'.
 *
 * INVARIANT — shortHours, shortfallMins, breakExcessMins, payableHours and
 * permission are INFORMATIONAL ONLY and must never contribute lopDays. Only an
 * absence, an explicitly unpaid leave type, or a late arrival may deduct.
 *
 * The late tiers rely on `status === 'late'` and `halfDayThresholdExceeded`,
 * both of which the payroll run recomputes from the frozen shift snapshot
 * before calling this. The stored flag may be stale — never trust it without
 * that recompute.
 *
 * @param {Object} rec - Attendance record (lean or doc)
 * @param {Object} lopConfig - { lateLopMode, lateGraceMinutes, halfDayThresholdFullLop, countHalfDay }
 * @param {number|null} [minutesLate] - minutes past shift start; only used to
 *   apply lateGraceMinutes. Derived from the frozen shift snapshot by the caller.
 * @returns {{ presence: 0|0.5|1, lopDays: 0|0.5|1 }}
 */
export function classifyDayPay(rec, lopConfig = {}, minutesLate = null) {
  const mode = lopConfig.lateLopMode ?? 'half';

  // Admin-imported presence correction (bulk attendance import): a full
  // present day with no clock-in. Must come before the clockIn guard, and
  // must require a real source — the schema materialises an empty
  // importedPresence object (all nulls) on every row, which is truthy.
  if (hasImportedPresence(rec) && ['present', 'late'].includes(rec.status)) {
    return { presence: 1, lopDays: 0 };
  }

  // Absent: no clock-in and no approved leave. Deducted via the absentDays
  // counter by the caller, so report 0 here to avoid double counting.
  if (rec?.status === 'absent' && !rec?.clockIn) return { presence: 0, lopDays: 0 };

  if (!rec?.clockIn) return { presence: 0, lopDays: 0 };

  // Approved half-day leave: the employee worked the other half, so half a
  // day's presence. The leave side credits the remaining half.
  if (rec.approvedHalfDayLeave || rec.status === 'half_day') return { presence: 0.5, lopDays: 0 };

  if (rec.status === 'late') {
    if (mode === 'none') return { presence: 1, lopDays: 0 };
    // Free grace band: still inside tolerance, nothing is withheld.
    const grace = Number(lopConfig.lateGraceMinutes) || 0;
    if (grace > 0 && Number.isFinite(minutesLate) && minutesLate <= grace) {
      return { presence: 1, lopDays: 0 };
    }
    // Crossed the half-day threshold -> escalate to a full day's LOP.
    if (rec.halfDayThresholdExceeded && lopConfig.halfDayThresholdFullLop !== false) {
      return { presence: 0, lopDays: 1 };
    }
    if (mode === 'full') return { presence: 0, lopDays: 1 };
    return { presence: 0.5, lopDays: 0.5 };
  }

  if (rec.status === 'present') return { presence: 1, lopDays: 0 };

  return { presence: 0, lopDays: 0 };
}
