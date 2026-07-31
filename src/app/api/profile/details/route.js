import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Employee } from '@/lib/models/index';
import { buildSelfProfilePayload } from '@/lib/employees/profile';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const emp = await Employee.findOne({ userId: user._id })
    .populate('teamLeadId', 'name email avatar')
    .populate('teamAdminId', 'name email avatar');

  if (!emp) return fail('Employee record not found', 404);

  return ok(await buildSelfProfilePayload(user, emp));
}
