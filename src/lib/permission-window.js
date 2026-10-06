// Dependency-free on purpose: imported by BOTH server routes and 'use
// client' pages. Never import server-only modules (models, payroll-cycle)
// from here.
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Maximum advance booking for a permission request: 30 days past the
// earliest bookable date. Keeps requests inside the allowance cycle that
// is already computed for them.
export const MAX_PERMISSION_ADVANCE_DAYS = 30;

// Hard duration cap per request (2 hours). Mirrors the monthly allowance
// default on purpose: one request can never consume more than a full cycle.
export const MAX_PERMISSION_DURATION_MINS = 120;

function toMinsLocal(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Minutes an ACTUAL permission end overran its SCHEDULED end.
 *
 * Wrap-aware: both values are measured relative to the permission start, so
 * an overnight window (23:00-01:00) ending at 23:30 reports 0 overrun rather
 * than "+1350m". Returns 0 when anything is missing or malformed.
 *
 * Shared by the regularization approval route and the attendance page badges
 * so both always agree.
 */
export function permissionOverrunMins(startTime, endTime, actualEndTime) {
  const s = toMinsLocal(startTime);
  const e = toMinsLocal(endTime);
  const a = toMinsLocal(actualEndTime);
  if (s === null || e === null || a === null) return 0;
  const rel = (t) => (((t - s) % 1440) + 1440) % 1440;
  return Math.max(0, rel(a) - rel(e));
}

/**
 * Anchor a HH:MM time on a shift timeline to an absolute calendar instant
 * ("YYYY-MM-DDTHH:MM", lexicographically comparable). For overnight shifts
 * (end < start, e.g. 22:00-06:00) post-midnight times belong to the next
 * calendar day: on shift-day D, 23:00 means D 23:00 but 02:00 means D+1
 * 02:00. For day shifts (or an unknown shift) every time maps to the given
 * date, preserving the plain calendar interpretation.
 */
export function anchorInstant(dateStr, timeStr, shiftStart, shiftEnd) {
  const s = toMinsLocal(timeStr);
  if (s === null) return null;
  let d = String(dateStr || '');
  const ss = toMinsLocal(shiftStart);
  const se = toMinsLocal(shiftEnd);
  if (ss !== null && se !== null && se < ss && s < ss) {
    d = addDaysStr(d, 1);
  }
  return `${d}T${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/**
 * Absolute start instant of a permission window. See anchorInstant for the
 * overnight-shift handling that keeps post-midnight bookings valid.
 */
export function permissionStartInstant(dateStr, startTime, shiftStart, shiftEnd) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return anchorInstant(`${y}-${pad2(m)}-${pad2(d)}`, startTime, shiftStart, shiftEnd);
}

export function nowInstant(now) {
  const d = now instanceof Date ? now : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Add whole days to a YYYY-MM-DD string. Pure calendar math, no Date
 * objects, so it never shifts across timezones.
 */
export function addDaysStr(dateStr, days) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

/**
 * Shift-day length in minutes, wrap-aware (overnight 22:00-06:00 => 480).
 * Returns null when either bound is missing/malformed.
 */
export function shiftDayLength(shiftStart, shiftEnd) {
  const ss = toMinsLocal(shiftStart);
  const se = toMinsLocal(shiftEnd);
  if (ss === null || se === null) return null;
  const len = (((se - ss) % 1440) + 1440) % 1440;
  return len === 0 ? 1440 : len;
}

/**
 * Is a HH:MM time inside the shift window (inclusive of both ends),
 * measured on the shift-day timeline so overnight shifts work.
 */
export function isTimeWithinShift(time, shiftStart, shiftEnd) {
  const t = toMinsLocal(time);
  const ss = toMinsLocal(shiftStart);
  const len = shiftDayLength(shiftStart, shiftEnd);
  if (t === null || ss === null || len === null) return false;
  const rel = (((t - ss) % 1440) + 1440) % 1440;
  return rel >= 0 && rel <= len;
}

/**
 * Is a [start, end] window fully inside the shift window (inclusive)?
 * Absolute-midnight-crossing windows only pass on overnight shifts where
 * the whole span fits the shift day.
 */
export function isWindowWithinShift(startTime, endTime, shiftStart, shiftEnd) {
  const s = toMinsLocal(startTime);
  const e = toMinsLocal(endTime);
  const ss = toMinsLocal(shiftStart);
  const len = shiftDayLength(shiftStart, shiftEnd);
  if (s === null || e === null || ss === null || len === null) return false;
  const rel = (t) => (((t - ss) % 1440) + 1440) % 1440;
  return rel(s) <= rel(e) && rel(e) <= len;
}

/**
 * Validate a permission request window against format, duration and
 * advance-booking rules. Server-authoritative — UI mirrors these messages
 * for instant feedback only.
 *
 * Past dates and past times are ALLOWED (backdated requests carry a
 * "Past request" badge at display time instead). minDate/now/shift
 * anchoring args are accepted but no longer reject anything.
 *
 * @param {Object} args
 * @param {string} args.date       YYYY-MM-DD
 * @param {string} args.startTime  HH:MM
 * @param {string} args.endTime    HH:MM
 * @param {Date}   args.now        (unused, kept for call compatibility)
 * @param {string} args.minDate    (unused, kept for call compatibility)
 * @param {string} args.maxDate    latest bookable date (minDate + 30d)
 * @param {string} [args.shiftStart] (unused, kept for call compatibility)
 * @param {string} [args.shiftEnd]   (unused, kept for call compatibility)
 * @returns {{valid: boolean, error?: string}}
 */
export function validatePermissionWindow({ date, startTime, endTime, now, minDate, maxDate, shiftStart, shiftEnd }) { // eslint-disable-line no-unused-vars
  if (!date || !DATE_RE.test(String(date))) return { valid: false, error: 'Invalid permission date format' };
  if (!startTime || !TIME_RE.test(String(startTime)) || !endTime || !TIME_RE.test(String(endTime))) {
    return { valid: false, error: 'Invalid start or end time format' };
  }
  if (maxDate && String(date) > String(maxDate)) {
    return { valid: false, error: `Permission cannot be requested more than ${MAX_PERMISSION_ADVANCE_DAYS} days in advance` };
  }

  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  let durationMins = (eh * 60 + em) - (sh * 60 + sm);
  if (durationMins < 0) durationMins += 24 * 60;
  if (durationMins <= 0) return { valid: false, error: 'End time must be after start time' };
  if (durationMins > MAX_PERMISSION_DURATION_MINS) {
    return { valid: false, error: `Permission request cannot exceed ${MAX_PERMISSION_DURATION_MINS / 60} hours` };
  }

  return { valid: true };
}

/**
 * Was this permission filed for a window that had already elapsed?
 * True for past dates, or for same-day windows whose start is at/before
 * the filing time. Plain `${date}T${start}` vs filing-instant compare, so
 * overnight windows (23:00 on D filed on D+1) read as past correctly.
 *
 * @param {string} payloadDate YYYY-MM-DD permission date
 * @param {string} startTime   HH:MM window start
 * @param {string|Date} filedAt request createdAt (ISO)
 */
export function isPastFiling(payloadDate, startTime, filedAt) {
  const d = String(payloadDate || '');
  const s = String(startTime || '');
  if (!DATE_RE.test(d) || !TIME_RE.test(s)) return false;
  const filed = filedAt instanceof Date ? filedAt : new Date(filedAt);
  if (Number.isNaN(filed.getTime())) return false;
  const startInstant = `${d}T${s}`;
  const filedStr = `${filed.getFullYear()}-${String(filed.getMonth() + 1).padStart(2, '0')}-${String(filed.getDate()).padStart(2, '0')}T${String(filed.getHours()).padStart(2, '0')}:${String(filed.getMinutes()).padStart(2, '0')}`;
  // Strictly elapsed only: a window opening in the filing minute is current.
  return startInstant < filedStr;
}
