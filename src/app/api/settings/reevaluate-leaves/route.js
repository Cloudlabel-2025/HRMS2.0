import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { previewLeaveDateImpact, applyLeaveDateImpact } from '@/lib/leave/reevaluate';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

// Retroactive leave re-evaluation for a Saturday whose working-day status
// changed (compensated working-day override). Mirrors the holiday-undo
// preview idiom: preview first (no writes), then confirm.
//
// POST /api/settings/reevaluate-leaves  { date: 'YYYY-MM-DD', preview: true }
// POST /api/settings/reevaluate-leaves  { date: 'YYYY-MM-DD', confirm: true }
export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    const body = await req.json().catch(() => ({}));
    const { date, preview, confirm } = body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return fail('Valid date YYYY-MM-DD is required', 400);
    }

    if (preview === true) {
      return ok({ preview: true, ...(await previewLeaveDateImpact(date)) });
    }
    if (confirm === true) {
      const ip = req.headers.get('x-forwarded-for') || '';
      return ok({ preview: false, ...(await applyLeaveDateImpact(date, user, ip)) });
    }
    return fail('Pass preview: true or confirm: true', 400);
  } catch (e) {
    if (e?.statusCode === 400 || /Saturdays only/.test(e?.message || '')) return fail(e.message, 400);
    return fail(e.message, 500);
  }
}
