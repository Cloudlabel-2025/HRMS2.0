import mongoose from 'mongoose';
import { Shift } from './models/index';
import ShiftDayOverride from './models/ShiftDayOverride';
import { shiftFromOverride, adjacentDate, scheduleDayAt } from './shift-schedule';
import { getTzTime, formatDateStr } from './timezone';

export async function loadDayOverrides(userIds, session = null) {
  const rows = userIds.length ? await ShiftDayOverride.find({ userId: { $in: userIds }, status: 'active' }).session(session).lean() : [];
  return new Map(rows.map(row => [`${row.userId}|${row.date}`, shiftFromOverride(row)]));
}

export async function resolveShiftAtTime(user, now) {
  const today = formatDateStr(now);
  const [current, previous] = await Promise.all([
    resolveShiftForDate(user, today), resolveShiftForDate(user, adjacentDate(today, -1)),
  ]);
  return scheduleDayAt(now, today, current, previous);
}

export async function resolveRecordShift(user, record) {
  if (record?.scheduleSnapshot?.startTime) return { ...record.scheduleSnapshot, _id: record.shiftId };
  return resolveShiftForDate(user, record.date);
}

// Request-local lookup tables: a report must not query shift history once for
// every employee/date. Do not cache across requests; assignments can change.
export async function createAttendanceShiftResolver(users) {
  const ids = [...new Set(users.map(user => String(user._id)).filter(Boolean))];
  const { ShiftChange } = await import('./models/index');
  const [shifts, changes, overrides] = await Promise.all([
    Shift.find({}).lean(),
    ids.length ? ShiftChange.find({ status: { $in: ['applied', 'pending'] }, userIds: { $in: ids } })
      .sort({ effectiveDate: -1, appliedAt: -1, createdAt: -1 }).lean().catch(() => []) : [],
    loadDayOverrides(ids),
  ]);
  const byId = new Map(shifts.map(shift => [String(shift._id), shift]));
  const byName = new Map();
  for (const shift of shifts) {
    if (!byName.has(shift.name)) byName.set(shift.name, shift);
  }
  const byUser = new Map(ids.map(id => [id, []]));
  for (const change of changes) {
    for (const id of change.userIds || []) byUser.get(String(id))?.push(change);
  }
  const current = user => byId.get(String(user?.shiftId)) || byName.get(user?.shift) || null;
  const forDate = (user, date) => {
    const uid = String(user?._id || '');
    if (overrides.has(`${uid}|${date}`)) return overrides.get(`${uid}|${date}`);
    const history = byUser.get(uid) || [];
    const latest = history.find(change => change.effectiveDate <= date);
    // Reversing the descending order also preserves the legacy ascending
    // appliedAt/createdAt tie-break for the first future assignment.
    const change = latest || [...history].reverse().find(change => change.effectiveDate > date);
    if (!change) return null;
    const assignment = (change.userAssignments || []).find(item => String(item.userId) === uid);
    const shiftId = latest ? assignment?.targetShiftId || change.targetShiftId
      : assignment?.fromShiftId || change.fromShiftId;
    const name = latest ? assignment?.targetShiftName || change.targetShiftName
      : assignment?.fromShiftName;
    const snapshot = latest ? assignment?.targetShiftSnapshot : assignment?.fromShiftSnapshot;
    if (snapshot?.startTime) return { ...snapshot, _id: shiftId || null };
    return byId.get(String(shiftId)) || byName.get(name) || null;
  };
  return { current, forDate };
}

export async function resolveShift(user, { asLean = true } = {}) {
  if (user?._id) return resolveShiftForDate(user, formatDateStr(await getTzTime()), { asLean });
  return resolveBaseShift(user, { asLean });
}

async function resolveBaseShift(user, { asLean = true } = {}) {
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
export async function resolveShiftForDate(user, dateStr, { asLean = true, fallbackToCurrent = true, ignoreDayOverride = false } = {}) {
  if (!user || !dateStr) return fallbackToCurrent ? resolveBaseShift(user, { asLean }) : null;
  // Do not swallow override lookup failures and silently use the wrong schedule.
  if (user._id && !ignoreDayOverride) {
    const override = await ShiftDayOverride.findOne({ userId: user._id, date: dateStr, status: 'active' }).lean();
    if (override) return shiftFromOverride(override);
  }
  try {
    const { ShiftChange } = await import('./models/index');
    const uidStr = String(user._id || user.id || '');
    if (!uidStr) return fallbackToCurrent ? resolveBaseShift(user, { asLean }) : null;

    // Per-user effective-dated assignment history is authoritative. It stores
    // each employee's own before/after shift, including mixed-target groups.
    const changes = await ShiftChange.find({
      status: { $in: ['applied', 'pending'] },
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
        status: { $in: ['applied', 'pending'] }, effectiveDate: { $gt: dateStr }, userIds: user._id,
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
    return fallbackToCurrent ? resolveBaseShift(user, { asLean }) : null;
  } catch {
    return fallbackToCurrent ? resolveBaseShift(user, { asLean }) : null;
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
