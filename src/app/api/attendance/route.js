import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Shift } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, parseShiftStartTime } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';

async function getShiftAwareToday(targetUserId) {
  const now = new Date();
  try {
    const targetUser = await User.findById(targetUserId).select('shift');
    if (!targetUser) return null;
    const shiftDoc = await Shift.findOne({ name: targetUser.shift || 'Morning (9AM-6PM)' }).lean();
    return getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
  } catch {
    return null;
  }
}

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

    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');

    if (date) {
      query.date = date;
    } else if (fromDate || toDate) {
      const dateRange = {};
      if (fromDate) dateRange.$gte = fromDate;
      if (toDate) dateRange.$lte = toDate;
      query.date = dateRange;
    } else if (month) {
      query.date = { $regex: '^' + month };
    }

    const raw = await Attendance.find(query)
      .populate('userId', 'name avatar department role shift')
      .sort({ date: -1 })
      .lean();

    // Recompute lateFlag/status based on actual shift start time
    // so that records created by previous buggy clock logic get corrected
    const config = await getGlobalConfig();
    const LATE_THRESHOLD_MINUTES = Number(config.lateThreshold) || 15;

    const shiftNames = [...new Set(raw.filter(r => r.clockIn).map(r => r.userId?.shift || 'Morning (9AM-6PM)'))];
    const shiftDocs = shiftNames.length ? await Shift.find({ name: { $in: shiftNames } }).lean() : [];
    const shiftMap = {};
    for (const s of shiftDocs) shiftMap[s.name] = s;

    for (const rec of raw) {
      if (!rec.clockIn) continue;
      const shiftName = rec.userId?.shift || 'Morning (9AM-6PM)';
      const shiftDoc = shiftMap[shiftName];
      let shiftHour = 9, shiftMin = 0;
      let shiftFound = false;
      if (shiftDoc?.startTime) {
        const [sh, sm] = shiftDoc.startTime.split(':').map(Number);
        shiftHour = sh; shiftMin = sm;
        shiftFound = true;
      }
      if (!shiftFound) {
        const parsed = parseShiftStartTime(shiftName);
        if (parsed) {
          const [sh, sm] = parsed.split(':').map(Number);
          shiftHour = sh; shiftMin = sm;
          shiftFound = true;
        }
      }
      const [h, m] = rec.clockIn.split(':').map(Number);
      const minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
      const FIVE_HOURS  = 300;
      const THREE_HOURS = 180;
      if (shiftFound && minutesSinceShiftStart > FIVE_HOURS) {
        rec.lateFlag = true;
        rec.status = 'leave';
      } else if (shiftFound && minutesSinceShiftStart > THREE_HOURS) {
        rec.lateFlag = true;
        rec.status = 'half_day';
      } else if (shiftFound && minutesSinceShiftStart > LATE_THRESHOLD_MINUTES) {
        rec.lateFlag = true;
        rec.status = 'late';
      } else {
        rec.lateFlag = false;
        rec.status = 'present';
      }
    }

    return ok(raw);
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
    const targetUserId = body.userId || user._id;
    const today = await getShiftAwareToday(targetUserId) || (() => {
      const now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    })();

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
    const targetUserId = body.userId || user._id;
    const today = body.date || (await getShiftAwareToday(targetUserId)) || (() => {
      const now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    })();

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
