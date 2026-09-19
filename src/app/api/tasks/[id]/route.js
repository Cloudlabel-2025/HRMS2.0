import { connectDB } from '@/lib/db';
import { Task, Project } from '@/lib/models/Task';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { canManageUser, getManagedUserIds, canEditTaskDetails } from '@/lib/rbac';
import User from '@/lib/models/User';
import { Notification } from '@/lib/models/index';
import { getTaskStakeholders } from '@/lib/taskUtils';

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const task = await Task.findById(id).populate('assignedBy', 'name role');
    if (!task || task.deletedAt) return fail('Task not found', 404);

    const MANAGER_ROLES = ['super_admin', 'admin_full', 'team_admin', 'team_lead'];

    if (body.action === 'add_activity') {
      const comment = String(body.comment || '').trim();
      if (!comment || comment.length > 2000) return fail('Comment is required and must be 2000 characters or fewer', 400);
      const canUpdate = MANAGER_ROLES.includes(user.role) ? await canManageUser(user, task.assignedTo) : task.assignedTo.toString() === user._id.toString();
      if (!canUpdate) return fail('Access denied', 403);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? body.date : new Date().toISOString().slice(0, 10);
      const updated = await Task.findByIdAndUpdate(id, { $push: { activityLog: { date, comment, addedBy: user._id } } }, { new: true }).populate('assignedTo', 'name avatar').populate('projectId', 'name');
      const recipientIds = await getTaskStakeholders(task.assignedTo, user._id);
      if (recipientIds.length) await Notification.insertMany(recipientIds.map(userId => ({
        userId,
        title: 'New Task Comment',
        message: `${user.name} commented on task "${task.title}": ${comment.slice(0, 80)}${comment.length > 80 ? '...' : ''}`,
        type: 'general',
        refId: task._id,
      })));
      auditLog('Task Activity Added', 'Tasks', user._id, `Added an activity update to task "${task.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, task.assignedTo);
      return ok(updated);
    }

    // Status-only update — any role can do this
    const statusKeys = Object.keys(body).filter(k => body[k] !== undefined);
    if (statusKeys.length === 1 && statusKeys[0] === 'status' && body.status) {
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
      // Optimistic-concurrency: only transition from the status the client saw
      const expectedFrom = body.expectedFrom;
      const statusFilter = expectedFrom ? { _id: id, status: expectedFrom } : { _id: id };
      const updated = await Task.findOneAndUpdate(statusFilter, { status: body.status, $push: { statusHistory: { status: body.status, changedAt: new Date(), changedBy: user._id } } }, { new: true })
        .populate('assignedTo', 'name avatar').populate('projectId', 'name');
      if (!updated) return fail('Task was updated by someone else. Please refresh and retry.', 409);
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

    const nextAssignee = await User.findById(body.assignedTo).select('status').lean();
    if (!nextAssignee) return fail('Assigned user not found', 404);
    if (nextAssignee.status !== 'active') return fail('Tasks can only be assigned to active employees', 400);

    // Validate due date is within project's date range
    const taskProject = await Project.findById(body.projectId).select('startDate endDate team departments approvalRequired approvalStatus createdBy').lean();
    if (!taskProject) return fail('Project not found', 404);
    const managedIds = await getManagedUserIds(user);
    const projectStakeholder = String(taskProject.createdBy) === String(user._id) || (Array.isArray(taskProject.departments) && taskProject.departments.includes(user.department));
    const crossDeptApproved = taskProject.approvalRequired === true && taskProject.approvalStatus === 'approved' && projectStakeholder;
    if (managedIds !== null && !crossDeptApproved && !taskProject.team.some(memberId => managedIds.some(id => id.toString() === memberId.toString()))) {
      return fail('Access denied', 403);
    }
    // Block full-update status bypass — same Blocked/Completed rules as status-only
    if (body.status === 'Blocked' && !MANAGER_ROLES.includes(user.role)) {
      return fail('Only team leads and admins can block a task', 403);
    }
    if (taskProject.approvalRequired === true && taskProject.approvalStatus !== 'approved') {
      return fail('Project is pending approval and cannot accept task updates yet', 403);
    }
    if (taskProject) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.due || ''))) {
        return fail('Due date must be YYYY-MM-DD', 400);
      }
      const dueD = new Date(`${body.due}T00:00:00`);
      if (Number.isNaN(dueD.getTime())) return fail('Invalid due date', 400);
      if (dueD < new Date(`${taskProject.startDate}T00:00:00`)) {
        return fail(`Due date cannot be before project start date (${taskProject.startDate})`, 400);
      }
      if (dueD > new Date(`${taskProject.endDate}T00:00:00`)) {
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
    if (!task || task.deletedAt) return fail('Task not found', 404);
    if (!canEditTaskDetails(user, task)) return fail('Access denied', 403);

    // Verify user belongs to the project team (or cross-dept approved)
    const taskProject = await Project.findById(task.projectId).select('team departments approvalRequired approvalStatus createdBy').lean();
    if (taskProject) {
      const managedIds = await getManagedUserIds(user);
      const projectStakeholder = String(taskProject.createdBy) === String(user._id) || (Array.isArray(taskProject.departments) && taskProject.departments.includes(user.department));
      const crossDeptApproved = taskProject.approvalRequired === true && taskProject.approvalStatus === 'approved' && projectStakeholder;
      if (managedIds !== null && !crossDeptApproved && !taskProject.team.some(memberId => managedIds.some(id => id.toString() === memberId.toString()))) {
        return fail('Access denied', 403);
      }
    }

    await Task.findByIdAndUpdate(id, { deletedAt: new Date() });
    try {
      const { default: ProjectDocument } = await import('@/lib/models/ProjectDocument');
      await ProjectDocument.deleteMany({ taskId: id });
    } catch { /* non-fatal cascade */ }
    const recipientIds = await getTaskStakeholders(task.assignedTo, user._id);
    if (recipientIds.length) {
      try {
        await Notification.insertMany(recipientIds.map(userId => ({
          userId,
          title: 'Task Deleted',
          message: `Task "${task.title}" was deleted by ${user.name}.`,
          type: 'general',
          refId: task._id,
        })));
      } catch { /* non-fatal */ }
    }
    auditLog('Task Deleted', 'Tasks', user._id, `Deleted task "${task.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, task.assignedTo);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
