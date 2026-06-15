import { connectDB } from '@/lib/db';
import { Review } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

async function getTeamUserIds(user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return null;
  if (user.role === 'team_lead') {
    const members = await User.find({ teamLeadId: user._id }).select('_id');
    return [...members.map(m => m._id), user._id];
  }
  if (user.role === 'team_admin') {
    const members = await User.find({ teamAdminId: user._id }).select('_id');
    return [...members.map(m => m._id), user._id];
  }
  return [user._id];
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const query = {};
    if (userId) {
      query.userId = userId;
    } else {
      const ids = await getTeamUserIds(user);
      if (ids) query.userId = { $in: ids };
    }

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

    if (!body.cycle) {
      auditLog('Review Submit Failed', 'Performance', user._id, 'Failed to submit review: cycle is required', 'low', ip, null, user._id);
      return fail('cycle is required', 400);
    }

    let targetUserId;
    if (['employee', 'intern'].includes(user.role)) {
      targetUserId = user._id;
    } else {
      if (!body.userId) {
        auditLog('Review Submit Failed', 'Performance', user._id, 'Failed to submit review: userId is required for admins', 'low', ip, null, user._id);
        return fail('userId is required', 400);
      }
      targetUserId = body.userId;
    }

    if (['team_lead', 'team_admin'].includes(user.role) && targetUserId.toString() !== user._id.toString()) {
      const filter = user.role === 'team_lead' ? { teamLeadId: user._id } : { teamAdminId: user._id };
      const member = await User.findOne({ _id: targetUserId, ...filter });
      if (!member) {
        auditLog('Review Submit Failed', 'Performance', user._id, `Attempted to review non-team member (${targetUserId})`, 'low', ip, null, user._id);
        return fail('You can only review your team members', 403);
      }
    }

    const scores = [body.selfScore, body.peerScore, body.managerScore].filter(Boolean);
    const overall = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null;

    const review = await Review.create({ ...body, userId: targetUserId, overall, managerBy: user._id });
    auditLog('Performance Review Submitted', 'Performance', user._id, `Submitted review for cycle: ${body.cycle}`, 'low', ip, null, targetUserId);
    return ok({ review }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
