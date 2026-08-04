/**
 * Central RBAC engine.
 * All permission logic lives here — no hardcoding in routes or frontend.
 */
import { Department } from '@/lib/models/index';
import User from '@/lib/models/User';
import { rankOf } from './permissions';
export { MODULE_ACCESS, getAccess, hasAccess, ADMIN_ROLES, MANAGER_ROLES, rankOf } from './permissions';

// ── Cross-department visibility rules ──────────────────────────────────────────

/**
 * Returns the list of department names this user is allowed to view.
 * Returns null when the user has unrestricted access (admins/recruiters).
 * Cross-department visibility only applies to team_lead and team_admin roles.
 */
export async function getAccessibleDepartments(user) {
  if (['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return null;
  if (['team_lead', 'team_admin'].includes(user.role)) {
    const dept = await Department.findOne({ name: user.department }).select('visibleDepartments').lean().catch(() => null);
    if (dept?.visibleDepartments?.length) {
      return [user.department, ...dept.visibleDepartments];
    }
  }
  return [user.department];
}

/** True if the user is permitted to view employees in targetDepartment */
export async function canAccessDepartment(user, targetDepartment) {
  if (['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return true;
  if (!['team_lead', 'team_admin'].includes(user.role)) return false;
  const depts = await getAccessibleDepartments(user);
  return depts !== null && depts.includes(targetDepartment);
}

/**
 * Resolve the User IDs this user may view data for.
 * super_admin/admin_full/recruiter → null (unrestricted).
 * team_lead → active dept members with role intern/employee/team_admin, plus self.
 * team_admin → active dept members with role intern/employee, plus self.
 * Everyone else → only themselves.
 */
export async function getDepartmentUserIds(user) {
  if (['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return null;
  if (user.role === 'team_lead') {
    const depts = await getAccessibleDepartments(user);
    const members = await User.find({
      department: { $in: depts },
      status: 'active',
      role: { $in: ['intern', 'employee', 'team_admin'] },
    }).select('_id').lean();
    return [user._id, ...members.map(member => member._id)];
  }
  if (user.role === 'team_admin') {
    const depts = await getAccessibleDepartments(user);
    const members = await User.find({
      department: { $in: depts },
      status: 'active',
      role: { $in: ['intern', 'employee'] },
    }).select('_id').lean();
    return [user._id, ...members.map(member => member._id)];
  }
  return [user._id];
}

/** True if the user may view a specific target user (must include _id + department). */
export async function canViewUser(user, targetUser) {
  if (['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return true;
  if (['team_lead', 'team_admin'].includes(user.role)) {
    const depts = await getAccessibleDepartments(user);
    return depts !== null && depts.includes(targetUser?.department);
  }
  return targetUser?._id?.toString() === user._id.toString();
}

// ── Public helpers ────────────────────────────────────────────────────────────

/** True if the role can write/mutate in this module */
export function canWrite(role, module) {
  const level = getAccess(role, module);
  return ['full', 'limited', 'dept', 'team', 'self', 'assigned'].includes(level);
}

/** True if the role has full (unrestricted) access */
export function isFull(role, module) {
  return getAccess(role, module) === 'full';
}

/** IDs a user may manage for team-scoped work. Administrators receive null (unrestricted). */
export async function getManagedUserIds(user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return null;
  if (user.role === 'team_lead') {
    const members = await User.find({ teamLeadId: user._id, status: 'active' }).select('_id').lean();
    return [user._id, ...members.map(member => member._id)];
  }
  if (user.role === 'team_admin') {
    const members = await User.find({ teamAdminId: user._id, status: 'active' }).select('_id').lean();
    return [user._id, ...members.map(member => member._id)];
  }
  return [user._id];
}

/** True when a manager may assign or manage work for targetUserId. */
export async function canManageUser(user, targetUserId) {
  const managedIds = await getManagedUserIds(user);
  if (managedIds === null) return true;
  return managedIds.some(id => id.toString() === targetUserId.toString());
}

/**
 * True when the user may assign a task to assigneeUser.
 * Recruiters can never be assignees; assignment upward is blocked (equal allowed);
 * non-admins must also manage the assignee (same team).
 */
export async function canAssignTask(user, assigneeUser) {
  if (assigneeUser?.role === 'recruiter') return false;
  if (rankOf(assigneeUser?.role) > rankOf(user.role)) return false;
  if (['super_admin', 'admin_full'].includes(user.role)) return true;
  return canManageUser(user, assigneeUser._id);
}

/**
 * True when the user may edit details of / delete a task.
 * Legacy tasks without assignedBy may only be edited by super_admin/admin_full;
 * otherwise any user ranked at or above the task creator may edit.
 */
export function canEditTaskDetails(user, task) {
  if (!task.assignedBy) return ['super_admin', 'admin_full'].includes(user.role);
  return rankOf(user.role) >= rankOf(task.assignedBy?.role);
}
