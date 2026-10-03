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
 *     Late is display-only: payroll always credits a full day for it.
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
 * Single payroll day classifier shared by payroll/run and absence marking.
 * Priority: approved half-day (0.5) > clocked present/late (1, half_day 0.5)
 * > approved paid leave (overlap handled by caller) > permission/shortHours
 * informational (never LOP) > absent/missing (0, LOP via stored record).
 *
 * Late NEVER reduces pay: any clocked-in late day credits a full day.
 * `countHalfDay` is not consulted here. A half-day leave always credits 0.5
 * presence; the "pay a half-day leave as a full day" behaviour lives entirely
 * on the leave-credit side of payroll (payroll-run-engine), which also keeps
 * the unworked-half-of-a-half-day-leave rule consistent. Crediting 1 here AND
 * 0.5 on the leave side used to make one working day worth 1.5 payable days.
 *
 * @param {Object} rec - Attendance record (lean or doc)
 * @param {Object} lopConfig - { countHalfDay } (accepted for call compatibility)
 * @returns {number} presence credit 0 | 0.5 | 1
 */
export function classifyPresence(rec, lopConfig = {}) { // eslint-disable-line no-unused-vars
  // Admin-imported presence correction (bulk attendance import): a full
  // present day with no clock-in. Must come before the clockIn guard, and
  // must require a real source — the schema materialises an empty
  // importedPresence object (all nulls) on every row, which is truthy.
  if (hasImportedPresence(rec) && ['present', 'late'].includes(rec.status)) {
    return 1;
  }
  if (!rec?.clockIn) return 0;
  // Approved half-day leave: worked one half, so half a day's presence.
  if (rec.approvedHalfDayLeave || rec.status === 'half_day') return 0.5;
  // Late always credits a full day — late is never LOP, including arrivals
  // past the shift's half-day threshold (that is display-only).
  if (['present', 'late'].includes(rec.status)) return 1;
  return 0;
}
