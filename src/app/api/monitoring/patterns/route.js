import { connectDB } from '@/lib/db';
import { Employee, Holiday, Shift, ShiftChange } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess, getDepartmentUserIds } from '@/lib/rbac';
import { determineStatus, getShiftConfig } from '@/lib/attendance-constants';

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
    const employeeQuery = { status: 'active', role: { $ne: 'super_admin' } };
    const scopedIds = await getDepartmentUserIds(user);
    if (scopedIds !== null) employeeQuery.userId = { $in: scopedIds };
    const employees = await Employee.find(employeeQuery).select('userId name department').lean();
    const ids = employees.map(employee => employee.userId);
    const [attendance, leaves, holidays, users, shifts, shiftChanges] = await Promise.all([
      Attendance.find({ userId: { $in: ids }, date: { $gte: startDate, $lte: endDate } }).select('userId date status lateFlag halfDayThresholdExceeded clockIn shiftId shiftName shiftStartTime shiftEndTime shiftLateThreshold approvedHalfDayLeave permission leaveOverride nonWorkingDayType').lean(),
      Leave.find({ userId: { $in: ids }, status: 'approved', from: { $lte: endDate }, to: { $gte: startDate } }).select('userId from to').lean(),
      Holiday.find({ date: { $gte: addDays(startDate, -1), $lte: addDays(endDate, 1) } }).select('date').lean(),
      User.find({ _id: { $in: ids } }).select('_id shift shiftId').lean(),
      Shift.find({}).lean(),
      ShiftChange.find({ status: 'applied', userIds: { $in: ids }, effectiveDate: { $lte: endDate } }).sort({ effectiveDate: -1, appliedAt: -1, createdAt: -1 }).lean(),
    ]);
    const userById = new Map(users.map(u => [String(u._id), u]));
    const shiftById = new Map(shifts.map(s => [String(s._id), s]));
    const shiftByName = new Map(shifts.map(s => [s.name, s]));
    const historyByUser = new Map();
    for (const change of shiftChanges) {
      for (const id of (change.userIds || []).map(String)) {
        if (!historyByUser.has(id)) historyByUser.set(id, []);
        historyByUser.get(id).push(change);
      }
    }
    const shiftForDate = (userId, date, record) => {
      const changes = historyByUser.get(userId) || [];
      const current = userById.get(userId);
      const prior = changes.find(c => c.effectiveDate <= date);
      if (prior) {
        const assignment = (prior.userAssignments || []).find(a => String(a.userId) === userId);
        const id = assignment?.targetShiftId || prior.targetShiftId;
        const name = assignment?.targetShiftName || prior.targetShiftName;
        if (assignment?.targetShiftSnapshot?.startTime) return { ...assignment.targetShiftSnapshot, _id: id || null };
        if (id && shiftById.has(String(id))) return shiftById.get(String(id));
        if (name && shiftByName.has(name)) return shiftByName.get(name);
      } else {
        const future = (changes.length ? changes[changes.length - 1] : null);
        if (future) {
          const assignment = (future.userAssignments || []).find(a => String(a.userId) === userId);
          const id = assignment?.fromShiftId || future.fromShiftId;
          const name = assignment?.fromShiftName || '';
          if (assignment?.fromShiftSnapshot?.startTime) return { ...assignment.fromShiftSnapshot, _id: id || null };
          if (id && shiftById.has(String(id))) return shiftById.get(String(id));
          if (name && shiftByName.has(name)) return shiftByName.get(name);
        }
      }
      if (record.shiftStartTime) return { name: record.shiftName || '', startTime: record.shiftStartTime, endTime: record.shiftEndTime, lateThreshold: record.shiftLateThreshold };
      if (current?.shiftId && shiftById.has(String(current.shiftId))) return shiftById.get(String(current.shiftId));
      return current?.shift ? shiftByName.get(current.shift) || null : null;
    };
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
      let status = record.status;
      let lateFlag = !!record.lateFlag;
      let halfDayThresholdExceeded = !!record.halfDayThresholdExceeded;
      if (record.clockIn && !['leave', 'holiday'].includes(status) && record.leaveOverride?.status !== 'rejected' && !record.approvedHalfDayLeave && !record.permission?.requestId && !record.permission?.startTime) {
        const shift = shiftForDate(userId, record.date, record);
        if (shift?.startTime) {
          const [sh, sm] = shift.startTime.split(':').map(Number);
          const [h, m] = record.clockIn.split(':').map(Number);
          let minutes = (h - sh) * 60 + (m - sm);
          if (minutes < -720) minutes += 1440;
          if (minutes > 720) minutes -= 1440;
          const result = determineStatus(minutes, getShiftConfig(shift, {}));
          status = result.status;
          lateFlag = result.lateFlag;
          halfDayThresholdExceeded = !!result.halfDayThresholdExceeded;
        }
      }
      if ((lateFlag || status === 'late') && !halfDayThresholdExceeded) lateDates.set(userId, [...(lateDates.get(userId) || []), record.date]);
      if (status === 'absent') absentDates.set(userId, [...(absentDates.get(userId) || []), record.date]);
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
