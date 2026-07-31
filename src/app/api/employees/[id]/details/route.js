import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Employee } from '@/lib/models/index';
import { buildSelfProfilePayload } from '@/lib/employees/profile';
import { canViewUser } from '@/lib/rbac';

export async function GET(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const emp = await Employee.findById(id)
    .populate('teamLeadId', 'name email avatar')
    .populate('teamAdminId', 'name email avatar');

  if (!emp) return fail('Employee not found', 404);

  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) {
    const isSelf = emp.userId && emp.userId.toString() === user._id.toString();
    if (!isSelf && !await canViewUser(user, { _id: emp.userId, department: emp.department })) {
      return fail('Access denied', 403);
    }
  }

  return ok(await buildSelfProfilePayload(user, emp));
}
