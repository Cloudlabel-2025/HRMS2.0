import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import UserLeaveBalance from '@/lib/models/UserLeaveBalance';
import { Payroll } from '@/lib/models/Payroll';
import { Absence } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Access denied', 403);

    await dbConnect();

    const employers = await User.find({ role: 'super_admin' }).select('_id');
    const ids = employers.map(e => e._id);

    const attendance = await Attendance.deleteMany({ userId: { $in: ids } });
    const balances = await UserLeaveBalance.deleteMany({ userId: { $in: ids } });
    const absences = await Absence.deleteMany({ userId: { $in: ids } });
    const payrolls = await Payroll.deleteMany({ userId: { $in: ids }, status: 'draft' });

    return ok({
      employersProcessed: ids.length,
      attendanceDeleted: attendance.deletedCount,
      leaveBalancesDeleted: balances.deletedCount,
      absencesDeleted: absences.deletedCount,
      draftPayrollsDeleted: payrolls.deletedCount,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
