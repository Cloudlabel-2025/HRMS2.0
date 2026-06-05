import { connectDB } from '@/lib/db';
import { Leave } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { notify } from '@/lib/notify';
import { z } from 'zod';

const ActionSchema = z.object({
  action:     z.enum(['approved', 'rejected', 'held']),
  holdReason: z.string().min(1).max(500).optional(),
}).refine(d => d.action !== 'held' || !!d.holdReason, {
  message: 'holdReason is required when action is held', path: ['holdReason'],
});

function resolveStatus(leave) {
  // Admin rejected → done
  if (leave.adminApproval === 'rejected') return 'rejected';
  // Admin hasn't acted yet
  if (!leave.adminApproval || leave.adminApproval === 'pending') return 'pending';
  // Admin approved — any hold from team = still pending for admin to review
  if (leave.teamAdminApproval === 'held' || leave.tlApproval === 'held') return 'pending';
  if (leave.teamAdminApproval === 'rejected' || leave.tlApproval === 'rejected') return 'pending';
  // Admin approved + no holds/rejections = fully approved
  return 'approved';
}

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const { id: _x, ...rest } = body;

    const result = ActionSchema.safeParse(rest);
    if (!result.success) {
      const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return fail('Validation failed: ' + msg, 400);
    }
    const { action, holdReason } = result.data;

    const leave = await Leave.findById(id).populate('userId', 'name email _id');
    if (!leave) return fail('Leave not found', 404);

    const isAdmin     = ['super_admin', 'admin_full'].includes(user.role);
    const isTeamAdmin = user.role === 'team_admin';
    const isTeamLead  = user.role === 'team_lead';

    const hasObjection = leave.teamAdminApproval === 'held' || leave.tlApproval === 'held' ||
                         leave.teamAdminApproval === 'rejected' || leave.tlApproval === 'rejected';

    // Admin can't act on already rejected. Team roles can always act if admin approved.
    if (leave.status === 'rejected') return fail('This leave has already been finalised', 400);
    if (isAdmin && leave.status === 'approved' && !hasObjection) return fail('This leave is already approved with no objections', 400);

    const applicantId   = leave.userId._id || leave.userId;
    const applicantName = leave.userId.name || 'Employee';

    if (isAdmin) {
      if (leave.adminApproval !== 'pending' && !hasObjection) {
        return fail('You have already actioned this leave', 400);
      }
      leave.adminApproval   = action;
      leave.adminApprovedBy = user._id;
      leave.adminApprovedAt = new Date();
      if (action === 'held') leave.adminHoldReason = holdReason;

      // When admin overrides (re-approves or rejects after objection), clear objection flags
      if (hasObjection) {
        leave.teamAdminApproval = 'pending';
        leave.tlApproval        = 'pending';
        leave.teamAdminHoldReason = '';
        leave.tlHoldReason        = '';
      }

      if (action === 'approved') {
        const notifyRoles = await User.find({ role: { $in: ['team_admin', 'team_lead'] }, status: 'active' }).select('_id');
        if (notifyRoles.length) {
          await notify(
            notifyRoles.map(u => u._id),
            'Leave Approved by Admin — Your Review Needed',
            `${applicantName}'s leave (${leave.from} to ${leave.to}) was approved by admin. You can hold or reject with a reason if you have any objection. Silence = no objection.`,
            'leave',
            leave._id
          );
        }
      }

      if (action === 'rejected') {
        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected by admin.`, 'leave', leave._id);
      }

    } else if (isTeamAdmin) {
      if (leave.adminApproval !== 'approved') return fail('Waiting for Admin to approve first', 400);
      if (leave.teamAdminApproval && leave.teamAdminApproval !== 'pending') return fail('You have already actioned this leave', 400);
      leave.teamAdminApproval   = action;
      leave.teamAdminApprovedBy = user._id;
      leave.teamAdminApprovedAt = new Date();
      if (action === 'held') leave.teamAdminHoldReason = holdReason;

      if (action === 'held' || action === 'rejected') {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
        if (admins.length) {
          await notify(
            admins.map(a => a._id),
            `Leave ${action === 'held' ? 'Held' : 'Rejected'} by Team Admin`,
            `Team Admin ${action === 'held' ? 'placed a hold' : 'rejected'} on ${applicantName}'s leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`,
            'leave',
            leave._id
          );
        }
        await notify(
          applicantId,
          `Your Leave has been ${action === 'held' ? 'Held' : 'Rejected'} by Team Admin`,
          `Team Admin ${action === 'held' ? 'placed a hold on' : 'rejected'} your leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`,
          'leave',
          leave._id
        );
      }

    } else if (isTeamLead) {
      if (leave.adminApproval !== 'approved') return fail('Waiting for Admin to approve first', 400);
      if (leave.tlApproval && leave.tlApproval !== 'pending') return fail('You have already actioned this leave', 400);
      leave.tlApproval   = action;
      leave.tlApprovedBy = user._id;
      leave.tlApprovedAt = new Date();
      if (action === 'held') leave.tlHoldReason = holdReason;

      if (action === 'held' || action === 'rejected') {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
        if (admins.length) {
          await notify(
            admins.map(a => a._id),
            `Leave ${action === 'held' ? 'Held' : 'Rejected'} by Team Lead`,
            `Team Lead ${action === 'held' ? 'placed a hold' : 'rejected'} on ${applicantName}'s leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`,
            'leave',
            leave._id
          );
        }
        await notify(
          applicantId,
          `Your Leave has been ${action === 'held' ? 'Held' : 'Rejected'} by Team Lead`,
          `Team Lead ${action === 'held' ? 'placed a hold on' : 'rejected'} your leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`,
          'leave',
          leave._id
        );
      }

    } else {
      return fail('Access denied', 403);
    }

    const newStatus = resolveStatus(leave);
    leave.status = newStatus;

    // Deduct balance on final approval
    if (newStatus === 'approved' && leave.type !== 'Loss of Pay') {
      const { Employee } = await import('@/lib/models/index');
      const emp = await Employee.findOne({ userId: applicantId });
      if (emp) {
        const currentBalance = emp.leaveBalance ?? 24;
        if (currentBalance < leave.days) {
          return fail(`Insufficient leave balance. Available: ${currentBalance} day(s), Requested: ${leave.days} day(s)`, 400);
        }
        emp.leaveBalance = currentBalance - leave.days;
        await emp.save();
      }
      // Notify employee of final approval
      await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved.`, 'leave', leave._id);
    }

    if (newStatus === 'rejected') {
      await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected.`, 'leave', leave._id);
    }

    await leave.save();

    await auditLog(
      `Leave ${action}`,
      'Leave',
      user._id,
      `${action} leave for ${leave.days} days (${leave.from} to ${leave.to})${action === 'held' ? ` — ${holdReason}` : ''}`,
      action === 'approved' ? 'medium' : 'low',
      req.headers.get('x-forwarded-for') || ''
    );

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
    if (leave.userId.toString() !== user._id.toString()) return fail('Access denied', 403);
    if (!['pending', 'approved'].includes(leave.status)) return fail('Cannot cancel an already processed leave', 400);

    if (leave.status === 'approved' && leave.type !== 'Loss of Pay') {
      const { Employee } = await import('@/lib/models/index');
      const emp = await Employee.findOne({ userId: leave.userId });
      if (emp) {
        emp.leaveBalance = (emp.leaveBalance ?? 0) + leave.days;
        await emp.save();
      }
    }

    await auditLog('Leave Cancelled', 'Leave', user._id, `Cancelled leave for ${leave.days} days`, 'low', req.headers.get('x-forwarded-for') || '');
    await leave.deleteOne();
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
