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

function parseList(str) {
  return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
}

function toIdStr(id) {
  return id && typeof id.toString === 'function' ? id.toString() : String(id || '');
}

/**
 * Resolve the target User _ids for a set of filters.
 * Base set: active, non-super_admin users. Filters are AND-ed, then explicit
 * userIds are unioned in.
 */
export async function computeTargetUserIds({ userIds = [], departments = [], roles = [], fromShiftId = null } = {}) {
  await connectDB();
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
  const explicit = (userIds || []).map(toIdStr).filter(Boolean);
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
  });

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
  const today = todayStr();
  const due = await ShiftChange.find({ status: 'pending', effectiveDate: { $lte: today } });
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

    const today = todayStr();
    const due = await ShiftChange.find({ status: 'pending', effectiveDate: { $lte: today } });
    let appliedForUser = 0;

    for (const change of due) {
      if (!(await userMatchesChange(user, change))) continue;

      // Skip users already on the target shift (prevents repeat notifications)
      if (
        user.shiftId && change.targetShiftId &&
        toIdStr(user.shiftId) === toIdStr(change.targetShiftId)
      ) continue;
      if (!user.shiftId && user.shift && user.shift === change.targetShiftName) continue;

      const shiftDoc = await Shift.findById(change.targetShiftId).lean();
      if (!shiftDoc) continue;

      const count = await applyShiftToUsers([user._id], shiftDoc, null, '', change.reason);
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
  if ((change.userIds || []).some(id => toIdStr(id) === uid)) return true;

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
