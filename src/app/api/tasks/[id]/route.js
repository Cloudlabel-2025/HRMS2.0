import { connectDB } from '@/lib/db';
import { Task, Project } from '@/lib/models/Task';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { canManageUser, getManagedUserIds, canEditTaskDetails } from '@/lib/rbac';
import User from '@/lib/models/User';
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

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const task = await Task.findById(id).populate('assignedBy', 'name role');
    if (!task) return fail('Task not found', 404);

    const MANAGER_ROLES = ['super_admin', 'admin_full', 'team_admin', 'team_lead'];

    if (body.action === 'add_activity') {
      const comment = String(body.comment || '').trim();
      if (!comment || comment.length > 2000) return fail('Comment is required and must be 2000 characters or fewer', 400);
      const canUpdate = MANAGER_ROLES.includes(user.role) ? await canManageUser(user, task.assignedTo) : task.assignedTo.toString() === user._id.toString();
      if (!canUpdate) return fail('Access denied', 403);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : new Date().toISOString().slice(0, 10);
      const updated = await Task.findByIdAndUpdate(id, { $push: { activityLog: { date, comment, addedBy: user._id } } }, { new: true }).populate('assignedTo', 'name avatar').populate('projectId', 'name');
      auditLog('Task Activity Added', 'Tasks', user._id, `Added an activity update to task "${task.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, task.assignedTo);
      return ok(updated);
    }

    // Status-only update — any role can do this
    if (Object.keys(body).length === 1 && body.status) {
      if (!['To Do', 'In Progress', 'Pending', 'Completed', 'Blocked'].includes(body.status)) return fail('Invalid task status', 400);
      // Employees/interns can only update their own tasks
      if (!MANAGER_ROLES.includes(user.role)) {
        if (task.assignedTo.toString() !== user._id.toString()) return fail('Access denied', 403);
      }
      if (MANAGER_ROLES.includes(user.role) && !await canManageUser(user, task.assignedTo)) return fail('Access denied', 403);
      // Only managers can block a task
      if (body.status === 'Blocked' && !MANAGER_ROLES.includes(user.role)) {
        return fail('Only team leads and admins can block a task', 403);
      }
      if (body.status === 'Completed' && !MANAGER_ROLES.includes(user.role)) {
        return fail('Employees must move tasks to Pending for manager completion', 403);
      }
      const updated = await Task.findByIdAndUpdate(id, { status: body.status, $push: { statusHistory: { status: body.status, changedAt: new Date(), changedBy: user._id } } }, { new: true })
        .populate('assignedTo', 'name avatar').populate('projectId', 'name');
      const recipientIds = await getTaskStakeholders(task.assignedTo, user._id);
      if (recipientIds.length) await Notification.insertMany(recipientIds.map(userId => ({ userId, title: body.status === 'Pending' ? 'Task Pending Review' : 'Task Status Updated', message: `${task.title} was moved to ${body.status} by ${user.name}.`, type: 'general', refId: task._id })));
      auditLog('Task Status Updated', 'Tasks', user._id, `Updated task "${task.title}" status to ${body.status}`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
      return ok(updated);
    }

    // Full update — manager/admin only, subject to creator hierarchy
    if (!MANAGER_ROLES.includes(user.role)) return fail('Access denied', 403);
    if (task.assignedTo?.toString() === user._id.toString()) return fail('Access denied', 403);
    if (!canEditTaskDetails(user, task)) return fail('Access denied', 403);
    if (!body.title || !body.description || !body.projectId || !body.assignedTo || !body.priority || !body.due) {
      return fail('All fields are required', 400);
    }
    if (body.title.length > 30 || !body.title.trim()) {
      return fail('Task title must be between 1 and 30 characters', 400);
    }

    // Validate due date is within project's date range
    const taskProject = await Project.findById(body.projectId).select('startDate endDate team').lean();
    if (!taskProject) return fail('Project not found', 404);
    const managedIds = await getManagedUserIds(user);
    if (managedIds !== null && !taskProject.team.some(memberId => managedIds.some(id => id.toString() === memberId.toString()))) {
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

    const statusChanged = body.status && body.status !== task.status;
    const update = statusChanged
      ? {
          $set: body,
          $push: { statusHistory: { status: body.status, changedAt: new Date(), changedBy: user._id } },
        }
      : body;
    const updated = await Task.findByIdAndUpdate(id, update, { new: true })
      .populate('assignedTo', 'name avatar').populate('projectId', 'name');
    if (statusChanged) {
      const recipientIds = await getTaskStakeholders(task.assignedTo, user._id);
      if (recipientIds.length) await Notification.insertMany(recipientIds.map(userId => ({
        userId,
        title: body.status === 'Pending' ? 'Task Pending Review' : 'Task Status Updated',
        message: `${task.title} was moved to ${body.status} by ${user.name}.`,
        type: 'general',
        refId: task._id,
      })));
    }
    auditLog('Task Updated', 'Tasks', user._id, `Updated task "${task.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, task.assignedTo);
    return ok(updated);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full','team_admin','team_lead'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const task = await Task.findById(id).populate('assignedBy', 'name role');
    if (!task) return fail('Task not found', 404);
    if (!canEditTaskDetails(user, task)) return fail('Access denied', 403);
    await Task.findByIdAndDelete(id);
    auditLog('Task Deleted', 'Tasks', user._id, `Deleted task "${task.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, task.assignedTo);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
