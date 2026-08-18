import { requirePortalAuth } from '@/lib/middleware';
import { ok } from '@/lib/jwt';
import { Department } from '@/lib/models/index';

export async function GET(req) {
  const { user, error, portalAccess } = await requirePortalAuth(req);
  if (error) return error;

  let visibleDepartments = [];
  if (user.department) {
    const deptDoc = await Department.findOne({ name: user.department }).select('visibleDepartments').lean().catch(() => null);
    visibleDepartments = deptDoc?.visibleDepartments || [];
  }

  return ok({ ...user.toObject(), visibleDepartments, portalAccess });
}
