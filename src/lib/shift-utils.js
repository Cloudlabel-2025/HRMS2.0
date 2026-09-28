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
export async function resolveShiftForDate(user, dateStr, { asLean = true, fallbackToCurrent = true } = {}) {
  if (!user || !dateStr) return fallbackToCurrent ? resolveShift(user, { asLean }) : null;
  try {
    const { ShiftChange } = await import('./models/index');
    const uidStr = String(user._id || user.id || '');
    if (!uidStr) return fallbackToCurrent ? resolveShift(user, { asLean }) : null;

    // Per-user effective-dated assignment history is authoritative. It stores
    // each employee's own before/after shift, including mixed-target groups.
    const changes = await ShiftChange.find({
      status: 'applied',
      effectiveDate: { $lte: dateStr },
      userIds: user._id,
    }).sort({ effectiveDate: -1, appliedAt: -1, createdAt: -1 }).lean().catch(() => []);

    const assignmentFor = (change) => (change.userAssignments || []).find(a => String(a.userId) === uidStr);
    let shiftId = null;
    let shiftName = '';
    let shiftSnapshot = null;
    const latest = changes.find(c => c.effectiveDate <= dateStr);
    if (latest) {
      const assignment = assignmentFor(latest);
      shiftId = assignment?.targetShiftId || latest.targetShiftId;
      shiftName = assignment?.targetShiftName || latest.targetShiftName;
      shiftSnapshot = assignment?.targetShiftSnapshot || null;
    } else {
      // Before the first recorded change, use that change's employee-specific
      // prior shift (legacy rows use the group-level fromShiftId).
      const firstFuture = await ShiftChange.findOne({
        status: 'applied', effectiveDate: { $gt: dateStr }, userIds: user._id,
      }).sort({ effectiveDate: 1, appliedAt: 1, createdAt: 1 }).lean().catch(() => null);
      if (firstFuture) {
        const assignment = assignmentFor(firstFuture);
        shiftId = assignment?.fromShiftId || firstFuture.fromShiftId || null;
        shiftName = assignment?.fromShiftName || '';
        shiftSnapshot = assignment?.fromShiftSnapshot || null;
      }
    }

    if (shiftSnapshot?.startTime) return { ...shiftSnapshot, _id: shiftId || null };
    if (shiftId) {
      const shift = asLean ? await Shift.findById(shiftId).lean() : await Shift.findById(shiftId);
      if (shift) return shift;
    }
    if (shiftName) {
      const shift = asLean ? await Shift.findOne({ name: shiftName }).lean() : await Shift.findOne({ name: shiftName });
      if (shift) return shift;
    }
    return fallbackToCurrent ? resolveShift(user, { asLean }) : null;
  } catch {
    return fallbackToCurrent ? resolveShift(user, { asLean }) : null;
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
