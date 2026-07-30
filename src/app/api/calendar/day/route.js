import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { AuditLog } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const userId = searchParams.get('userId');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail('A valid date is required');
    await connectDB();
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(`${date}T23:59:59.999Z`);

    if (userId) {
      const [employee, attendance, logs] = await Promise.all([
        User.findById(userId).select('name avatar department designation'),
        Attendance.findOne({ userId, date }).lean(),
        AuditLog.find({ userId, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).lean(),
      ]);
      if (!employee) return fail('Employee not found', 404);
      return ok({ employee, attendance, logs });
    }

    const [employees, attendance, auditCounts] = await Promise.all([
      User.find({ status: 'active', role: { $nin: ['super_admin'] } }).select('name avatar department designation').sort({ name: 1 }).lean(),
      Attendance.find({ date }).select('userId hoursWorked status clockIn clockOut').lean(),
      AuditLog.aggregate([{ $match: { createdAt: { $gte: start, $lte: end } } }, { $group: { _id: '$userId', count: { $sum: 1 } } }]),
    ]);
    const attendanceByUser = new Map(attendance.map(item => [item.userId.toString(), item]));
    const auditCountByUser = new Map(auditCounts.map(item => [item._id?.toString(), item.count]));
    return ok({ employees: employees.map(employee => ({ ...employee, attendance: attendanceByUser.get(employee._id.toString()) || null, auditCount: auditCountByUser.get(employee._id.toString()) || 0 })) });
  } catch (e) { return fail(e.message, 500); }
}
