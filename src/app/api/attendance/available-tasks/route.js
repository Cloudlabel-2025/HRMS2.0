import { connectDB } from '@/lib/db';
import { Task } from '@/lib/models/Task';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const now = new Date();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const tasks = await Task.find({
      assignedTo: user._id,
      status: { $in: ['To Do', 'In Progress'] },
      $or: [
        { due: { $exists: false } },
        { due: null },
        { due: '' },
        { due: { $gte: todayStr } },
      ],
    })
      .populate('projectId', 'name')
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    return ok(tasks);
  } catch (e) {
    return fail(e.message, 500);
  }
}
