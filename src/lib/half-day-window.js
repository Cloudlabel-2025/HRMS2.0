import { getShiftConfig } from './attendance-constants';
import { resolveShiftStartMins } from './absence-status';

/**
 * Shared first-half / second-half split logic.
 *
 * Precedence for the split:
 *   1. the leave's own filled custom window (Leave.halfDayStartTime /
 *      Leave.halfDayEndTime): first_half ends at halfDayEndTime,
 *      second_half begins at halfDayStartTime;
 *   2. otherwise shift.startTime + shift.halfDayThreshold
 *      (default 180 min, so 12:00 for a 09:00 start).
 * Falls back gracefully when the shift is unknown (09:00 start, 180 min).
 *
 * Semantics for login / session gates:
 *   full day              -> blocked the whole day
 *   first_half (morning)  -> blocked while now < split, allowed from split on
 *   second_half (afternoon)-> allowed until split, blocked from split on
 *   halfDayType unset     -> blocked the whole day (safe default)
 *
 * This module is client-safe (no mongoose imports). Server routes resolve
 * the shiftDoc themselves via resolveShift(user) from '@/lib/shift-utils'.
 */

export function splitMinsToLabel(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

/** Wrap-aware difference a - b mapped into (-720, 720]. */
function relDiff(a, b) {
  let d = a - b;
  if (d <= -720) d += 1440;
  if (d > 720) d -= 1440;
  return d;
}

/** Strict HH:MM -> minutes, or null when blank/invalid (falls back to shift). */
function parseSplitTime(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Which side of the split a wall-clock minute falls on.
 * @returns {'first_half'|'second_half'}
 */
export function splitSideOf(nowMins, splitMins) {
  return relDiff(nowMins, splitMins) >= 0 ? 'second_half' : 'first_half';
}

/**
 * @param {Object|null} shiftDoc - lean Shift doc (startTime, halfDayThreshold)
 * @param {string} [fallbackShiftName] - User.shift, e.g. "Morning (9AM-6PM)"
 * @param {Object|null} [leave] - approved Leave (uses its custom window when filled)
 * @returns {number} split time in minutes since midnight (0-1439)
 */
export function resolveHalfDaySplitMins(shiftDoc, fallbackShiftName, leave = null) {
  const custom =
    leave?.halfDayType === 'first_half' ? leave?.halfDayEndTime
    : leave?.halfDayType === 'second_half' ? leave?.halfDayStartTime
    : null;
  const customMins = parseSplitTime(custom);
  if (customMins !== null) return customMins;
  const startMins = resolveShiftStartMins(shiftDoc, fallbackShiftName);
  const threshold = Number(shiftDoc?.halfDayThreshold);
  const halfDayThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 180;
  return (((startMins + halfDayThreshold) % 1440) + 1440) % 1440;
}

/**
 * @param {Object} args
 * @param {Object|null} args.leave - approved Leave doc covering today (or null)
 * @param {number} args.splitMins - from resolveHalfDaySplitMins
 * @param {Date} [args.now] - evaluation instant (defaults to now)
 * @returns {{ blocked: boolean, message: string|null }} message is only set when blocked
 */
export function evaluateHalfDayGate({ leave, splitMins, now = new Date() }) {
  if (!leave) return { blocked: false, message: null };

  const nowMins = nowMinutes(now);
  const typeLabel = leave.type || leave.typeCode || 'Leave';
  const returnOn = leave.to || leave.from || '';

  // Full-day leave (or half-day flag without a recorded half) blocks all day.
  if (!leave.halfDay || !leave.halfDayType) {
    return {
      blocked: true,
      message: `You are on approved leave today (${typeLabel}). Please return on ${returnOn} to log in.`,
    };
  }

  const atOrAfterSplit = splitSideOf(nowMins, splitMins) === 'second_half';

  if (leave.halfDayType === 'first_half') {
    if (!atOrAfterSplit) {
      return {
        blocked: true,
        message: `You are on approved first-half leave today (${typeLabel}). Your login opens at ${splitMinsToLabel(splitMins)}.`,
      };
    }
    return { blocked: false, message: null };
  }

  if (leave.halfDayType === 'second_half') {
    if (atOrAfterSplit) {
      return {
        blocked: true,
        message: `You are on approved second-half leave today (${typeLabel}). Please return on ${returnOn} to log in.`,
      };
    }
    return { blocked: false, message: null };
  }

  // Unknown halfDayType: fail closed.
  return {
    blocked: true,
    message: `You are on approved leave today (${typeLabel}). Please return on ${returnOn} to log in.`,
  };
}
