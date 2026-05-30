import { connectDB } from '@/lib/db';
import { Task } from '@/lib/models/Task';
import { requireAuth } from '@/lib/middleware';
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

    // Employees/interns can only update status on their own tasks
    if (['employee', 'intern'].includes(user.role)) {
      if (task.assignedTo.toString() !== user._id.toString()) return fail('Access denied', 403);
      const updated = await Task.findByIdAndUpdate(id, { status: body.status }, { new: true })
        .populate('assignedTo', 'name avatar').populate('projectId', 'name');
      return ok(updated);
    }

    // Managers can update everything
    const updated = await Task.findByIdAndUpdate(id, body, { new: true })
      .populate('assignedTo', 'name avatar').populate('projectId', 'name');
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
    await Task.findByIdAndDelete(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
