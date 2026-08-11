import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    const { searchParams } = new URL(req.url);
    const depts = searchParams.get('departments')
      ? searchParams.get('departments').split(',').map(d => d.trim()).filter(Boolean)
      : [];
    if (!depts.length) return ok([]);

    const users = await User.find({
      department: { $in: depts },
      status: 'active',
      role: { $in: ['employee', 'intern', 'team_admin', 'team_lead'] },
    })
      .select('name role department avatar')
      .sort({ department: 1, name: 1 })
      .lean();

    return ok(users);
  } catch (e) {
    return fail(e.message, 500);
  }
}
