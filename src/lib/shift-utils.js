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
 * applied immediately without a ShiftChange record or without fromShiftId
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
    const changes = await ShiftChange.find({
      status: 'applied',
      effectiveDate: { $gt: dateStr },
      userIds: user._id,
    }).sort({ effectiveDate: -1 }).lean().catch(() => []);

    if (!changes.length) return resolveShift(user, { asLean });

    let curShiftId = user.shiftId ? String(user.shiftId) : null;
    let curShiftName = user.shift || null;

    for (const ch of changes) {
      const appliesToUser = (ch.userIds || []).some(id => String(id) === uidStr);
      if (!appliesToUser) continue;

      const isCurrentTarget =
        (curShiftId && ch.targetShiftId && String(ch.targetShiftId) === curShiftId) ||
        (!curShiftId && curShiftName && ch.targetShiftName && ch.targetShiftName === curShiftName) ||
        // Chain case: current step's from matches this earlier change's target
        (curShiftId && ch.targetShiftId && String(ch.targetShiftId) === curShiftId);

      if (!isCurrentTarget) continue;

      if (ch.fromShiftId) {
        curShiftId = String(ch.fromShiftId);
        try {
          const fromShift = asLean
            ? await Shift.findById(ch.fromShiftId).lean()
            : await Shift.findById(ch.fromShiftId);
          if (fromShift) curShiftName = fromShift.name;
        } catch { /* ignore */ }
      } else if (ch.fromShiftId === null || ch.fromShiftId === undefined) {
        // No from recorded — lineage break. Stop reverse walk.
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
