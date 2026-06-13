import { requireAuth, auditLog } from '@/lib/middleware';
import { fail, ok } from '@/lib/jwt';

const VALID_SEVERITIES = ['low', 'medium', 'high'];

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const body = await req.json();
    const action = String(body.action || '').trim();
    const module = String(body.module || 'General').trim();
    const details = String(body.details || '').trim();
    const severity = VALID_SEVERITIES.includes(body.severity) ? body.severity : 'low';

    if (!action) return fail('action is required', 400);

    const ip = req.headers.get('x-forwarded-for') || '';
    await auditLog(
      action.slice(0, 120),
      module.slice(0, 80),
      user._id,
      details.slice(0, 1000),
      severity,
      ip,
      null,
      user._id
    );

    return ok({ logged: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
