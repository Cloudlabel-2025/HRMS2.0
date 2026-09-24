import { permissionCoversShiftStart } from './permission-allowance';
import { getAttendanceDate } from './attendance-date';

/**
 * Central absence-day classifier.
 *
 * Priority (per product decision):
 *  1. non-working day (holiday/weekly_off) -> skipped by caller, never absent
 *  2. approved leave covering date -> 'on_leave' (never absent)
 *  3. clocked-in record -> present/late/half_day via existing attendance status (never absent)
 *  4. no clock-in + today + elapsed < halfDayThreshold -> 'not_arrived'
 *     (permission badge persists even if permission window already passed)
 *  5. no clock-in + (past date OR today past threshold) -> 'absent'
 *     (permission badge kept as context, still counts as absent)
 *
 * Future dates (date > shift-aware today) are never absent nor not_arrived;
 * caller should exclude them.
 */

export function parseHm(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Minutes elapsed since shift start, wraparound-aware (±12h). */
export function elapsedSinceShiftStart(now, shiftStartMins) {
  if (shiftStartMins === null || shiftStartMins === undefined) return 0;
  let elapsed = now.getHours() * 60 + now.getMinutes() - shiftStartMins;
  if (elapsed < -720) elapsed += 1440;
  if (elapsed > 720) elapsed -= 1440;
  return elapsed;
}

export function shiftAwareToday(now, shiftDoc) {
  try {
    return getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
  } catch {
    return (
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0')
    );
  }
}

export function resolveShiftStartMins(shiftDoc, fallbackShiftName) {
  if (shiftDoc?.startTime) {
    const v = parseHm(shiftDoc.startTime);
    if (v !== null) return v;
  }
  if (fallbackShiftName) {
    // Parse "Morning (9AM-6PM)" style names without importing payroll-cycle (client-safe).
    const m = String(fallbackShiftName).match(/\((\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (m) {
      let h = Number(m[1]);
      const min = m[2] ? Number(m[2]) : 0;
      const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + min;
    }
    const colon = String(fallbackShiftName).match(/(\d{1,2}):(\d{2})/);
    if (colon) {
      const h = Number(colon[1]);
      const min = Number(colon[2]);
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return h * 60 + min;
    }
  }
  return 9 * 60; // default 09:00 (benefit of doubt)
}

/**
 * @param {Object} params
 * @param {string} params.date - YYYY-MM-DD being classified
 * @param {Object|null} params.attendance - Attendance lean record or null
 * @param {Object|null} params.leave - approved Leave covering date or null
 * @param {Object|null} params.permission - { status, startTime, endTime } or null
 * @param {Object} params.shiftDoc - shift doc (startTime/endTime/halfDayThreshold/lateThreshold)
 * @param {string} params.fallbackShiftName - User.shift string fallback
 * @param {Date} params.now - tz-aware now
 * @returns {{ kind, absent, permissionStatus, reason, halfDayThreshold, elapsed }}
 */
export function deriveAbsenceKind({
  date,
  attendance,
  leave,
  permission,
  shiftDoc,
  fallbackShiftName,
  now,
}) {
  const halfDayThreshold = Number(shiftDoc?.halfDayThreshold ?? 180) || 180;
  const shiftStartMins = resolveShiftStartMins(shiftDoc, fallbackShiftName);
  const lateThreshold = Number(shiftDoc?.lateThreshold ?? 15);

  // 2. Approved leave wins over everything (except non-working, handled by caller).
  if (leave) {
    if (leave.halfDay) {
      // Half-day leave without clock-in is still a leave day, not absent.
      return {
        kind: attendance?.clockIn ? 'half_day' : 'on_leave',
        absent: false,
        permissionStatus: null,
        reason: `On leave (${leave.type || leave.typeCode || 'Leave'}${leave.halfDay ? ', half day' : ''})`,
        halfDayThreshold,
        elapsed: 0,
        coversShift: false,
      };
    }
    return {
      kind: 'on_leave',
      absent: false,
      permissionStatus: null,
      reason: `On leave (${leave.type || leave.typeCode || 'Leave'})`,
      halfDayThreshold,
      elapsed: 0,
      coversShift: false,
    };
  }

  if (attendance?.clockIn) {
    const st = attendance.status;
    if (st === 'half_day' || attendance.approvedHalfDayLeave) {
      const halfLabel = leave?.halfDayType ? `Half day (${leave.halfDayType === 'first_half' ? 'First half' : 'Second half'})` : 'Half day (leave)';
      return {
        kind: 'half_day', absent: false, permissionStatus: permission?.status === 'approved' ? 'approved' : permission?.status === 'pending' ? 'pending' : null,
        reason: halfLabel, halfDayThreshold, elapsed: 0, coversShift: false,
      };
    }
    if (attendance?.halfDayThresholdExceeded && st === 'late') {
      const permStatus = permission?.status === 'approved' ? 'approved' : permission?.status === 'pending' ? 'pending' : null;
      return {
        kind: 'half_day', absent: false, permissionStatus: permStatus,
        reason: 'Half day — clocked in after half-day threshold', halfDayThreshold, elapsed: 0, coversShift: false,
      };
    }
    if (st === 'leave' || attendance?.leaveOverride?.status === 'rejected') {
      // Rejected override rows have clockIn nulled upstream; if clockIn somehow
      // remains, treat as on_leave, never absent.
      return { kind: 'on_leave', absent: false, permissionStatus: null, reason: 'On leave', halfDayThreshold, elapsed: 0, coversShift: false };
    }
    if (st === 'holiday') {
      return { kind: 'holiday', absent: false, permissionStatus: null, reason: 'Holiday', halfDayThreshold, elapsed: 0, coversShift: false };
    }
    const hasApprovedPerm = !!((attendance?.permission?.requestId || attendance?.permission?.startTime) || permission?.status === 'approved');
    const hasPendingPerm = !hasApprovedPerm && permission?.status === 'pending';
    if (st === 'late' && attendance?.halfDayThresholdExceeded) {
      return {
        kind: 'half_day', absent: false,
        permissionStatus: hasApprovedPerm ? 'approved' : hasPendingPerm ? 'pending' : null,
        reason: 'Half day — clocked in after half-day threshold', halfDayThreshold, elapsed: 0, coversShift: false,
      };
    }
    const kind = st === 'late' ? 'late' : 'present';
    return {
      kind,
      absent: false,
      permissionStatus: hasApprovedPerm ? 'approved' : hasPendingPerm ? 'pending' : null,
      reason: kind === 'late' ? 'Late clock-in' : 'Present',
      halfDayThreshold,
      elapsed: 0,
      coversShift: false,
    };
  }

  // 4/5. No clock-in: threshold-gated not_arrived vs absent.
  const today = shiftAwareToday(now, shiftDoc);
  const elapsed = elapsedSinceShiftStart(now, shiftStartMins);
  const coversShift = permission?.startTime
    ? permissionCoversShiftStart(permission.startTime, shiftStartMins, lateThreshold)
    : false;
  const permissionStatus = permission?.status === 'approved' ? 'approved' : permission?.status === 'pending' ? 'pending' : null;

  if (date === today && elapsed < halfDayThreshold) {
    // Not arrived yet — permission badge persists even if the permission
    // window (e.g. 09:00-11:00) already passed without arrival.
    return {
      kind: 'not_arrived',
      absent: false,
      permissionStatus,
      reason: permission
        ? `Not arrived yet (permission ${permission.startTime || ''}–${permission.endTime || ''} on file)`
        : 'Not arrived yet',
      halfDayThreshold,
      elapsed,
      coversShift,
    };
  }

  // Past date, or today at/after threshold -> absent.
  // Keep permission badge as context but still count as absent.
  return {
    kind: 'absent',
    absent: true,
    permissionStatus,
    reason: permission
      ? `Absent — permission ${permission.startTime || ''}–${permission.endTime || ''} on file`
      : 'Absent (no clock-in)',
    halfDayThreshold,
    elapsed,
    coversShift,
  };
}
