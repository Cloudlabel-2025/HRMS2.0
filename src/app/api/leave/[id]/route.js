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
import { getRelativePeriod, recordPeriodUsageSplit, recordPeriodUsage } from '@/lib/leave/accrual';
import { reopenPayrollForLeave } from '@/lib/payroll-reopen';

const ActionSchema = z.object({
  action:     z.enum(['approved', 'rejected', 'held']),
  holdReason: z.string().min(1).max(500).optional(),
  reason:     z.string().min(1).max(500).optional(),
}).refine(d => d.action !== 'held' || !!(d.holdReason || d.reason), {
  message: 'holdReason is required when action is held', path: ['holdReason'],
}).refine(d => d.action !== 'rejected' || !!(d.reason || d.holdReason), {
  message: 'reason is required when action is rejected', path: ['reason'],
});

// ── Final-action attribution helper ──
// Sets denormalized lastAction* + appends to actionHistory (powers
// "Approved by / Rejected by / Held by" display). Kept in one place so the
// dynamic, SME and legacy paths stay consistent.
function recordAction(leave, action, actor, reason, step = null, label = '') {
  const map = { approved: 'approved', rejected: 'rejected', held: 'held' };
  leave.lastAction = map[action] || action;
  leave.lastActionBy = actor?._id || actor || null;
  leave.lastActionAt = new Date();
  leave.lastActionReason = reason || '';
  leave.actionHistory = leave.actionHistory || [];
  leave.actionHistory.push({
    action: map[action] || action,
    actor: actor?._id || actor,
    at: new Date(),
    step,
    label: label || '',
    reason: reason || '',
  });
}

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
    const { action } = result.data;
    // `reason` is the canonical reject/hold reason; `holdReason` kept for back-compat.
    const actionReason = (result.data.reason || result.data.holdReason || '').trim();

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

    const actorName = user.name || 'Admin';
    const isAdminUser = ['super_admin', 'admin_full'].includes(user.role);
    // Post-approval Hold/Reject is admin-only. Non-admins can only act on pending leaves.
    if (leave.status === 'approved' && (action === 'held' || action === 'rejected') && !isAdminUser) {
      return fail('Only an admin can hold or reject an already-approved leave', 403);
    }
    if (leave.status === 'approved' && action === 'approved') {
      return fail('This leave is already approved', 400);
    }
    const prevStatus = leave.status;

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

      let actedStep = approverStep;
      let actedStepDef = pendingStepDef;
      if (!approverStep) {
        // Check if user can override (admin acting after a hold/reject,
        // or admin holding/rejecting an already-approved leave)
        const heldStep = workflow.find(s => s.action === 'held' || s.action === 'rejected');
        const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
        const postApprovalOverride = prevStatus === 'approved'
          && (action === 'held' || action === 'rejected') && isAdmin;
        if ((heldStep && isAdmin) || postApprovalOverride) {
          // Admin override — approve, hold or reject.
          // For post-approval hold/reject, act on the last approved step so
          // the actor name is visible on the step that granted approval.
          const target = heldStep || [...workflow].reverse().find(s => s.action === 'approved') || workflow[workflow.length - 1];
          approveStep(target, action, user, actionReason);
          actedStep = target;
          actedStepDef = workflowDef.find(d => d.step === target.step);
          // If re-approving after hold, reset OTHER held steps (keep the overridden one approved)
          if (action === 'approved') {
            workflow.forEach(s => {
              if (s !== target && (s.action === 'held' || s.action === 'rejected')) {
                s.action = 'pending';
                s.holdReason = '';
              }
            });
          }
        } else {
          return fail('No pending approval step available for your role', 400);
        }
      } else {
        approveStep(approverStep, action, user, actionReason);
      }

      function approveStep(stepObj, act, actor, reason) {
        stepObj.action = act;
        stepObj.approvedBy = actor._id;
        stepObj.approvedAt = new Date();
        // Hold AND reject reasons share the same visible field so the actor's
        // note is always shown next to the step ("Held/Rejected by X — reason").
        if (act === 'held' || act === 'rejected') stepObj.holdReason = reason || '';
        else if (act === 'approved') stepObj.holdReason = '';
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
                recordPeriodUsageSplit(entry, typeConfig.usagePeriod, balance.cycleStart, leave.from, leave.to, paidDays, { halfDay: !!leave.halfDay });
              }

              await saveBalanceOrConflict(balance);
            }
          }
        }

        leave.balanceApplied = true;
        await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved by ${actorName}.`, 'leave', leave._id);
      }

      // Re-assert the paid/unpaid split at APPROVAL time, not just at creation.
      // A PAID leave type is always paid in full — the balance is an
      // administrative flag and must never clamp payable days. This also
      // repairs legacy rows written before that rule, which could carry
      // unpaidDays > 0 on a paid leave type and silently become LOP.
      let payableWarning = null;
      if (newStatus === 'approved') {
        const isPaidType = policy.leaveTypeConfigs?.find(c => c.code === leave.typeCode)?.isPaid ?? true;
        leave.isPaid = isPaidType;
        if (isPaidType && (leave.unpaidDays || 0) > 0) {
          payableWarning = {
            typeCode: leave.typeCode,
            typeName: leave.type,
            repairedDays: Number(leave.unpaidDays || 0),
            message: `${leave.type} is a paid leave type. ${Number(leave.unpaidDays || 0)} day(s) previously marked unpaid have been restored to paid — no LOP will be applied.`,
          };
          leave.paidDays = leave.days;
          leave.unpaidDays = 0;
          await auditLog(
            'Leave LOP Repaired',
            'Leave',
            user._id,
            `Leave ${leave._id} (${leave.from} to ${leave.to}): ${payableWarning.repairedDays} unpaid day(s) restored — ${leave.type} is a paid leave type`,
            'high',
            req.headers.get('x-forwarded-for') || '',
            null,
            applicantId
          ).catch(() => {});
        }
        if (leave.paidDays == null) leave.paidDays = isPaidType ? leave.days : 0;
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

        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected by ${actorName}${actionReason ? `. Reason: ${actionReason}` : ''}.`, 'leave', leave._id);
      }

      // Post-approval Hold by admin: leave goes approved(used) -> pending.
      // Move used back to pending so the balance stays consistent, and drop
      // the materialized attendance rows (they are re-created on re-approval).
      if (prevStatus === 'approved' && newStatus === 'pending' && (action === 'held' || action === 'rejected')) {
        try {
          const now = new Date();
          const cycleStart = new Date(now.getFullYear(), 0, 1);
          const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
          if (balance) {
            const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
            if (entry) {
              const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
              if (leave.balanceApplied && (paidDays || 0) > 0) {
                entry.used = Math.max(0, (entry.used || 0) - paidDays);
                entry.pending = (entry.pending || 0) + paidDays;
                const typeConfig = policy.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
                await revertPeriodUsage(entry, typeConfig, balance.cycleStart, leave.from, paidDays);
                leave.balanceApplied = false;
                await saveBalanceOrConflict(balance);
              }
            }
          }
        } catch (e) { console.error('Post-approval hold balance reversal failed:', e?.message || e); }
        try { await Attendance.deleteMany({ relatedLeaveId: leave._id }); } catch { /* non-fatal */ }
        await notify(applicantId, 'Leave Held', `Your approved leave (${leave.from} to ${leave.to}) has been put on hold by ${actorName}${actionReason ? `. Reason: ${actionReason}` : ''}.`, 'leave', leave._id);
      }

      // Post-approval Reject by admin created attendance rows earlier — remove them.
      if (prevStatus === 'approved' && newStatus === 'rejected') {
        try { await Attendance.deleteMany({ relatedLeaveId: leave._id }); } catch { /* non-fatal */ }
      }

      // Attribute the action (powers "Approved/Rejected/Held by X" + history).
      recordAction(leave, action, user, actionReason, actedStep?.step ?? null, actedStepDef?.label || actedStep?.label || '');

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
        `${actorName} ${action} leave for ${applicantName} (${leave.days} days, ${leave.from} to ${leave.to})${actionReason ? ` — ${actionReason}` : ''}`,
        action === 'approved' ? 'medium' : 'low',
        req.headers.get('x-forwarded-for') || '',
        null,
        applicantId
      );

      // A leave approved after its payroll cycle was closed would otherwise be
      // locked out of the money. Reopen the affected cycle(s) to draft and
      // re-run them scoped to this employee so the leave is honoured instead
      // of turning into LOP.
      let reopenedPayrollMonths = [];
      if (newStatus === 'approved' && !applicantIsEmployer) {
        try {
          const ip = req.headers.get('x-forwarded-for') || '';
          reopenedPayrollMonths = await reopenPayrollForLeave(leave, user, ip);
          if (reopenedPayrollMonths.length) {
            const { runPayrollForMonth } = await import('@/lib/payroll-run-engine');
            for (const m of reopenedPayrollMonths) {
              // `force` is required: the cycle was finalized/approved until
              // reopenPayrollForLeave flipped it back to draft moments ago.
              await runPayrollForMonth({ month: m, userIds: [leave.userId], actor: user, ip, force: true });
            }
            await notify(
              applicantId,
              'Payroll Reopened',
              `Your ${leave.type} (${leave.from} to ${leave.to}) was approved after payroll closed. Payroll for ${reopenedPayrollMonths.join(', ')} has been recalculated.`,
              'payroll',
              null
            ).catch(() => {});
          }
        } catch (e) {
          // Never fail the approval because the recompute failed — the leave
          // is approved and the cycle stays a draft for a manual re-run.
          console.error('Payroll reopen/re-run failed:', e);
        }
      }

      return ok({ ...leave.toObject(), payableWarning, reopenedPayrollMonths });
    }

    // ── Fallback to legacy approval logic ──
    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const isTeamAdmin = user.role === 'team_admin';
    const isTeamLead = user.role === 'team_lead';

    const hasObjection = leave.teamAdminApproval === 'held' || leave.tlApproval === 'held' ||
                         leave.teamAdminApproval === 'rejected' || leave.tlApproval === 'rejected';

    if (leave.status === 'rejected') return fail('This leave has already been finalised', 400);
    // Post-approval Hold/Reject is admin-only; admin re-approve of an approved leave stays blocked.
    if (isAdmin && leave.status === 'approved' && !hasObjection && action === 'approved') return fail('This leave is already approved', 400);
    if (!isAdmin && leave.status === 'approved') return fail('This leave has already been decided', 400);

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
      recordAction(leave, action, user, actionReason, null, 'Admin');
      if (action === 'rejected') {
        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected by ${actorName}${actionReason ? `. Reason: ${actionReason}` : ''}.`, 'leave', leave._id);
      } else {
        await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved by ${actorName}.`, 'leave', leave._id);
      }
      await leave.save();
      if (action === 'approved') await materializeLeaveAttendance(leave);
      // Same payroll reopen/re-run as the dynamic-workflow path: a leave
      // approved after its cycle closed must recompute that cycle instead of
      // silently becoming LOP in an already-locked run.
      if (action === 'approved' && !applicantIsEmployer) {
        try {
          const ip = req.headers.get('x-forwarded-for') || '';
          const reopened = await reopenPayrollForLeave(leave, user, ip);
          if (reopened.length) {
            const { runPayrollForMonth } = await import('@/lib/payroll-run-engine');
            for (const m of reopened) {
              await runPayrollForMonth({ month: m, userIds: [leave.userId], actor: user, ip, force: true });
            }
          }
        } catch (e) {
          console.error('Payroll reopen/re-run failed (SME path):', e);
        }
      }
      await auditLog(`Leave ${action}`, 'Leave', user._id, `${actorName} ${action} SME leave for ${applicantName} (${leave.days} days, ${leave.from} to ${leave.to})${actionReason ? ` — ${actionReason}` : ''}`, action === 'approved' ? 'medium' : 'low', req.headers.get('x-forwarded-for') || '', null, applicantId);
      return ok(leave);
    }
    let legacyLabel = 'Admin';
    if (isAdmin) {
      // Admin post-approval hold/reject of an approved leave is allowed even
      // when adminApproval is already 'approved' (with no objection).
      const postApproval = prevStatus === 'approved' && (action === 'held' || action === 'rejected');
      if (leave.adminApproval !== 'pending' && !hasObjection && !postApproval) {
        return fail('You have already actioned this leave', 400);
      }
      leave.adminApproval = action;
      leave.adminApprovedBy = user._id;
      leave.adminApprovedAt = new Date();
      if (action === 'held' || action === 'rejected') leave.adminHoldReason = actionReason;

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
        await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected by ${actorName}${actionReason ? `. Reason: ${actionReason}` : ''}.`, 'leave', leave._id);
      }
      if (action === 'held') {
        await notify(applicantId, 'Leave Held', `Your leave request (${leave.from} to ${leave.to}) has been put on hold by ${actorName}${actionReason ? `. Reason: ${actionReason}` : ''}.`, 'leave', leave._id);
      }

    } else if (isTeamAdmin) {
      legacyLabel = 'Team Admin';
      if (!['super_admin', 'admin_full'].includes(user.role) && !await canViewUser(user, leave.userId)) return fail('Access denied', 403);
      if (leave.adminApproval !== 'approved') return fail('Waiting for Admin to approve first', 400);
      if (leave.teamAdminApproval && leave.teamAdminApproval !== 'pending') return fail('You have already actioned this leave', 400);
      leave.teamAdminApproval = action;
      leave.teamAdminApprovedBy = user._id;
      leave.teamAdminApprovedAt = new Date();
      if (action === 'held' || action === 'rejected') leave.teamAdminHoldReason = actionReason;

      if (action === 'held' || action === 'rejected') {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
        if (admins.length) {
          await notify(admins.map(a => a._id), `Leave ${action === 'held' ? 'Held' : 'Rejected'} by Team Admin`, `${actorName} (Team Admin) ${action === 'held' ? 'placed a hold on' : 'rejected'} ${applicantName}'s leave (${leave.from} to ${leave.to}). Reason: ${actionReason}`, 'leave', leave._id);
        }
        await notify(applicantId, `Your Leave has been ${action === 'held' ? 'Held' : 'Rejected'} by Team Admin`, `${actorName} (Team Admin) ${action === 'held' ? 'placed a hold on' : 'rejected'} your leave (${leave.from} to ${leave.to}). Reason: ${actionReason}`, 'leave', leave._id);
      }

    } else if (isTeamLead) {
      legacyLabel = 'Team Lead';
      if (!['super_admin', 'admin_full'].includes(user.role) && !await canViewUser(user, leave.userId)) return fail('Access denied', 403);
      if (leave.adminApproval !== 'approved') return fail('Waiting for Admin to approve first', 400);
      if (leave.tlApproval && leave.tlApproval !== 'pending') return fail('You have already actioned this leave', 400);
      leave.tlApproval = action;
      leave.tlApprovedBy = user._id;
      leave.tlApprovedAt = new Date();
      if (action === 'held' || action === 'rejected') leave.tlHoldReason = actionReason;

      if (action === 'held' || action === 'rejected') {
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
        if (admins.length) {
          await notify(admins.map(a => a._id), `Leave ${action === 'held' ? 'Held' : 'Rejected'} by Team Lead`, `${actorName} (Team Lead) ${action === 'held' ? 'placed a hold on' : 'rejected'} ${applicantName}'s leave (${leave.from} to ${leave.to}). Reason: ${actionReason}`, 'leave', leave._id);
        }
        await notify(applicantId, `Your Leave has been ${action === 'held' ? 'Held' : 'Rejected'} by Team Lead`, `${actorName} (Team Lead) ${action === 'held' ? 'placed a hold on' : 'rejected'} your leave (${leave.from} to ${leave.to}). Reason: ${actionReason}`, 'leave', leave._id);
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
              recordPeriodUsage(entry, typeConfig.usagePeriod, balance.cycleStart, new Date(leave.from), paidDays);
            }

            await saveBalanceOrConflict(balance);
          }
        }
      }
      leave.balanceApplied = true;
      await notify(applicantId, 'Leave Approved', `Your ${leave.type} from ${leave.from} to ${leave.to} (${leave.days} day(s)) has been approved by ${actorName}.`, 'leave', leave._id);
    }

    // Post-approval Hold by admin on the legacy path: approved(used) -> pending.
    if (prevStatus === 'approved' && newStatus === 'pending' && (action === 'held' || action === 'rejected')) {
      try {
        const now = new Date();
        const cycleStart = new Date(now.getFullYear(), 0, 1);
        const balance = await UserLeaveBalance.findOne({ userId: applicantId, cycleStart });
        if (balance) {
          const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
          if (entry) {
            const paidDays = leave.paidDays !== undefined ? leave.paidDays : leave.days;
            if (leave.balanceApplied && (paidDays || 0) > 0) {
              entry.used = Math.max(0, (entry.used || 0) - paidDays);
              entry.pending = (entry.pending || 0) + paidDays;
              const typeConfig = policy?.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
              await revertPeriodUsage(entry, typeConfig, balance.cycleStart, leave.from, paidDays);
              leave.balanceApplied = false;
              await saveBalanceOrConflict(balance);
            }
          }
        }
      } catch (e) { console.error('Post-approval hold balance reversal failed (legacy):', e?.message || e); }
      try { await Attendance.deleteMany({ relatedLeaveId: leave._id }); } catch { /* non-fatal */ }
    }
    if (prevStatus === 'approved' && newStatus === 'rejected') {
      try { await Attendance.deleteMany({ relatedLeaveId: leave._id }); } catch { /* non-fatal */ }
    }

    // Attribute the action (powers "Approved/Rejected/Held by X" + history).
    recordAction(leave, action, user, actionReason, null, legacyLabel);

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
      await notify(applicantId, 'Leave Rejected', `Your leave request (${leave.from} to ${leave.to}) has been rejected by ${actorName}${actionReason ? `. Reason: ${actionReason}` : ''}.`, 'leave', leave._id);
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

    // Legacy path never reopened/recomputed payroll (only the dynamic path
    // did), so a leave approved here after its cycle closed stayed invisible
    // to the money. Mirror the dynamic path: reopen + scoped force re-run.
    if (newStatus === 'approved' && !applicantIsEmployer) {
      try {
        const ip = req.headers.get('x-forwarded-for') || '';
        const reopened = await reopenPayrollForLeave(leave, user, ip);
        if (reopened.length) {
          const { runPayrollForMonth } = await import('@/lib/payroll-run-engine');
          for (const m of reopened) {
            await runPayrollForMonth({ month: m, userIds: [leave.userId], actor: user, ip, force: true });
          }
        }
      } catch (e) {
        // Never fail the approval because the recompute failed — the leave
        // is approved and the cycle stays a draft for a manual re-run.
        console.error('Payroll reopen/re-run failed (legacy path):', e);
      }
    }

    await auditLog(
      `Leave ${action}`,
      'Leave',
      user._id,
      `${actorName} ${action} leave for ${applicantName} (${leave.days} days, ${leave.from} to ${leave.to})${actionReason ? ` — ${actionReason}` : ''}`,
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
