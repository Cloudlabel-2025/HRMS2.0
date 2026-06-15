import { connectDB } from '@/lib/db';
import { Goal } from '@/lib/models/index';
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

    let targetId;
    if (['employee', 'intern'].includes(user.role)) {
      targetId = user._id;
    } else if (['team_lead', 'team_admin'].includes(user.role)) {
      targetId = body.userId || user._id;
      if (targetId.toString() !== user._id.toString()) {
        const filter = user.role === 'team_lead' ? { teamLeadId: user._id } : { teamAdminId: user._id };
        const member = await User.findOne({ _id: targetId, ...filter });
        if (!member) {
          auditLog('Goal Create Failed', 'Performance', user._id, `Attempted to assign goal to non-team member (${targetId})`, 'low', ip, null, user._id);
          return fail('You can only assign goals to your team members', 403);
        }
      }
    } else {
      targetId = body.userId || user._id;
    }

    const goal = await Goal.create({ ...body, userId: targetId });
    auditLog('Goal Created', 'Performance', user._id, `Created goal: "${body.title}"`, 'low', ip, null, targetId);
    return ok({ goal }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
