import { connectDB } from '@/lib/db';
import { Task, Project } from '@/lib/models/Task';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import User from '@/lib/models/User';
import { hasAccess, getManagedUserIds, canAssignTask } from '@/lib/rbac';
import { Notification } from '@/lib/models/index';

async function getTaskStakeholders(assigneeId, actorId) {
  const [assignee, admins] = await Promise.all([
    User.findById(assigneeId).select('teamLeadId teamAdminId').lean(),
    User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean(),
  ]);
  const ids = [assigneeId, assignee?.teamLeadId, assignee?.teamAdminId, ...admins.map(admin => admin._id)]
    .filter(Boolean)
    .map(id => id.toString());
  return [...new Set(ids)].filter(id => id !== actorId.toString());
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'tasks')) return fail('Access denied', 403);
    await connectDB();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const scope     = searchParams.get('scope'); // 'my' | 'all'

    const query = {};
    if (projectId) query.projectId = projectId;

    if (scope === 'my' || ['employee', 'intern', 'recruiter'].includes(user.role)) {
      query.assignedTo = user._id;
    } else {
      const ids = await getManagedUserIds(user);
      if (ids) query.$or = [{ assignedTo: { $in: ids } }, { assignedBy: user._id }];
    }

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name avatar')
      .populate('assignedBy', 'name role')
      .populate('projectId', 'name departments')
      .sort({ createdAt: -1 });

    return ok(tasks);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) {
      return fail('Access denied', 403);
    }
    await connectDB();
    const ip = req.headers.get('x-forwarded-for') || '';
    const body = await req.json();

    if (!body.title) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: title is required', 'low', ip, null, user._id);
      return fail('Task title is required', 400);
    }
    if (body.title.length > 30 || !body.title.trim()) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: invalid title', 'low', ip, null, user._id);
      return fail('Task title must be between 1 and 30 characters', 400);
    }
    if (!body.description) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: description is required', 'low', ip, null, user._id);
      return fail('Task description is required', 400);
    }
    if (!body.projectId) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: project is required', 'low', ip, null, user._id);
      return fail('Project is required', 400);
    }
    if (!body.assignedTo) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: assignedTo is required', 'low', ip, null, user._id);
      return fail('Assigned user is required', 400);
    }
    if (!body.priority) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: priority is required', 'low', ip, null, user._id);
      return fail('Priority is required', 400);
    }
    if (!body.status) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: status is required', 'low', ip, null, user._id);
      return fail('Status is required', 400);
    }
    if (!body.due) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: due date is required', 'low', ip, null, user._id);
      return fail('Due date is required', 400);
    }

    // Validate due date is within project's date range
    const taskProject = await Project.findById(body.projectId).select('startDate endDate team departments approvalRequired approvalStatus createdBy').lean();
    if (!taskProject) return fail('Project not found', 404);
    const managedIds = await getManagedUserIds(user);
    const projectStakeholder = String(taskProject.createdBy) === String(user._id) || (Array.isArray(taskProject.departments) && taskProject.departments.includes(user.department));
    const crossDeptApproved = taskProject.approvalRequired === true && taskProject.approvalStatus === 'approved' && projectStakeholder;
    if (managedIds !== null && !crossDeptApproved && !taskProject.team.some(memberId => managedIds.some(id => id.toString() === memberId.toString()))) {
      return fail('Access denied', 403);
    }
    if (taskProject) {
      if (body.due < taskProject.startDate) {
        return fail(`Due date cannot be before project start date (${taskProject.startDate})`, 400);
      }
      if (body.due > taskProject.endDate) {
        return fail(`Due date cannot be after project end date (${taskProject.endDate})`, 400);
      }
    }

    const assignee = await User.findById(body.assignedTo).select('role name department status').lean();
    if (!assignee) return fail('Assigned user not found', 404);
    if (assignee.status !== 'active') return fail('Tasks can only be assigned to active employees', 400);
    let canAssign = await canAssignTask(user, assignee);
    if (!canAssign && ['team_lead', 'team_admin'].includes(user.role) && taskProject.approvalRequired === true && taskProject.approvalStatus === 'approved' && projectStakeholder) {
      const projectDepts = Array.isArray(taskProject.departments) ? taskProject.departments : [];
      const roleOk = user.role === 'team_lead'
        ? ['team_admin', 'employee', 'intern'].includes(assignee.role)
        : ['employee', 'intern'].includes(assignee.role);
      if (roleOk && projectDepts.includes(assignee.department)) canAssign = true;
    }
    if (!canAssign) {
      auditLog('Task Create Failed', 'Tasks', user._id, `Attempted to assign task to invalid assignee (${body.assignedTo})`, 'low', ip, null, user._id);
      return fail('You can only assign tasks to team members of equal or lower rank', 403);
    }

    const task = await Task.create({ ...body, assignedBy: user._id, statusHistory: [{ status: body.status, changedAt: new Date(), changedBy: user._id }] });
    const recipientIds = await getTaskStakeholders(body.assignedTo, user._id);
    if (recipientIds.length) await Notification.insertMany(recipientIds.map(userId => ({ userId, title: 'New Task Assigned', message: `Task assigned: ${task.title}. Due ${task.due}.`, type: 'general', refId: task._id })));
    await task.populate('assignedTo', 'name avatar');
    auditLog('Task Created', 'Tasks', user._id, `Created task "${body.title}" assigned to ${assignee?.name || 'unknown'}`, 'low', ip, null, body.assignedTo);
    return ok(task, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
