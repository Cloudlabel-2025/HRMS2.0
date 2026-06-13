import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

async function getTeamUserIds(user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return null;
  if (user.role === 'team_lead') {
    const members = await User.find({ department: user.department, status: 'active' }).select('_id');
    return members.map(m => m._id);
  }
  if (user.role === 'team_admin') {
    const members = await User.find({ department: user.department, role: { $ne: 'team_lead' }, status: 'active' }).select('_id');
    return members.map(m => m._id);
  }
  return [user._id];
}

function canViewDailyProgress(user) {
  return ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role);
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
    const scope  = searchParams.get('scope');

    const query = {};

    if (scope === 'my') {
      query.userId = user._id;
    } else if (scope === 'team') {
      if (!canViewDailyProgress(user)) return fail('Access denied', 403);
      const ids = await getTeamUserIds(user);
      if (userId) {
        if (ids && !ids.some(id => id.toString() === userId)) return fail('Access denied', 403);
        query.userId = userId;
      } else if (ids) {
        query.userId = { $in: ids };
      }
      // admins (ids === null) see all — no userId filter
    } else if (userId) {
      if (!['super_admin', 'admin_full'].includes(user.role) && userId !== user._id.toString()) {
        return fail('Access denied', 403);
      }
      query.userId = userId;
    } else {
      // default: own records only
      query.userId = user._id;
    }

    if (date)      query.date = date;
    else if (month) query.date = { $regex: '^' + month };

    const records = await Attendance.find(query)
      .populate('userId', 'name avatar department role')
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
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const targetUserId = body.userId || user._id;

    const existing = await Attendance.findOne({ userId: targetUserId, date: today });
    if (existing) return fail('Attendance already marked for today', 409);

    const record = await Attendance.create({ userId: targetUserId, date: today, ...body });
    return ok(record, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const now = new Date();
    const today = body.date || (now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0'));
    const targetUserId = body.userId || user._id;

    if (targetUserId.toString() !== user._id.toString() && !['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied', 403);
    }

    const allowed = ['breaks', 'workProgress', 'hoursWorked', 'baseHoursWorked', 'breakDeduction', 'note'];
    const update = {};
    allowed.forEach(f => { if (f in body) update[f] = body[f]; });

    // Enforce 1 break and 1 lunch break per day limit
    if (body.breaks) {
      const numBreaks = body.breaks.filter(b => b.type === 'break').length;
      const numLunches = body.breaks.filter(b => b.type === 'lunch').length;
      if (numBreaks > 1 || numLunches > 1) {
        return fail('You can only take 1 break and 1 lunch break per day.', 400);
      }
    }

    const record = await Attendance.findOneAndUpdate(
      { userId: targetUserId, date: today },
      update,
      { new: true }
    );
    if (!record) return fail('Attendance record not found', 404);
    return ok(record);
  } catch (e) {
    return fail(e.message, 500);
  }
}
