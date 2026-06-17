import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import { Employee } from '@/lib/models/index';
import User from '@/lib/models/User';
import { getGlobalConfig, getPayrollDay, getCycleMonth, getCycleLabel } from '@/lib/payroll-cycle';
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

export async function GET(req, { params }) {
  try {
    const { user, error: authError } = await requireAuth(req);
    if (authError) return authError;
    await connectDB();

    const { id } = await params;
    const employee = await Employee.findById(id);
    if (!employee) return fail('Employee not found', 404);

    const targetUserId = employee.userId;
    const allowedIds = await getTeamUserIds(user);

    if (allowedIds !== null) {
      const hasAccess = allowedIds.some(uid => uid.toString() === targetUserId.toString());
      if (!hasAccess) return fail('Access denied', 403);
    }

    const config = await getGlobalConfig();
    const payrollStartDay = getPayrollDay(config.payrollStartDay, 26);
    const payrollEndDay = getPayrollDay(config.payrollEndDay, 25);

    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');
    const fromMonth = searchParams.get('fromMonth');
    const toMonth = searchParams.get('toMonth');

    const dateFilter = {};
    if (fromDate) dateFilter.$gte = fromDate;
    if (toDate) dateFilter.$lte = toDate;
    if (fromMonth) {
      const [y, m] = fromMonth.split('-');
      const from = `${y}-${String(Number(m)).padStart(2, '0')}-${String(payrollStartDay).padStart(2, '0')}`;
      if (!dateFilter.$gte || from > dateFilter.$gte) dateFilter.$gte = from;
    }
    if (toMonth) {
      const [y, m] = toMonth.split('-');
      const to = `${y}-${String(Number(m)).padStart(2, '0')}-${String(payrollEndDay).padStart(2, '0')}`;
      if (!dateFilter.$lte || to < dateFilter.$lte) dateFilter.$lte = to;
    }

    const query = {
      userId: targetUserId,
      'workProgress.0': { $exists: true },
    };
    if (Object.keys(dateFilter).length) query.date = dateFilter;

    const records = await Attendance.find(query).sort({ date: -1 }).lean();

    const cycles = {};
    for (const rec of records) {
      const { year, month } = getCycleMonth(rec.date, payrollStartDay);
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (!cycles[key]) {
        cycles[key] = {
          key,
          year,
          month,
          label: getCycleLabel(year, month, payrollStartDay, payrollEndDay),
          dates: [],
        };
      }
      cycles[key].dates.push({
        _id: rec._id,
        date: rec.date,
        clockIn: rec.clockIn,
        clockOut: rec.clockOut,
        hoursWorked: rec.hoursWorked,
        status: rec.status,
        workProgress: rec.workProgress,
      });
    }

    const result = Object.values(cycles).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });

    return ok(result);
  } catch (e) {
    return fail(e.message, 500);
  }
}
