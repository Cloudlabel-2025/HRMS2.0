import { connectDB } from '@/lib/db';
import { Goal } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const query = {};
    if (userId) query.userId = userId;
    else if (!['super_admin','admin_full','team_admin','team_lead'].includes(user.role)) query.userId = user._id;

    const goals = await Goal.find(query).populate('userId', 'name avatar department').sort({ createdAt: -1 });
    return ok({ goals });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const ip = req.headers.get('x-forwarded-for') || '';
    const body = await req.json();
    if (!body.title) {
      auditLog('Goal Create Failed', 'Performance', user._id, 'Failed to create goal: title is required', 'low', ip, null, user._id);
      return fail('Goal title is required', 400);
    }
    const targetId = body.userId || user._id;
    const goal = await Goal.create({ ...body, userId: targetId });
    auditLog('Goal Created', 'Performance', user._id, `Created goal: "${body.title}"`, 'low', ip, null, targetId);
    return ok({ goal }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
