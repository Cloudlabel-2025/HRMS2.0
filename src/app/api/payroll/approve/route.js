import { connectDB } from '@/lib/db';
import { Payroll } from '@/lib/models/Payroll';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

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

    if (action === 'approve') {
      // draft → approved
      const result = await Payroll.updateMany(
        { ...filter, status: 'draft' },
        { $set: { status: 'approved', approvedBy: user._id, approvedAt: new Date() } }
      );
      await AuditLog.create({
        action: 'Payroll Approved', module: 'Payroll', userId: user._id,
        details: `${result.modifiedCount} payroll records approved for ${month || payrollId}`,
        severity: 'high',
      });
      return ok({ updated: result.modifiedCount, status: 'approved' });
    }

    // finalize — approved → finalized (locks record)
    const result = await Payroll.updateMany(
      { ...filter, status: 'approved' },
      { $set: { status: 'finalized', finalizedBy: user._id, finalizedAt: new Date() } }
    );
    await AuditLog.create({
      action: 'Payroll Finalized', module: 'Payroll', userId: user._id,
      details: `${result.modifiedCount} payroll records finalized for ${month || payrollId}`,
      severity: 'high',
    });
    return ok({ updated: result.modifiedCount, status: 'finalized' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
