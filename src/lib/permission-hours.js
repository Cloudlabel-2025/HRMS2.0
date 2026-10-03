/**
 * Shared permission-window time maths. Client-safe (no mongoose imports).
 *
 * A permission covers exactly [startTime, endTime]. These helpers answer:
 *  - how long is the window (wrap-aware, for overnight windows);
 *  - how much of it falls BEFORE a clock-in (the "listed in the hours"
 *    portion that the clockIn->clockOut span alone would miss);
 *  - how far the window extends past the employee's shift (advisory only —
 *    never blocks submit or approval; the excess becomes late hours).
 */

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMins(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(HM_RE);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Wrap-aware duration of [perm.startTime, perm.endTime] in minutes.
 * Returns 0 when either endpoint is missing or invalid.
 */
export function permissionWindowMins(perm) {
  const s = toMins(perm?.startTime);
  const e = toMins(perm?.endTime);
  if (s === null || e === null) return 0;
  let d = e - s;
  if (d <= 0) d += 1440;
  return d;
}

/**
 * Minutes of the approved window that fall BEFORE clockIn.
 * A window already inside the worked span contributes 0 — this only
 * restores the part the clockIn->clockOut elapsed span cannot see.
 * Returns 0 when there is no permission, no clock-in, or invalid times.
 *
 * Same-day windows are exact. Overnight windows are best-effort: a
 * clock-in on the clock face strictly between end and start is treated
 * as the evening before the window (contributes 0, never over-credits).
 */
export function preClockInPermissionMins(perm, clockIn) {
  const s = toMins(perm?.startTime);
  const e = toMins(perm?.endTime);
  const c = toMins(clockIn);
  if (s === null || e === null || c === null) return 0;
  if (e > s) {
    return Math.max(0, Math.min(c, e) - s);
  }
  if (c > e && c < s) return 0;
  const cc = c < s ? c + 1440 : c;
  return Math.max(0, Math.min(cc - s, (e + 1440) - s));
}

/**
 * Minutes by which the permission window extends past the shift end,
 * measured on the shift timeline. 0 when inside the shift or when either
 * side is unresolvable. Advisory only — informs warnings, never blocks.
 */
export function permissionExcessMins(perm, shift) {
  const ps = toMins(perm?.startTime);
  const pe = toMins(perm?.endTime);
  const ss = toMins(shift?.startTime);
  const se = toMins(shift?.endTime);
  if (ps === null || pe === null || ss === null || se === null) return 0;
  // Shift timeline: 0 at shift start, shiftLen at shift end (wrap-aware).
  let shiftLen = se - ss;
  if (shiftLen <= 0) shiftLen += 1440;
  const pos = (t) => (((t - ss) % 1440) + 1440) % 1440;
  const endPos = pos(pe);
  // A window end exactly at shift end is inside (pos === shiftLen).
  // Anything strictly beyond is excess.
  if (endPos <= shiftLen) return 0;
  return endPos - shiftLen;
}
