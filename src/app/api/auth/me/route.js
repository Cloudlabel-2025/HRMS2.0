import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Department } from '@/lib/models/index';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  let visibleDepartments = [];
  if (user.department) {
    const deptDoc = await Department.findOne({ name: user.department }).select('visibleDepartments').lean().catch(() => null);
    visibleDepartments = deptDoc?.visibleDepartments || [];
  }

  return ok({ ...user.toObject(), visibleDepartments });
}
