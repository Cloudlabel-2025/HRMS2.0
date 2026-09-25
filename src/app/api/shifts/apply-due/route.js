import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { applyDueShiftChanges } from '@/lib/shift-assign';

async function handleApplyDue(req) {
  try {
    // Auth: support CRON_SECRET via x-cron-secret header (Vercel cron),
    // Authorization: Bearer <secret> (external schedulers), or admin JWT.
    const cronSecret = req.headers.get('x-cron-secret');
    const authHeader = req.headers.get('authorization') || '';
    const envCronSecret = process.env.CRON_SECRET;
    const bearerOk = envCronSecret && authHeader === `Bearer ${envCronSecret}`;
    const headerOk = envCronSecret && cronSecret === envCronSecret;

    if (!headerOk && !bearerOk) {
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

export async function POST(req) {
  return handleApplyDue(req);
}

// Vercel Cron invokes GET by default — same handler so the 00:05 IST
// schedule in vercel.json actually flips due shift changes.
export async function GET(req) {
  return handleApplyDue(req);
}
