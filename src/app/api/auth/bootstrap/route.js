import { requirePortalAuth } from '@/lib/middleware';
import { ok } from '@/lib/jwt';
import Department from '@/lib/models/Department';
import SystemConfig from '@/lib/models/SystemConfig';
import { connectDB } from '@/lib/db';

export async function GET(req) {
  try {
    const { user, portalAccess } = await requirePortalAuth(req);

    await connectDB();
    const globalConfig = await SystemConfig.findOne({ key: 'global_config' }).select('value').lean().catch(() => null);

    if (!user) {
      return ok({
        user: null,
        settings: globalConfig?.value || null,
      });
    }

    const department = user.department
      ? await Department.findOne({ name: user.department }).select('visibleDepartments').lean().catch(() => null)
      : null;

    return ok({
      user: {
        ...user.toObject(),
        visibleDepartments: department?.visibleDepartments || [],
        portalAccess,
      },
      settings: globalConfig?.value || null,
    });
  } catch {
    return ok({
      user: null,
      settings: null,
    });
  }
}
