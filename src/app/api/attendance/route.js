import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

async function getTeamUserIds(user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return null; // null = no filter
  if (user.role === 'team_lead') {
    const members = await User.find({ teamLeadId: user._id }).select('_id');
    return members.map(m => m._id);
  }
  if (user.role === 'team_admin') {
    const members = await User.find({ teamAdminId: user._id }).select('_id');
    return members.map(m => m._id);
  }
  return [user._id]; // employee / intern / recruiter — self only
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const date   = searchParams.get('date');
    const month  = searchParams.get('month');

    const query = {};

    if (userId) {
      // Explicit userId param — only admins or the user themselves
      if (!['super_admin', 'admin_full'].includes(user.role) && userId !== user._id.toString()) {
        return fail('Access denied', 403);
      }
      query.userId = userId;
    } else {
      const ids = await getTeamUserIds(user);
      if (ids) query.userId = { $in: ids };
    }

    if (date)  query.date = date;
    if (month) query.date = { $regex: `^${month}` };

    const records = await Attendance.find(query)
      .populate('userId', 'name avatar department')
      .sort({ date: -1 });

    return ok(records);
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
    const today = new Date().toISOString().split('T')[0];
    const targetUserId = body.userId || user._id;

    const existing = await Attendance.findOne({ userId: targetUserId, date: today });
    if (existing) return fail('Attendance already marked for today');

    const record = await Attendance.create({ userId: targetUserId, date: today, ...body });
    return ok(record, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
