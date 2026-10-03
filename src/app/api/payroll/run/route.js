import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { Payroll } from '@/lib/models/Payroll';
import { runPayrollForMonth, notifyPayrollRun } from '@/lib/payroll-run-engine';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { month, force = false, userIds = null } = await req.json();
    if (!month) return fail('Month is required (YYYY-MM)');
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('Month must be in YYYY-MM format');
    if (userIds !== null && userIds !== undefined && !Array.isArray(userIds)) return fail('userIds must be an array');

    const ip = req.headers.get('x-forwarded-for') || '';

    // Force re-run: unlock approved/finalized rows back to draft first so the
    // recompute below corrects stale LOP/salaryPerDay values. A normal run
    // silently skips locked rows, which is why corrections never landed.
    let reopened = 0;
    if (force) {
      const scope = { month, status: { $in: ['approved', 'finalized'] } };
      if (Array.isArray(userIds) && userIds.length) scope.userId = { $in: userIds };
      try {
        const r = await Payroll.updateMany(scope, { $set: { status: 'draft' } });
        reopened = r?.modifiedCount || 0;
      } catch { reopened = 0; }
      await auditLog(
        'Payroll Force Re-run',
        'Payroll',
        user._id,
        `Force re-run requested for ${month} — reopened ${reopened} locked record(s) to draft for recompute`,
        'high',
        ip,
        null,
        null
      ).catch(() => {});
    }

    const summary = await runPayrollForMonth({ month, userIds, actor: user, ip, force: !!force });

    // Persistent Topbar alert (type payroll) so the run result survives the
    // transient 3s toast — the runResult modal reads the same payload.
    const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
    await notifyPayrollRun(admins, summary);

    return ok({ ...summary, reopened });
  } catch (e) {
    return fail(e.message, 500);
  }
}