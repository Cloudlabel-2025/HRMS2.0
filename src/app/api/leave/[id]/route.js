import { connectDB } from '@/lib/db';
import Leave from '@/lib/models/Leave';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { action } = await req.json(); // 'approved' | 'rejected'
    if (!['approved', 'rejected'].includes(action)) return fail('Invalid action');

    const leave = await Leave.findById(id);
    if (!leave) return fail('Leave not found', 404);

    if (user.role === 'team_admin') {
      if (leave.teamAdminApproval !== 'pending') return fail('Already actioned by Team Admin');
      leave.teamAdminApproval   = action;
      leave.teamAdminApprovedBy = user._id;
      leave.teamAdminApprovedAt = new Date();
      if (action === 'rejected') leave.status = 'rejected';

    } else if (user.role === 'team_lead') {
      if (leave.teamAdminApproval !== 'approved') return fail('Awaiting Team Admin approval first');
      if (leave.tlApproval !== 'pending') return fail('Already actioned by Team Lead');
      leave.tlApproval   = action;
      leave.tlApprovedBy = user._id;
      leave.tlApprovedAt = new Date();
      if (action === 'rejected') leave.status = 'rejected';

    } else if (['super_admin', 'admin_full'].includes(user.role)) {
      if (leave.tlApproval !== 'approved') return fail('Awaiting Team Lead approval first');
      if (leave.mgmtApproval !== 'pending') return fail('Already actioned by Management');
      leave.mgmtApproval   = action;
      leave.mgmtApprovedBy = user._id;
      leave.mgmtApprovedAt = new Date();
      leave.status         = action;
      
      if (action === 'approved') {
        const { Employee } = await import('@/lib/models/index');
        const emp = await Employee.findOne({ userId: leave.userId });
        if (emp) {
          emp.leaveBalance = (emp.leaveBalance || 24) - leave.days;
          await emp.save();
        }
      }

    } else {
      return fail('Access denied', 403);
    }

    await leave.save();
    return ok(leave);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const leave = await Leave.findById(id);
    if (!leave) return fail('Leave not found', 404);

    // Only the owner can cancel, and only if still pending
    if (leave.userId.toString() !== user._id.toString()) return fail('Access denied', 403);
    if (leave.status !== 'pending') return fail('Cannot cancel a leave that is already processed');

    await leave.deleteOne();
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
