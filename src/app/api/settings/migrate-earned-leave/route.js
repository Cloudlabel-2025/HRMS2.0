import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { migrateEarnedLeave } from '@/lib/leave/migrate-earned-leave';

async function handle(req, apply) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();
    return ok(await migrateEarnedLeave({ apply, actor: user, ip: req.headers.get('x-forwarded-for') || '' }));
  } catch (error) {
    console.error('[Earned leave migration]', error.name);
    return fail('Earned leave migration could not complete. No partial migration was committed. Please retry or check server logs.', 500);
  }
}

export async function GET(req) { return handle(req, false); }
export async function POST(req) { return handle(req, true); }
