import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { runPayrollForMonth, notifyPayrollRun } from '@/lib/payroll-run-engine';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { month } = await req.json();
    if (!month) return fail('Month is required (YYYY-MM)');
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('Month must be in YYYY-MM format');

    const ip = req.headers.get('x-forwarded-for') || '';
    const summary = await runPayrollForMonth({ month, actor: user, ip });

    // Persistent Topbar alert (type payroll) so the run result survives the
    // transient 3s toast — the runResult modal reads the same payload.
    const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
    await notifyPayrollRun(admins, summary);

    return ok(summary);
  } catch (e) {
    return fail(e.message, 500);
  }
}