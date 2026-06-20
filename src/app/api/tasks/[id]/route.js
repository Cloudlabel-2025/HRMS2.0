import { connectDB } from '@/lib/db';
import { Task, Project } from '@/lib/models/Task';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const task = await Task.findById(id);
    if (!task) return fail('Task not found', 404);

    const MANAGER_ROLES = ['super_admin', 'admin_full', 'team_admin', 'team_lead'];

    // Status-only update — any role can do this
    if (Object.keys(body).length === 1 && body.status) {
      // Employees/interns can only update their own tasks
      if (['employee', 'intern'].includes(user.role)) {
        if (task.assignedTo.toString() !== user._id.toString()) return fail('Access denied', 403);
      }
      // Only managers can block a task
      if (body.status === 'Blocked' && !MANAGER_ROLES.includes(user.role)) {
        return fail('Only team leads and admins can block a task', 403);
      }
      const updated = await Task.findByIdAndUpdate(id, { status: body.status }, { new: true })
        .populate('assignedTo', 'name avatar').populate('projectId', 'name');
      auditLog('Task Status Updated', 'Tasks', user._id, `Updated task "${task.title}" status to ${body.status}`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
      return ok(updated);
    }

    // Full update — managers/admins only
    if (!MANAGER_ROLES.includes(user.role)) return fail('Access denied', 403);
    if (!body.title || !body.description || !body.projectId || !body.assignedTo || !body.priority || !body.due) {
      return fail('All fields are required', 400);
    }
    if (body.title.length > 30 || !/^[a-zA-Z0-9]+$/.test(body.title)) {
      return fail('Task title must be at most 30 characters and contain only letters and numbers', 400);
    }

    // Validate due date is within project's date range
    const taskProject = await Project.findById(body.projectId).select('startDate endDate').lean();
    if (taskProject) {
      if (body.due < taskProject.startDate) {
        return fail(`Due date cannot be before project start date (${taskProject.startDate})`, 400);
      }
      if (body.due > taskProject.endDate) {
        return fail(`Due date cannot be after project end date (${taskProject.endDate})`, 400);
      }
    }

    const updated = await Task.findByIdAndUpdate(id, body, { new: true })
      .populate('assignedTo', 'name avatar').populate('projectId', 'name');
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
    const task = await Task.findById(id);
    if (!task) return fail('Task not found', 404);
    await Task.findByIdAndDelete(id);
    auditLog('Task Deleted', 'Tasks', user._id, `Deleted task "${task.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, task.assignedTo);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
