import mongoose from 'mongoose';
import { Shift } from './models/index';

export async function resolveShift(user, { asLean = true } = {}) {
  if (!user) return null;
  const shiftId = user.shiftId && mongoose.Types.ObjectId.isValid(String(user.shiftId)) ? user.shiftId : null;
  if (shiftId) {
    const byId = asLean ? await Shift.findById(shiftId).lean() : await Shift.findById(shiftId);
    if (byId) return byId;
  }
  if (user.shift) {
    const byName = asLean ? await Shift.findOne({ name: user.shift }).lean() : await Shift.findOne({ name: user.shift });
    if (byName) return byName;
  }
  return null;
}

/**
 * Resolve the shift effective on a historical attendance date.
 * Walks applied ShiftChange history backwards from today to reconstruct
 * the shift that was active on dateStr. Best-effort: changes that were
 * applied immediately (no ShiftChange record) or without fromShiftId
 * fall back to the current shift.
 *
 * @param {Object} user - lean user with _id, shift, shiftId
 * @param {string} dateStr - YYYY-MM-DD attendance date to resolve for
 * @param {{asLean?: boolean}} opts
 * @returns {Promise<Object|null>} shift doc or null
 */
export async function resolveShiftForDate(user, dateStr, { asLean = true } = {}) {
  if (!user || !dateStr) return resolveShift(user, { asLean });
  try {
    const { ShiftChange } = await import('./models/index');
    const uidStr = String(user._id || user.id || '');
    if (!uidStr) return resolveShift(user, { asLean });

    // All applied changes that took effect AFTER the target date and affect this user.
    // Scheduled changes are stored with effectiveDate; immediate applies have no record
    // and are intentionally unrecoverable — we fall back to current shift.
    const changes = await ShiftChange.find({
      status: 'applied',
      effectiveDate: { $gt: dateStr },
      userIds: user._id,
    }).sort({ effectiveDate: -1 }).lean().catch(() => []);

    if (!changes.length) return resolveShift(user, { asLean });

    let curShiftId = user.shiftId ? String(user.shiftId) : null;
    let curShiftName = user.shift || null;

    for (const ch of changes) {
      // This change moved the user to ch.targetShiftId on ch.effectiveDate.
      // To reverse it, the shift BEFORE it was ch.fromShiftId (when recorded).
      const appliesToUser = (ch.userIds || []).some(id => String(id) === uidStr);
      if (!appliesToUser) continue;

      const isCurrentTarget =
        (curShiftId && ch.targetShiftId && String(ch.targetShiftId) === curShiftId) ||
        (!curShiftId && curShiftName && ch.targetShiftName && ch.targetShiftName === curShiftName) ||
        // If we already stepped back and cur is from a previous step, still reverse if this
        // earlier change's target matches current step's from (chain).
        false;

      // Only reverse if the current shift matches this change's target — otherwise
      // the change is not on the lineage that produced the current shift.
      // When fromShiftId is null (bulk change without from filter) we cannot
      // reverse precisely; fall back to current resolver.
      if (!isCurrentTarget) {
        // Chain case: if we have no curShiftId but change has relevant user,
        // the lineage is ambiguous — skip this change (conservative).
        // Only step back when we can positively match target.
        continue;
      }

      if (ch.fromShiftId) {
        curShiftId = String(ch.fromShiftId);
        try {
          const fromShift = asLean
            ? await Shift.findById(ch.fromShiftId).lean()
            : await Shift.findById(ch.fromShiftId);
          if (fromShift) curShiftName = fromShift.name;
        } catch { /* ignore */ }
      } else if (ch.fromShiftId === null) {
        // No from recorded — lineage break. Best-effort fallback to current shift.
        // We cannot know the prior shift, so stop reverse walk.
        break;
      }
    }

    if (curShiftId && mongoose.Types.ObjectId.isValid(curShiftId)) {
      const byId = asLean ? await Shift.findById(curShiftId).lean() : await Shift.findById(curShiftId);
      if (byId) return byId;
    }
    if (curShiftName) {
      const byName = asLean ? await Shift.findOne({ name: curShiftName }).lean() : await Shift.findOne({ name: curShiftName });
      if (byName) return byName;
    }
    return resolveShift(user, { asLean });
  } catch {
    return resolveShift(user, { asLean });
  }
}
export function getShiftEndMinutes(shiftDoc, config) {
  const endTime = shiftDoc?.endTime;
  if (!endTime || typeof endTime !== 'string') return 600;
  const [eh, em] = endTime.split(':').map(Number);
  if (isNaN(eh) || isNaN(em)) return 600;
  let endMins = eh * 60 + em;
  const startTime = shiftDoc?.startTime;
  if (startTime && typeof startTime === 'string') {
    const [sh, sm] = startTime.split(':').map(Number);
    if (!isNaN(sh) && !isNaN(sm) && endMins < sh * 60 + sm) endMins += 24 * 60;
  }
  return endMins;
}
