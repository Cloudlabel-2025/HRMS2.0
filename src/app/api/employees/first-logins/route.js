import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { Employee } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await dbConnect();

    // Get all employees with their linked User records (for firstLoginAt)
    const employees = await Employee.find().sort({ createdAt: -1 });
    const userIds = employees.map(e => e.userId).filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } }).select('_id firstLoginAt isFirstLogin createdAt');
    const userMap = {};
    for (const u of users) userMap[u._id.toString()] = u;

    const result = employees.map(emp => {
      const authUser = userMap[emp.userId?.toString()] || {};
      return {
        _id: emp._id,
        name: emp.name,
        email: emp.email,
        department: emp.department,
        designation: emp.designation,
        role: emp.role,
        status: emp.status,
        joinDate: emp.joinDate,
        firstLoginAt: authUser.firstLoginAt || null,
        neverLoggedIn: !authUser.firstLoginAt,
        accountCreatedAt: authUser.createdAt || emp.createdAt,
      };
    });

    return ok(result);
  } catch (e) {
    return fail(e.message, 500);
  }
}
