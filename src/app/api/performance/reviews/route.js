import { connectDB } from '@/lib/db';
import { Review } from '@/lib/models/index';
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

    const reviews = await Review.find(query)
      .populate('userId', 'name avatar department')
      .populate('managerBy', 'name')
      .sort({ createdAt: -1 });
    return ok({ reviews });
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

    // Calculate overall as average of available scores
    const scores = [body.selfScore, body.peerScore, body.managerScore].filter(Boolean);
    const overall = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

    const review = await Review.create({ ...body, overall, managerBy: user._id });
    return ok({ review }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
