import { connectDB } from '@/lib/db';
import { Goal } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
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
    const body = await req.json();
    const goal = await Goal.create({ ...body, userId: body.userId || user._id });
    return ok({ goal }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
