import { connectDB } from '@/lib/db';
import { Goal, Notification } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

function currentCycle(date = new Date()) {
  return `C${Math.floor(date.getMonth() / 3) + 1}${date.getFullYear()}`;
}

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
    if (!body.title?.trim() || body.title.length > 35) {
      auditLog('Goal Create Failed', 'Performance', user._id, 'Failed to create goal: title is required or exceeds 35 characters', 'low', ip, null, user._id);
      return fail('Goal title is required and must be at most 35 characters', 400);
    }

    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const targetId = isAdmin ? (body.userId || user._id) : user._id;

    const goal = await Goal.create({ ...body, userId: targetId, approvalStatus: isAdmin ? 'approved' : 'pending' });
    if (!isAdmin) {
      const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
      if (admins.length) await Notification.insertMany(admins.map(admin => ({ userId: admin._id, title: 'Goal approval requested', message: `${user.name} requested the goal: ${goal.title}`, type: 'performance', refId: goal._id })));
    }
    auditLog(isAdmin ? 'Goal Created' : 'Goal Approval Requested', 'Performance', user._id, `${isAdmin ? 'Created' : 'Requested'} goal: "${body.title}"`, 'low', ip, null, targetId);
    return ok({ goal }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Only Super Admin and Admin can validate goals', 403);
    await connectDB();
    const { id, validationComment = '', action } = await req.json();
    const goal = await Goal.findById(id);
    if (!goal) return fail('Goal not found', 404);
    if (['approve_request', 'reject_request'].includes(action)) {
      if (goal.approvalStatus !== 'pending') return fail('This goal request has already been decided');
      goal.approvalStatus = action === 'approve_request' ? 'approved' : 'rejected';
      goal.validationComment = validationComment.trim();
      await goal.save();
      await Notification.create({
        userId: goal.userId,
        title: `Goal request ${action === 'approve_request' ? 'approved' : 'rejected'}`,
        message: `${action === 'approve_request' ? 'Your requested goal is now active' : 'Your goal request was rejected'}: ${goal.title}`,
        type: 'performance',
        refId: goal._id,
      });
      await auditLog('Goal Request Decision', 'Performance', user._id, `${action === 'approve_request' ? 'Approved' : 'Rejected'} goal request: "${goal.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, goal.userId);
      return ok({ goal });
    }
    if (goal.validationStatus === 'validated') return fail('Goal is already validated');
    if (goal.progress < 100 && goal.cycle === currentCycle()) return fail('A goal can be validated only after completion or at the end of its cycle');
    goal.validationStatus = 'validated';
    goal.validatedBy = user._id;
    goal.validatedAt = new Date();
    goal.validationComment = validationComment.trim();
    await goal.save();
    await auditLog('Goal Validated', 'Performance', user._id, `Validated goal: "${goal.title}"`, 'low', req.headers.get('x-forwarded-for') || '', null, goal.userId);
    return ok({ goal });
  } catch (e) { return fail(e.message, 500); }
}
