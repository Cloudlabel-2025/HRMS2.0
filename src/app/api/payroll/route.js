import { connectDB } from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month'); // 'YYYY-MM'

    let query = {};
    if (!['super_admin','admin_full'].includes(user.role)) query.userId = user._id;
    if (month) query.month = month;

    const payrolls = await Payroll.find(query)
      .populate('userId', 'name avatar department designation')
      .sort({ month: -1 });

    return ok(payrolls);
  } catch (e) {
    return fail(e.message, 500);
  }
}
