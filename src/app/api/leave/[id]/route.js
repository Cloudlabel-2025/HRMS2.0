import { connectDB } from '@/lib/db';
import { Leave, LeavePolicy, UserLeaveBalance, Holiday } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { notify } from '@/lib/notify';
import { isWorkingDay, getGlobalConfig } from '@/lib/payroll-cycle';
import { z } from 'zod';
import { canApproveLeave, canViewUser } from '@/lib/rbac';
import { isEmployer } from '@/lib/permissions';

const ActionSchema = z.object({
  action:     z.enum(['approved', 'rejected', 'held']),
  holdReason: z.string().min(1).max(500).optional(),
}).refine(d => d.action !== 'held' || !!d.holdReason, {
  message: 'holdReason is required when action is held', path: ['holdReason'],
});

// Optimistic-concurrency save for leave balances (schema has optimisticConcurrency).
// Concurrent approvals for the same user throw VersionError -> 409, no double-deduct.
async function saveBalanceOrConflict(balance) {
  try {
    await balance.save();
  } catch (e) {
    if (e?.name === 'VersionError') {
      const err = new Error('Leave balance changed concurrently. Please retry.');
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }
}

// Symmetric period-usage revert for cancel/reject (approve adds, cancel subtracts).
async function revertPeriodUsage(balanceEntry, typeConfig, cycleStart, fromStr, paidDays) {
  try {
    if (!typeConfig || !(typeConfig.maxUsagePerPeriod > 0) || !(paidDays > 0)) return;
    const arr = balanceEntry.periodUsage || [];
    const { getRelativePeriod } = require('@/lib/leave/accrual');
    const code = getRelativePeriod(typeConfig.usagePeriod, cycleStart, new Date(fromStr));
    const row = arr.find(p => (p.period || p.periodCode) === code);
    if (row) row.used = Math.max(0, Number(row.used || 0) - Number(paidDays || 0));
  } catch { /* non-fatal */ }
}

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

function getActiveWorkflow(policy, typeCode) {
  const typeConfig = policy?.leaveTypeConfigs?.find(config => config.code === typeCode);
  return typeConfig?.useCustomWorkflow && typeConfig.approvalWorkflow?.length
    ? typeConfig.approvalWorkflow
    : (policy?.approvalWorkflow || []);
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

    if (!leave.typeCode) {
      if (leave.type) {
        const t = leave.type.toLowerCase();
        if (t.includes('casual')) leave.typeCode = 'CL';
        else if (t.includes('sick')) leave.typeCode = 'SL';
        else if (t.includes('privilege') || t.includes('earned')) leave.typeCode = 'PL';
        else if (t.includes('loss') || t.includes('unpaid') || t === 'lop') leave.typeCode = 'LOP';
        else if (t.includes('maternity')) leave.typeCode = 'ML';
        else if (t.includes('paternity')) leave.typeCode = 'PATL';
        else leave.typeCode = leave.type;
      } else {
        leave.typeCode = 'CL';
      }
    }

    if (leave.status === 'rejected') return fail('This leave has already been finalised', 400);

    const applicantId = leave.userId._id || leave.userId;
    const applicantName = leave.userId.name || 'Employee';
    const applicantIsEmployer = !!leave.userId?.role && isEmployer(leave.userId.role);
    if (applicantId.toString() === user._id.toString()) return fail('You cannot approve your own leave request', 403);

    // Try to use dynamic workflow first
    const policy = leave.policyId
      ? await LeavePolicy.findById(leave.policyId)
      : null;

    if (policy && leave.workflowApprovals?.length > 0) {
      // ── Dynamic workflow approval ──
      const workflow = leave.workflowApprovals;
      const workflowDef = getActiveWorkflow(policy, leave.typeCode);

      if (!['super_admin', 'admin_full'].includes(user.role) && !await canViewUser(user, leave.userId)) return fail('Access denied', 403);
      if (!canApproveLeave(user, leave.userId)) return fail('You are not allowed to approve this employee\'s leave request', 403);

      // Find the current step this user can act on
      const pendingStep = workflow.find(step => step.action === 'pending');
      const pendingStepDef = pendingStep && workflowDef.find(step => step.step === pendingStep.step);
      const approverStep = pendingStepDef ? pendingStep : null;

      if (!approverStep) {
        // Check if user can override (admin approving after a hold)
        const heldStep = workflow.find(s => s.action === 'held' || s.action === 'rejected');
        const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
        if (heldStep && isAdmin) {
          // Admin override — approve or reject
          approveStep(heldStep, action, user, holdReason);
          // If re-approving after hold, reset OTHER held steps (keep the overridden one approved)
          if (action === 'approved') {
            workflow.forEach(s => {
              if (s !== heldStep && (s.action === 'held' || s.action === 'rejected')) {
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

              // Update periodic usage metrics — split across working days for cross-period spans
              if (typeConfig && typeConfig.maxUsagePerPeriod > 0) {
                const { recordPeriodUsageSplit } = require('@/lib/leave/accrual');
                recordPeriodUsageSplit(entry, typeConfig.usagePeriod, balance.cycleStart, leave.from, leave.to, paidDays, { halfDay: !!leave.halfDay });
              }

              await saveBalanceOrConflict(balance);
            }
          }
        }

        leave.balanceApplied = true;
        await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved.`, 'leave', leave._id);
      }

      if (newStatus === 'rejected') {
        // Restore pending balance; if balance was already applied (used),
        // reverse used as well and revert period usage symmetrically.
        const now = new Date();
        const cycleStart = new Date(now.getFullYear(), 0, 1);
        const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
        if (balance) {
          const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
          if (entry) {
            const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
            if (leave.balanceApplied) {
              entry.used = Math.max(0, (entry.used || 0) - paidDays);
              const typeConfig = policy.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
              await revertPeriodUsage(entry, typeConfig, balance.cycleStart, leave.from, paidDays);
              leave.balanceApplied = false;
            } else {
              entry.pending = Math.max(0, (entry.pending || 0) - paidDays);
            }
            await saveBalanceOrConflict(balance);
          }
        }

        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected.`, 'leave', leave._id);
      }

      // Notify next step approvers if approved
      if (action === 'approved') {
        const currentStepIndex = workflowDef.findIndex(step => step.step === approverStep?.step);
        const nextStep = currentStepIndex >= 0 ? workflowDef[currentStepIndex + 1] : null;
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

            // Convert an existing absent/empty record into leave so the UI,
            // attendance and payroll agree (same date never stays absent).
            // Half-day leave creates a half_day attendance row (0.5 credit).
            const isHalf = !!leave.halfDay && leave.from === leave.to;
            await Attendance.findOneAndUpdate(
              { userId: leave.userId, date: dateStr },
              { $set: { userId: leave.userId, date: dateStr, status: isHalf ? 'half_day' : 'leave', relatedLeaveId: leave._id, approvedHalfDayLeave: isHalf } },
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

    async function materializeLeaveAttendance(targetLeave) {
      if (targetLeave.status !== 'approved') return;
      const isEmp = !!(targetLeave.userId?.role && isEmployer(targetLeave.userId.role));
      if (isEmp) return;
      try {
        const cfg = await getGlobalConfig();
        const fromDate = new Date(targetLeave.from + 'T00:00:00');
        const toDate = new Date(targetLeave.to + 'T00:00:00');
        const holidays = await Holiday.find({ date: { $gte: targetLeave.from, $lte: targetLeave.to } }).lean();
        for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
          const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          if (!isWorkingDay(dateStr, cfg, holidays)) continue;
          const isHalf = !!targetLeave.halfDay && targetLeave.from === targetLeave.to;
          await Attendance.findOneAndUpdate(
            { userId: targetLeave.userId._id || targetLeave.userId, date: dateStr },
            { $set: { userId: targetLeave.userId._id || targetLeave.userId, date: dateStr, status: isHalf ? 'half_day' : 'leave', relatedLeaveId: targetLeave._id, approvedHalfDayLeave: isHalf } },
            { upsert: true, new: true }
          );
        }
      } catch (e) { console.error('Failed to materialize SME leave attendance:', e?.message || e); }
    }

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
      if (action === 'approved') await materializeLeaveAttendance(leave);
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

            await saveBalanceOrConflict(balance);
          }
        }
      }
      leave.balanceApplied = true;
      await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved.`, 'leave', leave._id);
    }

    if (newStatus === 'rejected') {
      // Restore balance symmetrically (legacy path had no restore at all).
      const now = new Date();
      const cycleStart = new Date(now.getFullYear(), 0, 1);
      const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
      if (balance) {
        const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
        if (entry) {
          const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
          if (leave.balanceApplied) {
            entry.used = Math.max(0, (entry.used || 0) - paidDays);
            const typeConfig = policy?.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
            await revertPeriodUsage(entry, typeConfig, balance.cycleStart, leave.from, paidDays);
            leave.balanceApplied = false;
          } else {
            entry.pending = Math.max(0, (entry.pending || 0) - paidDays);
          }
          await saveBalanceOrConflict(balance);
        }
      }
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

          const isHalf = !!leave.halfDay && leave.from === leave.to;
          await Attendance.findOneAndUpdate(
            { userId: leave.userId, date: dateStr },
            { $set: { userId: leave.userId, date: dateStr, status: isHalf ? 'half_day' : 'leave', relatedLeaveId: leave._id, approvedHalfDayLeave: isHalf } },
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
    return fail(e.message, e.statusCode || 500);
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

    // Finalized payroll guard: cancelling an approved leave inside a locked
    // cycle must go through retro adjustment, not silent delete.
    if (leave.status === 'approved') {
      const { Payroll } = await import('@/lib/models/Payroll');
      const { getGlobalConfig: getCfg, getPayrollDay: getDay, getCycleRange: getRange, getCycleMonth: getMonth } = await import('@/lib/payroll-cycle');
      const cfg = await getCfg();
      const { year, month } = getMonth(leave.from, getDay(cfg.payrollStartDay, 26));
      const cycMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
      const locked = await Payroll.findOne({ userId: leave.userId, month: cycMonth, status: 'finalized' }).lean();
      if (locked) {
        leave.status = 'cancelled';
        leave.isRetroactive = true;
        leave.retroAdjustedInPayroll = false;
        await leave.save();
        await auditLog('Leave Cancel Retro-Flagged', 'Leave', user._id, `Cancel of approved leave ${leave.from} to ${leave.to} flagged retro (payroll ${cycMonth} finalized)`, 'medium', req.headers.get('x-forwarded-for') || '', null, user._id);
        return ok({ retro: true, message: 'Payroll for this cycle is finalized. Cancellation flagged for retro adjustment in the next run.' });
      }
    }

    // Restore balance (isPaid from policy, not hard-coded LOP only)
    const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
    let isPaidDelete = leave.typeCode !== 'LOP';
    try {
      const pol = leave.policyId ? await LeavePolicy.findById(leave.policyId).select('leaveTypeConfigs').lean() : null;
      const tc = pol?.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
      if (tc) isPaidDelete = tc.isPaid ?? true;
    } catch { /* default */ }
    if (leave.status === 'approved' && leave.balanceApplied !== false && isPaidDelete && paidDays > 0) {
      const now = new Date();
      const cycleStart = new Date(now.getFullYear(), 0, 1);
      const balance = await UserLeaveBalance.findOne({ userId: leave.userId, cycleStart });
      if (balance) {
        const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
        if (entry) {
          entry.used = Math.max(0, (entry.used || 0) - paidDays);
          try {
            const pol2 = leave.policyId ? await LeavePolicy.findById(leave.policyId).select('leaveTypeConfigs').lean() : null;
            await revertPeriodUsage(entry, pol2?.leaveTypeConfigs?.find(c => c.code === leave.typeCode), balance.cycleStart, leave.from, paidDays);
          } catch { /* non-fatal */ }
          await saveBalanceOrConflict(balance);
        }
      }
    } else if (leave.status === 'pending' && paidDays > 0) {
      // Restore pending (single branch — a pending leave only ever holds
      // pending balance, never used).
      const now = new Date();
      const cycleStart = new Date(now.getFullYear(), 0, 1);
      const balance = await UserLeaveBalance.findOne({ userId: leave.userId, cycleStart });
      if (balance) {
        const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
        if (entry) {
          entry.pending = Math.max(0, (entry.pending || 0) - paidDays);
          await saveBalanceOrConflict(balance);
        }
      }
    }

    await auditLog('Leave Cancelled', 'Leave', user._id, `Cancelled leave for ${leave.days} days`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    // Clean up linked attendance rows so the day returns to absent/missing
    // (payroll gap) instead of orphaned leave.
    try {
      await Attendance.deleteMany({ relatedLeaveId: leave._id });
    } catch { /* non-fatal */ }
    await leave.deleteOne();
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, e.statusCode || 500);
  }
}
