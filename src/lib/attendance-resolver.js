import { determineStatus } from '@/lib/attendance-constants';

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
 *  2. approved half-day leave -> 'half_day' (0.5 presence, no late)
 *  3. approved late-arrival permission window (covers shift start),
 *     strict end-inclusive (grace 0):
 *     actualMins <= permEndMins -> 'present' (permissionApplied: true)
 *     Mid-day permissions (window does not include shift start) never
 *     affect late — they only consume the monthly allowance.
 *  4. lateThreshold from shift -> 'late' | 'present'
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
      permissionApplied: false,
      isMidDayPermission: false,
    };
  }
  if (approvedHalfDayLeave) {
    // Half-day leave + clock-in is a half working day (0.5 presence in
    // payroll when lopConfig.countHalfDay is true), never late.
    return { status: 'half_day', lateFlag: false, permissionApplied: false, isMidDayPermission: false };
  }
  if (permission?.endTime && clockIn) {
    const nowMins = toMins(clockIn);
    const endMins = toMins(permission.endTime);
    const startMins = toMins(permission.startTime);
    // Only a window covering the shift start acts as late-arrival cover.
    // Mid-day windows (e.g. 14:00-16:00 for a 09:00 shift) fall through to
    // normal late evaluation and only consume allowance.
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
      return { status: 'present', lateFlag: false, permissionApplied: true, isMidDayPermission: false };
    }
    // Arrival after the window: still evaluate normal lateness, but flag that
    // a late-arrival permission existed (consumed, no refund).
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
 * informational (never LOP) > absent/missing (0, LOP via gap).
 *
 * @param {Object} rec - Attendance record (lean or doc)
 * @param {Object} lopConfig - { countHalfDay }
 * @returns {number} presence credit 0 | 0.5 | 1
 */
export function classifyPresence(rec, lopConfig = {}) {
  if (!rec?.clockIn) return 0;
  if (rec.approvedHalfDayLeave) return 0.5;
  if (rec.status === 'half_day') return lopConfig.countHalfDay === false ? 1 : 0.5;
  if (['present', 'late'].includes(rec.status)) return 1;
  return 0;
}
