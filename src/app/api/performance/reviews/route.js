import { connectDB } from '@/lib/db';
import { Review } from '@/lib/models/index';
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
    const ip = req.headers.get('x-forwarded-for') || '';
    const body = await req.json();

    if (!body.userId) {
      auditLog('Review Submit Failed', 'Performance', user._id, 'Failed to submit review: userId is required', 'low', ip, null, user._id);
      return fail('userId is required', 400);
    }
    if (!body.cycle) {
      auditLog('Review Submit Failed', 'Performance', user._id, 'Failed to submit review: cycle is required', 'low', ip, null, user._id);
      return fail('cycle is required', 400);
    }

    const scores = [body.selfScore, body.peerScore, body.managerScore].filter(Boolean);
    const overall = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

    const review = await Review.create({ ...body, overall, managerBy: user._id });
    auditLog('Performance Review Submitted', 'Performance', user._id, `Submitted review for cycle: ${body.cycle}`, 'low', ip, null, body.userId);
    return ok({ review }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
