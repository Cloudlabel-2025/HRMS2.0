import { connectDB } from '@/lib/db';
import { Holiday } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getSaturdayPattern } from '@/lib/saturday-cycle';

// Matches names written by the old generator ('First Saturday',
// 'Third Saturday'). Combined with the Saturday check below so a manual
// holiday that happens to share the name on a non-Saturday is never touched.
const LEGACY_GENERATED_NAME_RE = /^(First|Second|Third|Fourth|Fifth) Saturday$/i;

function isSaturdayDate(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && d.getDay() === 6;
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    const body = await req.json().catch(() => ({}));
    const apply = body.confirm === true;

    await connectDB();
    const config = await getGlobalConfig();
    const pattern = getSaturdayPattern(config);

    const all = await Holiday.find({}).select('_id name date type source workingDayOverride').lean();
    const matched = all.filter(h =>
      isSaturdayDate(h.date) && !h.workingDayOverride && (
        h.source === 'saturday_alternate' ||
        LEGACY_GENERATED_NAME_RE.test(String(h.name || '').trim())
      )
    ).map(h => ({ _id: String(h._id), name: h.name, date: h.date, type: h.type, source: h.source || 'legacy-name' }));

    if (!apply) {
      return ok({ preview: true, count: matched.length, pattern, holidays: matched });
    }

    let deleted = 0;
    if (matched.length > 0) {
      const res = await Holiday.deleteMany({ _id: { $in: matched.map(m => m._id) } });
      deleted = res?.deletedCount || 0;
    }
    try {
      await auditLog('Saturday Holidays Cleaned Up', 'Settings', user._id,
        `Removed ${deleted} auto-generated Saturday holiday(s) under pattern '${pattern}'`, 'medium',
        req.headers.get('x-forwarded-for') || '', null, user._id);
    } catch { /* non-fatal */ }

    return ok({ preview: false, count: matched.length, deleted, pattern, holidays: matched });
  } catch (e) {
    return fail(e.message, 500);
  }
}
