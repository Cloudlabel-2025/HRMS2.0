import { requirePortalAuth } from '@/lib/middleware';
import { ok } from '@/lib/jwt';
import Department from '@/lib/models/Department';
import SystemConfig from '@/lib/models/SystemConfig';

export async function GET(req) {
  const { user, error, portalAccess } = await requirePortalAuth(req);
  if (error) return error;

  const [department, globalConfig] = await Promise.all([
    user.department
      ? Department.findOne({ name: user.department }).select('visibleDepartments').lean().catch(() => null)
      : null,
    portalAccess === 'hrms'
      ? SystemConfig.findOne({ key: 'global_config' }).select('value').lean().catch(() => null)
      : null,
  ]);

  return ok({
    user: {
      ...user.toObject(),
      visibleDepartments: department?.visibleDepartments || [],
      portalAccess,
    },
    settings: globalConfig?.value || null,
  });
}
