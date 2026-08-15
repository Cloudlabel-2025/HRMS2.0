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

export function canApproveLeave(user, requester) {
  if (!user || !requester || String(user._id) === String(requester._id)) return false;
  if (['super_admin', 'admin_full'].includes(user.role)) return true;
  if (!user.department || user.department !== requester.department) return false;
  if (user.role === 'team_lead') return ['team_admin', 'employee', 'intern'].includes(requester.role);
  if (user.role === 'team_admin') return ['intern', 'employee'].includes(requester.role);
  return false;
}

// ── Cross-department project approval rules ───────────────────────────────────

/**
 * True when `user` (team_lead/team_admin) is requesting a project that spans
 * departments beyond their own — such projects require super_admin/admin_full
 * approval. The project may be a plain object with `departments` and/or a
 * `team` of populated users.
 */
export async function isCrossDeptProject(user, project) {
  if (!['team_lead', 'team_admin'].includes(user.role)) return false;
  const departments = Array.isArray(project?.departments) ? project.departments : [];
  if (departments.some(dept => dept && dept !== user.department)) return true;
  const team = Array.isArray(project?.team) ? project.team : [];
  for (const member of team) {
    const memberDept = member && typeof member === 'object' ? member.department : null;
    if (memberDept && memberDept !== user.department) return true;
  }
  return false;
}

/** Active super_admin + admin_full _ids, used to notify project approval reviewers. */
export async function getApproverIds() {
  const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
  return admins.map(admin => admin._id);
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
    const members = await User.find({
      department: user.department,
      status: 'active',
      role: { $in: ['team_admin', 'employee', 'intern'] },
    }).select('_id').lean();
    return [user._id, ...members.map(member => member._id)];
  }
  if (user.role === 'team_admin') {
    const members = await User.find({
      department: user.department,
      status: 'active',
      role: { $in: ['employee', 'intern'] },
    }).select('_id').lean();
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
 * Recruiters can never be assignees. Admins may assign cross-department
 * (admin_full up to but not including super_admin); team leads/admins are
 * strictly limited to their own department and allowed subordinate roles.
 */
export async function canAssignTask(user, assigneeUser) {
  if (assigneeUser?.role === 'recruiter') return false;
  if (user.role === 'super_admin') return true;
  if (user.role === 'admin_full') return rankOf(assigneeUser?.role) < rankOf(user.role);
  if (user.role === 'team_lead') {
    return !!user.department && user.department === assigneeUser?.department && ['team_admin', 'employee', 'intern'].includes(assigneeUser?.role);
  }
  if (user.role === 'team_admin') {
    return !!user.department && user.department === assigneeUser?.department && ['employee', 'intern'].includes(assigneeUser?.role);
  }
  return false;
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

// ── Regularization approval matrix ────────────────────────────────────────────

/**
 * True when `user` may approve a regularization request submitted by `requester`.
 *
 *   Requester     | Approvers
 *   ------------- | ------------------------------------------------
 *   admin_full    | super_admin
 *   team_lead     | super_admin, admin_full (never self/other leads)
 *   team_admin    | own-department team_lead, admin_full, super_admin
 *   employee/intern/sme | own-department team_admin + team_lead, admin_full, super_admin
 *
 * Self-approval is never allowed. Team roles may never approve cross-department.
 */
export async function canApproveRegularization(user, requester) {
  if (!requester) return false;
  if (String(user._id) === String(requester._id)) return false;

  const rRole = requester.role;
  if (rRole === 'admin_full') return user.role === 'super_admin';
  if (rRole === 'team_lead') return ['super_admin', 'admin_full'].includes(user.role);
  if (rRole === 'team_admin') {
    if (['super_admin', 'admin_full'].includes(user.role)) return true;
    return user.role === 'team_lead' && user.department === requester.department;
  }
  if (['super_admin', 'admin_full'].includes(user.role)) return true;
  if (['team_lead', 'team_admin'].includes(user.role)) {
    return user.department === requester.department;
  }
  return false;
}

/**
 * Returns active approver _ids for a regularization request from `requester`,
 * so notifications only reach reviewers who may actually act on it.
 */
export async function getRegularizationApproverIds(requester) {
  if (!requester) return [];
  const selfId = String(requester._id);
  const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
  const collect = (users) => users.map(u => u._id).filter(id => id.toString() !== selfId);

  switch (requester.role) {
    case 'admin_full':
      return collect(admins.filter(u => u.role === 'super_admin'));
    case 'team_lead':
      return collect(admins);
    case 'team_admin': {
      const leads = await User.find({ role: 'team_lead', department: requester.department, status: 'active' }).select('_id').lean();
      return collect([...admins, ...leads]);
    }
    default: { // employee, intern, sme, etc.
      const teams = await User.find({
        role: { $in: ['team_lead', 'team_admin'] },
        department: requester.department,
        status: 'active',
      }).select('_id').lean();
      return collect([...admins, ...teams]);
    }
  }
}
