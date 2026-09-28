import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { Employee, Shift, ShiftChange } from '@/lib/models/index';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/middleware';

/**
 * Shared helpers for bulk / scheduled shift assignment.
 *
 * A shift change must land on all three shift sources:
 *   - User.shift / User.shiftId (auth)
 *   - legacy Employee.shift / Employee.shiftId (matched by userId)
 *   - EmpProfile.shift / EmpProfile.shiftId (matched via User.identityId)
 */

export function todayStr(now = new Date()) {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// Timezone-aware today (Asia/Kolkata by default via SystemConfig).
// Falls back to host-local todayStr() when TZ resolution fails so
// scheduled changes still apply rather than stalling.
export async function todayStrTz() {
  try {
    const { getTzDateStr } = await import('@/lib/timezone');
    return await getTzDateStr();
  } catch {
    return todayStr();
  }
}

function parseList(str) {
  return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function toIdStr(id) {
  return id && typeof id.toString === 'function' ? id.toString() : String(id || '');
}

/** Return the prior shift only when every targeted user shares one shift. */
export async function inferCommonFromShiftId(userIds = []) {
  const ids = (userIds || []).map(toIdStr).filter(Boolean);
  if (!ids.length) return null;
  const users = await User.find({ _id: { $in: ids } }).select('shiftId shift').lean();
  if (users.length !== ids.length) return null;
  const shiftKeys = new Set(users.map(u => u.shiftId ? `id:${toIdStr(u.shiftId)}` : `name:${u.shift || ''}`));
  if (shiftKeys.size !== 1) return null;
  const only = users[0];
  if (only.shiftId) return only.shiftId;
  if (!only.shift) return null;
  const shift = await Shift.findOne({ name: only.shift }).select('_id').lean().catch(() => null);
  return shift?._id || null;
}

export async function snapshotUserShiftAssignments(userIds = [], targetShift) {
  await connectDB();
  const ids = (userIds || []).map(toIdStr).filter(Boolean);
  const users = await User.find({ _id: { $in: ids } }).select('_id shiftId shift').lean();
  const idsByName = new Map();
  const names = [...new Set(users.map(u => u.shift).filter(Boolean))];
  const priorIds = users.map(u => u.shiftId).filter(Boolean);
  if (names.length) {
    const shifts = await Shift.find({ $or: [{ name: { $in: names } }, { _id: { $in: priorIds } }] }).lean();
    for (const shift of shifts) {
      idsByName.set(shift.name, shift._id);
      idsByName.set(`id:${toIdStr(shift._id)}`, shift);
    }
  } else if (priorIds.length) {
    const shifts = await Shift.find({ _id: { $in: priorIds } }).lean();
    for (const shift of shifts) idsByName.set(`id:${toIdStr(shift._id)}`, shift);
  }
  const snapshot = (shift, name = '') => shift ? {
    name: shift.name || name,
    startTime: shift.startTime || '', endTime: shift.endTime || '',
    expectedHours: shift.expectedHours ?? 480, absentThreshold: shift.absentThreshold ?? 240,
    lateThreshold: shift.lateThreshold ?? 15, earlyLoginWindow: shift.earlyLoginWindow ?? 120,
    breaks: shift.breaks || [], autoLogoutAfterShiftEnd: shift.autoLogoutAfterShiftEnd ?? 360,
    halfDayThreshold: shift.halfDayThreshold ?? 180,
  } : null;
  return users.map(u => ({
    userId: u._id,
    fromShiftId: u.shiftId || idsByName.get(u.shift) || null,
    fromShiftName: u.shift || '',
    fromShiftSnapshot: snapshot(idsByName.get(`id:${toIdStr(u.shiftId)}`) || idsByName.get(u.shift), u.shift),
    targetShiftId: targetShift._id,
    targetShiftName: targetShift.name,
    targetShiftSnapshot: snapshot(targetShift),
  }));
}

/**
 * Resolve the target User _ids for a set of filters.
 * Base set: active, non-super_admin users. Filters are AND-ed, then explicit
 * userIds are unioned in.
 *
 * When exactUserIds is true, ONLY the explicit userIds are targeted (still
 * filtered to active, non-super_admin users and optionally to fromShiftId).
 */
export async function computeTargetUserIds({ userIds = [], departments = [], roles = [], fromShiftId = null, exactUserIds = false } = {}) {
  await connectDB();
  const explicit = (userIds || []).map(toIdStr).filter(Boolean);

  if (exactUserIds) {
    if (!explicit.length) return [];
    const query = { _id: { $in: explicit }, status: 'active', role: { $ne: 'super_admin' } };
    if (fromShiftId) {
      const fromShift = await Shift.findById(fromShiftId).lean().catch(() => null);
      if (fromShift) {
        query.$or = [{ shiftId: fromShift._id }, { shift: fromShift.name }];
      } else {
        query.shiftId = fromShiftId;
      }
    }
    const users = await User.find(query).select('_id').lean();
    return users.map(u => toIdStr(u._id));
  }

  const query = { status: 'active', role: { $ne: 'super_admin' } };

  if (Array.isArray(departments) && departments.length) {
    query.department = { $in: departments };
  }
  if (Array.isArray(roles) && roles.length) {
    query.role = { $in: roles };
  }
  if (fromShiftId) {
    // Resolve the shift name so both shiftId and legacy shift-name matches work
    const fromShift = await Shift.findById(fromShiftId).lean().catch(() => null);
    if (fromShift) {
      query.$or = [{ shiftId: fromShift._id }, { shift: fromShift.name }];
    } else {
      query.shiftId = fromShiftId;
    }
  }

  const users = await User.find(query).select('_id').lean();
  const ids = new Set(users.map(u => toIdStr(u._id)));

  if (Array.isArray(departments) && departments.length) {
    const empUsers = await Employee.find({ department: { $in: departments } }).select('userId').lean();
    const empIds = empUsers.map(e => e?.userId && toIdStr(e.userId)).filter(Boolean);
    if (empIds.length) {
      const valid = await User.find({ _id: { $in: empIds }, status: 'active', role: { $ne: 'super_admin' } }).select('_id').lean();
      for (const v of valid) ids.add(toIdStr(v._id));
    }

    const profUsers = await EmpProfile.find({ department: { $in: departments } }).select('identityId').lean();
    const profIdentityIds = profUsers.map(p => p.identityId && toIdStr(p.identityId)).filter(Boolean);
    if (profIdentityIds.length) {
      const valid = await User.find({ identityId: { $in: profIdentityIds }, status: 'active', role: { $ne: 'super_admin' } }).select('_id').lean();
      for (const v of valid) ids.add(toIdStr(v._id));
    }
  }

  // Explicit picks are merged in, but the employer account (super_admin) is always excluded
  if (explicit.length) {
    const bad = await User.find({ _id: { $in: explicit }, role: 'super_admin' }).select('_id').lean();
    const badIds = new Set(bad.map(u => toIdStr(u._id)));
    for (const s of explicit) if (!badIds.has(s)) ids.add(s);
  }

  return [...ids];
}

/**
 * Apply a shift to the given User ids across all three stores, notify each
 * user (reason included), and write an audit entry. Returns the applied count.
 */
export async function applyShiftToUsers(userIds, shiftDoc, actorUser = null, ip = '', reason = '') {
  await connectDB();
  const idStrs = (userIds || []).map(toIdStr).filter(Boolean);
  if (!idStrs.length) return 0;

  // 1. Auth users
  await User.updateMany(
    { _id: { $in: idStrs } },
    { $set: { shift: shiftDoc.name, shiftId: shiftDoc._id } }
  );

  // 2. Legacy employees
  await Employee.updateMany(
    { userId: { $in: idStrs } },
    { $set: { shift: shiftDoc.name, shiftId: shiftDoc._id } }
  );

  // 3. Core profiles (best-effort) — matched via User.identityId
  try {
    const authUsers = await User.find({ _id: { $in: idStrs } }).select('identityId').lean();
    const identityIds = authUsers.map(u => u.identityId).filter(Boolean);
    if (identityIds.length) {
      await EmpProfile.updateMany(
        { identityId: { $in: identityIds } },
        { $set: { shift: shiftDoc.name, shiftId: shiftDoc._id } }
      );
    }
  } catch (e) {
    console.error('EmpProfile shift sync failed (non-fatal):', e.message);
  }

  // Notify each affected user — message includes the reason
  const affected = await User.find({ _id: { $in: idStrs } }).select('_id name').lean();
  try {
    await notify(
      affected.map(u => u._id),
      'Shift Changed',
      `Your shift has been changed to ${shiftDoc.name} (${shiftDoc.startTime} - ${shiftDoc.endTime}).${reason ? ` Reason: ${reason}` : ''}`,
      'shift',
      shiftDoc._id
    );
  } catch (e) {
    console.error('Shift change notification failed:', e.message);
  }

  try {
    await auditLog(
      'Shift Assigned (Bulk)',
      'Shifts',
      actorUser?._id || null,
      `Applied shift "${shiftDoc.name}" to ${affected.length} user(s). Reason: ${reason || '(none)'}`,
      'medium',
      ip || '',
      null,
      null
    );
  } catch (e) {
    console.error('Shift change audit log failed:', e.message);
  }

  return affected.length;
}

/**
 * Apply a pending ShiftChange to every currently-matching user and mark it
 * applied. Idempotent: a change that is no longer 'pending' is a no-op.
 */
export async function applyShiftChange(changeId, actorUser = null, ip = '') {
  await connectDB();
  const change = await ShiftChange.findById(changeId);
  if (!change || change.status !== 'pending') return 0;

  const shiftDoc = await Shift.findById(change.targetShiftId);
  if (!shiftDoc) throw new Error('Target shift not found');

  // Recompute targets at apply time so new hires / recent moves are included
  const userIds = await computeTargetUserIds({
    userIds: change.userIds || [],
    departments: parseList(change.departments),
    roles: parseList(change.roles),
    fromShiftId: change.fromShiftId || null,
    exactUserIds: !!change.exactUserIds,
  });

  change.userAssignments = await snapshotUserShiftAssignments(userIds, shiftDoc);
  change.userIds = userIds;

  // Keep usable lineage even when the assignment form omitted its optional
  // source-shift filter. Infer it only for a homogeneous target group.
  if (!change.fromShiftId) {
    change.fromShiftId = await inferCommonFromShiftId(userIds);
  }

  const count = await applyShiftToUsers(userIds, shiftDoc, actorUser, ip, change.reason);

  change.status = 'applied';
  change.appliedAt = new Date();
  change.appliedCount = count;
  await change.save();

  return count;
}

/**
 * Apply every pending change whose effectiveDate is today or earlier.
 * Returns the total number of users whose shift changed.
 */
export async function applyDueShiftChanges() {
  await connectDB();
  const today = await todayStrTz();
  const due = await ShiftChange.find({ status: 'pending', effectiveDate: { $lte: today } }).sort({ effectiveDate: 1, createdAt: 1 });
  let total = 0;
  for (const change of due) {
    try {
      total += await applyShiftChange(change._id, null, '');
    } catch (e) {
      console.error('Due shift change failed:', change._id, e.message);
    }
  }
  return total;
}

/**
 * Per-user lazy fallback (called from the attendance clock-in route). Applies
 * any pending due change that covers this user, updating only their three
 * records. Never throws — failures are logged and swallowed.
 */
export async function applyDueShiftChangesForUser(user) {
  try {
    if (!user?._id) return 0;
    await connectDB();

    const today = await todayStrTz();
    const due = await ShiftChange.find({ status: 'pending', effectiveDate: { $lte: today } }).sort({ effectiveDate: 1, createdAt: 1 });
    let appliedForUser = 0;

    for (const change of due) {
      if (!(await userMatchesChange(user, change))) continue;

      // Apply the whole effective-dated change so the audit event and per-user
      // before/after snapshots are recorded before clock-in uses the new shift.
      const count = await applyShiftChange(change._id, null, '');
      if (count > 0) appliedForUser += count;
    }

    return appliedForUser;
  } catch (e) {
    console.error('applyDueShiftChangesForUser failed (non-fatal):', e.message);
    return 0;
  }
}

/**
 * True when a user is covered by a change: either explicitly listed in
 * userIds, or matching every non-empty department/role/fromShift filter.
 */
export async function userMatchesChange(user, change) {
  const uid = toIdStr(user?._id);
  const listed = (change.userIds || []).some(id => toIdStr(id) === uid);
  if (listed) return true;

  if (change.exactUserIds) return false;
  if (!user || user.role === 'super_admin' || user.status !== 'active') return false;

  const depts = parseList(change.departments);
  if (depts.length && !depts.includes(user.department)) return false;

  const roles = parseList(change.roles);
  if (roles.length && !roles.includes(user.role)) return false;

  if (change.fromShiftId) {
    if (user.shiftId && toIdStr(user.shiftId) === toIdStr(change.fromShiftId)) return true;
    const fromShift = await Shift.findById(change.fromShiftId).lean().catch(() => null);
    if (fromShift && user.shift === fromShift.name) return true;
    return false;
  }

  return true;
}
