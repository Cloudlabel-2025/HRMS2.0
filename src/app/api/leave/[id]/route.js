import { connectDB } from '@/lib/db';
import { Leave, LeavePolicy, UserLeaveBalance, Holiday } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { notify } from '@/lib/notify';
import { isWorkingDay, getGlobalConfig } from '@/lib/payroll-cycle';
import { z } from 'zod';
import { canViewUser } from '@/lib/rbac';
import { isEmployer } from '@/lib/permissions';

const ActionSchema = z.object({
  action:     z.enum(['approved', 'rejected', 'held']),
  holdReason: z.string().min(1).max(500).optional(),
}).refine(d => d.action !== 'held' || !!d.holdReason, {
  message: 'holdReason is required when action is held', path: ['holdReason'],
});

function resolveStatus(leave) {
  const workflow = leave.workflowApprovals || [];

  // Find all "approve" type steps that are required
  const approveSteps = workflow.filter(s => s.actionType === 'approve');

  // If any required approve step is rejected → final reject
  const anyRejected = approveSteps.some(s => s.action === 'rejected');
  if (anyRejected) return 'rejected';

  // If any approve step is held → still pending (admin needs to review)
  const anyHeld = approveSteps.some(s => s.action === 'held');
  if (anyHeld) return 'pending';

  // All approve steps must be approved
  const allApproved = approveSteps.length > 0 && approveSteps.every(s => s.action === 'approved');

  // For review-type steps, they don't block final approval (they can object but don't need to act)
  if (allApproved) return 'approved';

  // Fallback to legacy logic
  if (leave.adminApproval === 'rejected') return 'rejected';
  if (!leave.adminApproval || leave.adminApproval === 'pending') return 'pending';
  if (leave.teamAdminApproval === 'held' || leave.tlApproval === 'held') return 'pending';
  if (leave.teamAdminApproval === 'rejected' || leave.tlApproval === 'rejected') return 'pending';
  if (leave.adminApproval === 'approved') return 'approved';
  return leave.status;
}

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const result = ActionSchema.safeParse(body);
    if (!result.success) {
      const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return fail('Validation failed: ' + msg, 400);
    }
    const { action, holdReason } = result.data;

    const leave = await Leave.findById(id).populate('userId', 'name email _id department role');
    if (!leave) return fail('Leave not found', 404);

    if (leave.status === 'rejected') return fail('This leave has already been finalised', 400);

    const applicantId = leave.userId._id || leave.userId;
    const applicantName = leave.userId.name || 'Employee';
    const applicantIsEmployer = !!leave.userId?.role && isEmployer(leave.userId.role);

    // Try to use dynamic workflow first
    const policy = leave.policyId
      ? await LeavePolicy.findById(leave.policyId)
      : null;

    if (policy && leave.workflowApprovals?.length > 0) {
      // ── Dynamic workflow approval ──
      const workflow = leave.workflowApprovals;

      // Find the current step this user can act on
      const approverStep = workflow.find(s => {
        if (s.action !== 'pending') return false;
        const stepDef = policy.approvalWorkflow.find(w => w.step === s.step);
        return stepDef && stepDef.approverRoles.includes(user.role);
      });

      if (!approverStep) {
        // Check if user can override (admin approving after a hold)
        const heldStep = workflow.find(s => s.action === 'held' || s.action === 'rejected');
        const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
        if (heldStep && isAdmin) {
          // Admin override — approve or reject
          approveStep(heldStep, action, user, holdReason);
          // If re-approving after hold, reset held steps
          if (action === 'approved') {
            workflow.forEach(s => {
              if (s.action === 'held' || s.action === 'rejected') {
                s.action = 'pending';
                s.holdReason = '';
              }
            });
          }
        } else {
          return fail('No pending approval step available for your role', 400);
        }
      } else {
        approveStep(approverStep, action, user, holdReason);
      }

      if (!['super_admin', 'admin_full'].includes(user.role) && !await canViewUser(user, leave.userId)) return fail('Access denied', 403);

      function approveStep(stepObj, act, actor, reason) {
        stepObj.action = act;
        stepObj.approvedBy = actor._id;
        stepObj.approvedAt = new Date();
        if (act === 'held') stepObj.holdReason = reason || '';
      }

      const newStatus = resolveStatus(leave);
      leave.status = newStatus;

      // Handle final approval — deduct balance
      if (newStatus === 'approved' && !leave.balanceApplied) {
        const isPaid = policy.leaveTypeConfigs?.find(
          c => c.code === leave.typeCode
        )?.isPaid ?? true;

        const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;

        if (isPaid && paidDays > 0) {
          const now = new Date();
          const cycleStart = new Date(now.getFullYear(), 0, 1);
          const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
          if (balance) {
            const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
            if (entry) {
              const typeConfig = policy.leaveTypeConfigs?.find(
                c => c.code === leave.typeCode
              );
              
              const currentAvailable = entry.allocated + entry.carriedForward - entry.used - entry.pending;
              if (entry.pending >= paidDays) {
                entry.pending -= paidDays;
                entry.used += paidDays;
              } else if (currentAvailable >= paidDays) {
                entry.used += paidDays;
                entry.pending = Math.max(0, entry.pending - paidDays);
              }

              // Update periodic usage metrics
              if (typeConfig && typeConfig.maxUsagePerPeriod > 0) {
                const { recordPeriodUsage } = require('@/lib/leave/accrual');
                recordPeriodUsage(entry, typeConfig.usagePeriod, balance.cycleStart, new Date(leave.from), paidDays);
              }

              await balance.save();
            }
          }
        }

        leave.balanceApplied = true;
        await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved.`, 'leave', leave._id);
      }

      if (newStatus === 'rejected') {
        // Restore pending balance
        const now = new Date();
        const cycleStart = new Date(now.getFullYear(), 0, 1);
        const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
        if (balance) {
          const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
          if (entry) {
            const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
            entry.pending = Math.max(0, (entry.pending || 0) - paidDays);
            await balance.save();
          }
        }

        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected.`, 'leave', leave._id);
      }

      // Notify next step approvers if approved
      if (action === 'approved') {
        const currentStepIndex = policy.approvalWorkflow?.findIndex(w => w.step === approverStep?.step);
        const nextStep = policy.approvalWorkflow?.[currentStepIndex !== undefined ? currentStepIndex + 1 : -1];
        if (nextStep) {
          const nextApprovers = await User.find({ role: { $in: nextStep.approverRoles }, status: 'active' }).select('_id');
          if (nextApprovers.length) {
            await notify(
              nextApprovers.map(a => a._id),
              `Leave ${action === 'approved' ? 'Approved' : 'Rejected'} — ${nextStep.label} Review`,
              `${applicantName}'s leave (${leave.from} to ${leave.to}) needs your review.`,
              'leave',
              leave._id
            );
          }
        }
      }

      await leave.save();

      // Create attendance records for each working day of the leave
      if (newStatus === 'approved' && !applicantIsEmployer) {
        try {
          const config = await getGlobalConfig();
          const fromDate = new Date(leave.from + 'T00:00:00');
          const toDate = new Date(leave.to + 'T00:00:00');
          const holidays = await Holiday.find({
            date: { $gte: leave.from, $lte: leave.to }
          }).lean();

          for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            if (!isWorkingDay(dateStr, config, holidays)) continue;

            const existing = await Attendance.findOne({ userId: leave.userId, date: dateStr });
            if (existing) continue;

            await Attendance.findOneAndUpdate(
              { userId: leave.userId, date: dateStr },
              { $set: { userId: leave.userId, date: dateStr, status: 'leave' } },
              { upsert: true, new: true }
            );
          }
        } catch (e) {
          console.error('Failed to create leave attendance records:', e);
        }
      }

      await auditLog(
        `Leave ${action}`,
        'Leave',
        user._id,
        `${action} leave for ${leave.days} days (${leave.from} to ${leave.to})${action === 'held' ? ` — ${holdReason}` : ''}`,
        action === 'approved' ? 'medium' : 'low',
        req.headers.get('x-forwarded-for') || '',
        null,
        applicantId
      );

      return ok(leave);
    }

    // ── Fallback to legacy approval logic ──
    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const isTeamAdmin = user.role === 'team_admin';
    const isTeamLead = user.role === 'team_lead';

    const hasObjection = leave.teamAdminApproval === 'held' || leave.tlApproval === 'held' ||
                         leave.teamAdminApproval === 'rejected' || leave.tlApproval === 'rejected';

    if (leave.status === 'rejected') return fail('This leave has already been finalised', 400);
    if (isAdmin && leave.status === 'approved' && !hasObjection) return fail('This leave is already approved with no objections', 400);

    // ── SME Leave: simple admin approval, skip multi-level chain ──
    if (leave.smeId) {
      if (!isAdmin) return fail('Access denied', 403);
      leave.adminApproval   = action;
      leave.adminApprovedBy = user._id;
      leave.adminApprovedAt = new Date();
      if (action === 'held') return fail('Hold is not supported for SME leaves', 400);
      leave.status = action === 'approved' ? 'approved' : 'rejected';
      if (action === 'rejected') {
        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected.`, 'leave', leave._id);
      } else {
        await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved.`, 'leave', leave._id);
      }
      await leave.save();
      await auditLog(`Leave ${action}`, 'Leave', user._id, `${action} SME leave for ${leave.days} days (${leave.from} to ${leave.to})`, action === 'approved' ? 'medium' : 'low', req.headers.get('x-forwarded-for') || '', null, applicantId);
      return ok(leave);
    }
    if (isAdmin) {
      if (leave.adminApproval !== 'pending' && !hasObjection) {
        return fail('You have already actioned this leave', 400);
      }
      leave.adminApproval = action;
      leave.adminApprovedBy = user._id;
      leave.adminApprovedAt = new Date();
      if (action === 'held') leave.adminHoldReason = holdReason;

      if (hasObjection) {
        leave.teamAdminApproval = 'pending';
        leave.tlApproval = 'pending';
        leave.teamAdminHoldReason = '';
        leave.tlHoldReason = '';
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
      if (!['super_admin', 'admin_full'].includes(user.role) && !await canViewUser(user, leave.userId)) return fail('Access denied', 403);
      if (leave.adminApproval !== 'approved') return fail('Waiting for Admin to approve first', 400);
      if (leave.teamAdminApproval && leave.teamAdminApproval !== 'pending') return fail('You have already actioned this leave', 400);
      leave.teamAdminApproval = action;
      leave.teamAdminApprovedBy = user._id;
      leave.teamAdminApprovedAt = new Date();
      if (action === 'held') leave.teamAdminHoldReason = holdReason;

      if (action === 'held' || action === 'rejected') {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
        if (admins.length) {
          await notify(admins.map(a => a._id), `Leave ${action === 'held' ? 'Held' : 'Rejected'} by Team Admin`, `Team Admin ${action === 'held' ? 'placed a hold' : 'rejected'} on ${applicantName}'s leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`, 'leave', leave._id);
        }
        await notify(applicantId, `Your Leave has been ${action === 'held' ? 'Held' : 'Rejected'} by Team Admin`, `Team Admin ${action === 'held' ? 'placed a hold on' : 'rejected'} your leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`, 'leave', leave._id);
      }

    } else if (isTeamLead) {
      if (!['super_admin', 'admin_full'].includes(user.role) && !await canViewUser(user, leave.userId)) return fail('Access denied', 403);
      if (leave.adminApproval !== 'approved') return fail('Waiting for Admin to approve first', 400);
      if (leave.tlApproval && leave.tlApproval !== 'pending') return fail('You have already actioned this leave', 400);
      leave.tlApproval = action;
      leave.tlApprovedBy = user._id;
      leave.tlApprovedAt = new Date();
      if (action === 'held') leave.tlHoldReason = holdReason;

      if (action === 'held' || action === 'rejected') {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
        if (admins.length) {
          await notify(admins.map(a => a._id), `Leave ${action === 'held' ? 'Held' : 'Rejected'} by Team Lead`, `Team Lead ${action === 'held' ? 'placed a hold' : 'rejected'} on ${applicantName}'s leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`, 'leave', leave._id);
        }
        await notify(applicantId, `Your Leave has been ${action === 'held' ? 'Held' : 'Rejected'} by Team Lead`, `Team Lead ${action === 'held' ? 'placed a hold on' : 'rejected'} your leave (${leave.from} to ${leave.to}). Reason: ${holdReason}`, 'leave', leave._id);
      }

    } else {
      return fail('Access denied', 403);
    }

    const newStatus = resolveStatus(leave);
    leave.status = newStatus;

    if (newStatus === 'approved' && !leave.balanceApplied) {
      // Look up isPaid from policy config for this leave type
      let isPaidLegacy = true;
      if (policy) {
        const tc = policy.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
        if (tc) isPaidLegacy = tc.isPaid ?? true;
      } else if (leave.typeCode === 'LOP') {
        isPaidLegacy = false;
      }
      const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
      if (isPaidLegacy && paidDays > 0) {
        const now = new Date();
        const cycleStart = new Date(now.getFullYear(), 0, 1);
        const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
        if (balance) {
          const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
          if (entry) {
            const typeConfig = policy?.leaveTypeConfigs?.find(
              c => c.code === leave.typeCode
            );

            const currentAvailable = entry.allocated + entry.carriedForward - entry.used - entry.pending;
            if (entry.pending >= paidDays) {
              entry.pending -= paidDays;
              entry.used += paidDays;
            } else if (currentAvailable >= paidDays) {
              entry.used += paidDays;
              entry.pending = Math.max(0, entry.pending - paidDays);
            }

            if (typeConfig && typeConfig.maxUsagePerPeriod > 0) {
              const { recordPeriodUsage } = require('@/lib/leave/accrual');
              recordPeriodUsage(entry, typeConfig.usagePeriod, balance.cycleStart, new Date(leave.from), paidDays);
            }

            await balance.save();
          }
        }
      }
      leave.balanceApplied = true;
      await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved.`, 'leave', leave._id);
    }

    if (newStatus === 'rejected') {
      await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected.`, 'leave', leave._id);
    }

    await leave.save();

    // Create attendance records for each working day of the leave
    if (newStatus === 'approved' && !applicantIsEmployer) {
      try {
        const config = await getGlobalConfig();
        const fromDate = new Date(leave.from + 'T00:00:00');
        const toDate = new Date(leave.to + 'T00:00:00');
        const holidays = await Holiday.find({
          date: { $gte: leave.from, $lte: leave.to }
        }).lean();

        for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
          const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          if (!isWorkingDay(dateStr, config, holidays)) continue;

          const existing = await Attendance.findOne({ userId: leave.userId, date: dateStr });
          if (existing) continue;

          await Attendance.findOneAndUpdate(
            { userId: leave.userId, date: dateStr },
            { $set: { userId: leave.userId, date: dateStr, status: 'leave' } },
            { upsert: true, new: true }
          );
        }
      } catch (e) {
        console.error('Failed to create leave attendance records:', e);
      }
    }

    await auditLog(
      `Leave ${action}`,
      'Leave',
      user._id,
      `${action} leave for ${leave.days} days (${leave.from} to ${leave.to})${action === 'held' ? ` — ${holdReason}` : ''}`,
      action === 'approved' ? 'medium' : 'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      applicantId
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

    const leave = await Leave.findById(id).lean();
    if (!leave) return fail('Leave not found', 404);
    if (leave.userId.toString() !== user._id.toString()) return fail('Access denied', 403);
    if (!['pending', 'approved'].includes(leave.status)) return fail('Cannot cancel an already processed leave', 400);

    // Restore balance
    const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
    let isPaidDelete = true;
    if (leave.typeCode === 'LOP') {
      isPaidDelete = false;
    }
    if (leave.status === 'approved' && leave.balanceApplied !== false && isPaidDelete && paidDays > 0) {
      const now = new Date();
      const cycleStart = new Date(now.getFullYear(), 0, 1);
      const balance = await UserLeaveBalance.findOne({ userId: leave.userId, cycleStart });
      if (balance) {
        const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
        if (entry) {
          entry.used = Math.max(0, (entry.used || 0) - paidDays);
          await balance.save();
        }
      }
    } else if (leave.status === 'pending' && paidDays > 0) {
      // Restore pending
      const now = new Date();
      const cycleStart = new Date(now.getFullYear(), 0, 1);
      const balance = await UserLeaveBalance.findOne({ userId: leave.userId, cycleStart });
      if (balance) {
        const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
        if (entry) {
          entry.pending = Math.max(0, (entry.pending || 0) - paidDays);
          await balance.save();
        }
      }
    }

    await auditLog('Leave Cancelled', 'Leave', user._id, `Cancelled leave for ${leave.days} days`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    await leave.deleteOne();
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
