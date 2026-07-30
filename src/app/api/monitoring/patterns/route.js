import { connectDB } from '@/lib/db';
import { Employee, Holiday } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess, getAccessibleDepartments } from '@/lib/rbac';

const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = date => new Date(`${date}T00:00:00`);
const toKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date, days) => toKey(new Date(toDate(date).getTime() + days * DAY_MS));

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'monitoring')) return fail('Access denied', 403);
    await connectDB();

    const end = new Date();
    const endDate = toKey(end);
    const startDate = toKey(new Date(end.getTime() - 60 * DAY_MS));
    const employeeQuery = { status: 'active' };
    if (!['super_admin', 'admin_full'].includes(user.role)) employeeQuery.department = { $in: await getAccessibleDepartments(user) };
    const employees = await Employee.find(employeeQuery).select('userId name department').lean();
    const ids = employees.map(employee => employee.userId);
    const [attendance, leaves, holidays] = await Promise.all([
      Attendance.find({ userId: { $in: ids }, date: { $gte: startDate, $lte: endDate } }).select('userId date status lateFlag').lean(),
      Leave.find({ userId: { $in: ids }, status: 'approved', from: { $lte: endDate }, to: { $gte: startDate } }).select('userId from to').lean(),
      Holiday.find({ date: { $gte: addDays(startDate, -1), $lte: addDays(endDate, 1) } }).select('date').lean(),
    ]);
    const employeeById = new Map(employees.map(employee => [employee.userId.toString(), employee]));
    const holidayDates = new Set(holidays.map(holiday => holiday.date));
    const signals = new Map();
    const addSignal = (userId, type, evidence) => {
      if (!signals.has(userId)) signals.set(userId, []);
      signals.get(userId).push({ type, evidence });
    };

    const lateDates = new Map();
    const absentDates = new Map();
    for (const record of attendance) {
      const userId = record.userId.toString();
      if (record.lateFlag || record.status === 'late') lateDates.set(userId, [...(lateDates.get(userId) || []), record.date]);
      if (record.status === 'absent') absentDates.set(userId, [...(absentDates.get(userId) || []), record.date]);
    }
    for (const [userId, dates] of lateDates) if (dates.length >= 3) addSignal(userId, 'Repeated late attendance', `${dates.length} late arrivals in the last 60 days`);
    for (const [userId, dates] of absentDates) if (dates.length >= 2) addSignal(userId, 'Repeated unapproved absence', `${dates.length} recorded absences in the last 60 days`);

    const bridgeDates = new Map();
    for (const leave of leaves) {
      for (let cursor = leave.from; cursor <= leave.to; cursor = addDays(cursor, 1)) {
        if (cursor < startDate || cursor > endDate) continue;
        const weekday = toDate(cursor).getDay();
        const nearWeekend = weekday === 1 || weekday === 5;
        const nearHoliday = holidayDates.has(addDays(cursor, -1)) || holidayDates.has(addDays(cursor, 1));
        if (nearWeekend || nearHoliday) {
          const userId = leave.userId.toString();
          bridgeDates.set(userId, [...(bridgeDates.get(userId) || []), cursor]);
        }
      }
    }
    for (const [userId, dates] of bridgeDates) if (dates.length >= 2) addSignal(userId, 'Leave near weekend or holiday', `${dates.length} leave day(s) adjacent to a weekend or holiday in the last 60 days`);

    const flags = [...signals.entries()].flatMap(([userId, items]) => items.map(item => ({
      employee: employeeById.get(userId), type: item.type, evidence: item.evidence, reviewState: 'Needs HR review',
    }))).filter(flag => flag.employee);
    return ok({ period: { startDate, endDate }, flags });
  } catch (e) {
    return fail(e.message, 500);
  }
}
