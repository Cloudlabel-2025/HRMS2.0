import { connectDB } from '@/lib/db';
import { Payroll } from '@/lib/models/Payroll';
import { requireAuth, auditLog } from '@/lib/middleware';
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

    if (action === 'approve') {
      const records = await Payroll.find({ ...filter, status: 'draft' }).select('userId');
      await Payroll.updateMany(
        { ...filter, status: 'draft' },
        { $set: { status: 'approved', approvedBy: user._id, approvedAt: new Date() } }
      );
      await Promise.all(records.map(r =>
        auditLog('Payroll Approved', 'Payroll', user._id, `Payroll approved for ${month || payrollId}`, 'high', ip, null, r.userId)
      ));
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
    return ok({ updated: records.length, status: 'finalized' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
