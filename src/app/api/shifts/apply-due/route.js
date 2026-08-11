import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { applyDueShiftChanges } from '@/lib/shift-assign';

export async function POST(req) {
  try {
    // Auth: support either super_admin/admin_full JWT or valid CRON_SECRET header
    const cronSecret = req.headers.get('x-cron-secret');
    const envCronSecret = process.env.CRON_SECRET;

    if (cronSecret !== envCronSecret) {
      const { user, error } = await requireAuth(req);
      if (error) return error;
      if (!['super_admin', 'admin_full'].includes(user.role)) {
        return fail('Access denied. super_admin/admin_full role or valid CRON_SECRET required.', 403);
      }
    }

    await connectDB();
    const applied = await applyDueShiftChanges();
    return ok({ applied });
  } catch (e) {
    return fail(e.message, 500);
  }
}
