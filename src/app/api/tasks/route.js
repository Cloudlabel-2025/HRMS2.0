import { connectDB } from '@/lib/db';
import { Task } from '@/lib/models/Task';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess } from '@/lib/rbac';

async function getTeamUserIds(user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return null;
  if (user.role === 'team_lead') {
    const members = await User.find({ teamLeadId: user._id }).select('_id');
    return members.map(m => m._id);
  }
  if (user.role === 'team_admin') {
    const members = await User.find({ teamAdminId: user._id }).select('_id');
    return members.map(m => m._id);
  }
  return [user._id];
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'tasks')) return fail('Access denied', 403);
    await connectDB();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const scope     = searchParams.get('scope'); // 'my' | 'all'

    const query = {};
    if (projectId) query.projectId = projectId;

    if (scope === 'my' || ['employee', 'intern', 'recruiter'].includes(user.role)) {
      query.assignedTo = user._id;
    } else {
      const ids = await getTeamUserIds(user);
      if (ids) query.assignedTo = { $in: ids };
    }

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name avatar')
      .populate('assignedBy', 'name')
      .populate('projectId', 'name')
      .sort({ createdAt: -1 });

    return ok(tasks);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) {
      return fail('Access denied', 403);
    }
    await connectDB();

    const body = await req.json();

    // team_lead can only assign to their own team members
    if (user.role === 'team_lead') {
      const member = await User.findOne({ _id: body.assignedTo, teamLeadId: user._id });
      if (!member) return fail('You can only assign tasks to your team members', 403);
    }

    const task = await Task.create({ ...body, assignedBy: user._id });
    await task.populate('assignedTo', 'name avatar');
    return ok(task, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
