import { connectDB } from '@/lib/db';
import { Payroll } from '@/lib/models/Payroll';
import { requireAuth, auditLog } from '@/lib/middleware';
import { getGlobalConfig, getPayrollDay, getCycleRange } from '@/lib/payroll-cycle';
import { notify } from '@/lib/notify';
import User from '@/lib/models/User';
import { ok, fail } from '@/lib/jwt';

// POST /api/payroll/approve  { month, action: 'approve'|'finalize' }
export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { month, action, payrollId } = await req.json();
    if (!['approve', 'finalize'].includes(action)) return fail('Invalid action');

    const filter = payrollId ? { _id: payrollId } : { month };
    const ip = req.headers.get('x-forwarded-for') || '';

    // Never lock a mid-cycle preview: its salaryPerDay uses the elapsed-day
    // divisor, so approving/finalizing now would freeze an inflated LOP rate.
    // Resolve the cycle month from the targeted record when only payrollId
    // was supplied.
    let cycleMonth = month;
    if (!cycleMonth && payrollId) {
      const doc = await Payroll.findById(payrollId).select('month').lean().catch(() => null);
      cycleMonth = doc?.month || null;
    }
    if (cycleMonth && /^\d{4}-\d{2}$/.test(cycleMonth)) {
      const config = await getGlobalConfig().catch(() => ({}));
      const [cy, cm] = cycleMonth.split('-').map(Number);
      const { toDate } = getCycleRange(
        getPayrollDay(config.payrollStartDay, 26),
        getPayrollDay(config.payrollEndDay, 25),
        cy,
        cm - 1
      );
      const todayStr = new Date().toISOString().slice(0, 10);
      if (todayStr <= toDate) {
        return fail(`Cycle ${cycleMonth} ends ${toDate} — approve/finalize is blocked while the cycle is in progress (preview only).`, 400);
      }
    }

    if (action === 'approve') {
      const records = await Payroll.find({ ...filter, status: 'draft' }).select('userId');
      await Payroll.updateMany(
        { ...filter, status: 'draft' },
        { $set: { status: 'approved', approvedBy: user._id, approvedAt: new Date() } }
      );
      await Promise.all(records.map(r =>
        auditLog('Payroll Approved', 'Payroll', user._id, `Payroll approved for ${month || payrollId}`, 'high', ip, null, r.userId)
      ));
      try {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
        await notify(admins.map(a => a._id), `Payroll Approved — ${month || payrollId}`, `${records.length} record(s) approved.`, 'payroll', null);
      } catch { /* non-fatal */ }
      return ok({ updated: records.length, status: 'approved' });
    }

    // finalize
    const records = await Payroll.find({ ...filter, status: 'approved' }).select('userId');
    await Payroll.updateMany(
      { ...filter, status: 'approved' },
      { $set: { status: 'finalized', finalizedBy: user._id, finalizedAt: new Date() } }
    );
    await Promise.all(records.map(r =>
      auditLog('Payroll Finalized', 'Payroll', user._id, `Payroll finalized for ${month || payrollId}`, 'high', ip, null, r.userId)
    ));
    try {
      const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
      await notify(admins.map(a => a._id), `Payroll Finalized — ${month || payrollId}`, `${records.length} record(s) finalized and locked.`, 'payroll', null);
    } catch { /* non-fatal */ }
    return ok({ updated: records.length, status: 'finalized' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
