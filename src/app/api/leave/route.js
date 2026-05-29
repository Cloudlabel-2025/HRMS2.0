import { connectDB } from '@/lib/db';
import Leave from '@/lib/models/Leave';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

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
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope  = searchParams.get('scope');  // 'my' | 'approvals'
    const status = searchParams.get('status');

    let query = {};

    if (scope === 'approvals') {
      // Each approver sees only what's pending at their level
      if (user.role === 'team_admin')  query = { teamAdminApproval: 'pending' };
      if (user.role === 'team_lead')   query = { teamAdminApproval: 'approved', tlApproval: 'pending' };
      if (['super_admin', 'admin_full'].includes(user.role)) {
        query = { tlApproval: 'approved', mgmtApproval: 'pending' };
      }
    } else if (scope === 'my' || ['employee', 'intern', 'recruiter'].includes(user.role)) {
      query.userId = user._id;
    } else {
      const ids = await getTeamUserIds(user);
      if (ids) query.userId = { $in: ids };
    }

    if (status) query.status = status;

    const leaves = await Leave.find(query)
      .populate('userId', 'name avatar department')
      .populate('teamAdminApprovedBy', 'name')
      .populate('tlApprovedBy', 'name')
      .populate('mgmtApprovedBy', 'name')
      .sort({ createdAt: -1 });

    return ok(leaves);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { type, from, to, reason } = await req.json();
    if (!type || !from || !to || !reason) return fail('All fields are required');

    const fromDate = new Date(from), toDate = new Date(to);
    if (toDate < fromDate) return fail('End date must be after start date');
    const days = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;

    // Interns can only apply Casual or Sick leave
    if (user.role === 'intern' && !['Casual Leave', 'Sick Leave'].includes(type)) {
      return fail('Interns can only apply for Casual or Sick Leave');
    }

    const leave = await Leave.create({ userId: user._id, type, from, to, days, reason });
    return ok(leave, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
