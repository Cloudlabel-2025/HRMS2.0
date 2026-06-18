import { connectDB } from '@/lib/db';
import { Goal } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const goal = await Goal.findById(id);
    if (!goal) return fail('Goal not found', 404);

    const isAdmin = ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role);
    if (goal.userId.toString() !== user._id.toString() && !isAdmin) {
      return fail('Access denied', 403);
    }

    const body = await req.json();
    const { status, progress } = body;

    if (status && !['in_progress', 'achieved', 'missed'].includes(status)) {
      return fail('Invalid status', 400);
    }
    if (progress !== undefined && (typeof progress !== 'number' || progress < 0 || progress > 100)) {
      return fail('Progress must be between 0 and 100', 400);
    }

    if (status) goal.status = status;
    if (progress !== undefined) goal.progress = progress;

    await goal.save();

    const ip = req.headers.get('x-forwarded-for') || '';
    await auditLog('Goal Updated', 'Performance', user._id, `Updated goal: "${goal.title}"`, 'low', ip, null, goal.userId);

    return ok({ goal });
  } catch (e) {
    return fail(e.message, 500);
  }
}
