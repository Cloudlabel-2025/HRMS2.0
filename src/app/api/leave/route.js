import { connectDB } from '@/lib/db';
import { Leave, Holiday, LeaveType, LeavePolicy, UserLeaveBalance, EmpProfile } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CreateLeaveSchema, validateRequest } from '@/lib/validation';
import { notify } from '@/lib/notify';
import { resolvePolicyForUser, getOrCreateBalance } from '@/app/api/leave/balance/route';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope    = searchParams.get('scope');
    const status   = searchParams.get('status');
    const userIdParam = searchParams.get('userId');
    const smeOnly  = searchParams.get('smeOnly');
    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);

    let query = {};

    if (smeOnly === 'true') {
      if (!isAdmin) return fail('Access denied', 403);
      query.smeId = { $ne: null };
    }

    if (scope === 'all') {
      if (!isAdmin) return fail('Access denied', 403);
    } else if (scope === 'approvals') {
      if (isAdmin) {
        query = { $or: [
          { 'workflowApprovals.action': { $in: ['pending', null] } },
          { status: 'pending' },
        ]};
      } else {
        // Find leaves where any workflow step matches this user's role
        query = {
          $or: [
            { 'workflowApprovals.action': { $in: ['pending', null] } },
          ],
        };
      }
    } else if (scope === 'my' && userIdParam && isAdmin) {
      query.userId = userIdParam;
    } else {
      query.userId = user._id;
    }

    if (status) query.status = status;

    const leaves = await Leave.find(query)
      .populate('userId', 'name avatar department')
      .populate('typeId', 'name code color')
      .populate({ path: 'workflowApprovals.approvedBy', select: 'name', strictPopulate: false })
      .sort({ createdAt: -1 });

    return ok(leaves);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const ip = req.headers.get('x-forwarded-for') || '';
    const validation = validateRequest(CreateLeaveSchema, body);
    if (!validation.valid) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { typeId, from, to, halfDay, reason, documents } = validation.data;

    // Look up leave type
    const leaveType = await LeaveType.findById(typeId);
    if (!leaveType || !leaveType.isActive) {
      return fail('Invalid or deactivated leave type', 400);
    }

    // Calculate days
    const fromDate = new Date(from);
    const toDate = new Date(to);
    let days = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;

    // Check date overlap
    const overlap = await Leave.findOne({
      userId: user._id,
      status: { $in: ['pending', 'approved'] },
      from: { $lte: to },
      to:   { $gte: from },
    });
    if (overlap) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Date overlap with existing ${overlap.status} leave (${overlap.from} to ${overlap.to})`, 'low', ip, null, user._id);
      return fail(`You already have a ${overlap.status} leave from ${overlap.from} to ${overlap.to} that overlaps with the requested dates.`, 400);
    }

    // Check holiday overlap
    const holidayOverlap = await Holiday.findOne({
      date: { $gte: from, $lte: to },
    });
    if (holidayOverlap) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Date overlaps with holiday "${holidayOverlap.name}" on ${holidayOverlap.date}`, 'low', ip, null, user._id);
      return fail(`Cannot apply leave from ${from} to ${to} — "${holidayOverlap.name}" (${holidayOverlap.type}) falls on ${holidayOverlap.date}.`, 400);
    }

    // ── SME Flow ──
    if (user.role === 'sme') {
      const { SME } = await import('@/lib/models/index');
      const sme = await SME.findOne({ userId: user._id });
      if (!sme) return fail('SME profile not found', 404);
      if (sme.status !== 'active') return fail('Your account is inactive. Contact admin.', 400);
      if (sme.contractEnd && new Date(to) > new Date(sme.contractEnd)) {
        return fail(`Cannot apply leave beyond contract end date (${new Date(sme.contractEnd).toLocaleDateString()})`, 400);
      }

      const existing = await Leave.findOne({ userId: user._id, status: 'pending' });
      if (existing) {
        auditLog('Leave Apply Failed', 'Leave', user._id, 'Already has a pending leave application', 'low', ip, null, user._id);
        return fail('You already have a pending leave application. Wait for it to be resolved before applying again.', 400);
      }

      const leave = await Leave.create({
        userId: user._id,
        type: leaveType.name,
        typeId,
        from,
        to,
        days,
        halfDay,
        reason,
        documents,
        status: 'pending',
        smeId: sme._id,
        adminApproval: 'pending',
        teamAdminApproval: 'pending',
        tlApproval: 'pending',
      });

      const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] } }).select('_id');
      if (admins.length) {
        await notify(
          admins.map(a => a._id),
          'New Leave Request',
          `${user.name} applied for ${days} day(s) of ${leaveType.name} (${from} to ${to})`,
          'leave',
          leave._id
        );
      }

      await auditLog('Leave Applied', 'Leave', user._id, `Applied for ${days} days of ${leaveType.name} (${from} to ${to})`, 'low', ip, null, user._id);
      return ok(leave, 201);
    }

    // ── Regular Policy Flow ──
    // Resolve policy for this user
    const policy = await resolvePolicyForUser(user);
    if (!policy) {
      return fail('No active leave policy found for your role. Contact admin.', 400);
    }

    // Find the type config in policy
    const typeConfig = policy.leaveTypeConfigs.find(
      c => c.typeId.toString() === typeId
    );
    if (!typeConfig || !typeConfig.enabled) {
      return fail(`${leaveType.name} is not available under your current leave policy`, 400);
    }

    // Check gender restriction
    if (typeConfig.genderRestriction !== 'all') {
      const userDoc = await User.findById(user._id).select('-password');
      if (typeConfig.genderRestriction === 'maternity' && userDoc.role !== 'employee') {
        // simplified check; real gender comes from identity module
      }
    }

    // Check probation completion if policy requires it
    if (policy.requireProbationCompletion && user.profileId) {
      const profile = await EmpProfile.findById(user.profileId).select('employmentStatus');
      if (profile && ['onboarding', 'probation'].includes(profile.employmentStatus)) {
        return fail('You must complete your probation before applying for leave under this policy', 400);
      }
    }

    // Check max consecutive days
    if (typeConfig.maxConsecutiveDays > 0 && days > typeConfig.maxConsecutiveDays) {
      return fail(`Maximum ${typeConfig.maxConsecutiveDays} consecutive days allowed for ${leaveType.name}`, 400);
    }

    // Check max pending applications
    if (policy.maxPendingApplications > 0) {
      const pendingCount = await Leave.countDocuments({ userId: user._id, status: 'pending' });
      if (pendingCount >= policy.maxPendingApplications) {
        return fail(`You already have ${pendingCount} pending application(s). Max ${policy.maxPendingApplications} allowed.`, 400);
      }
    }

    // Check min gap between leaves
    if (typeConfig.minGapDays > 0) {
      const recentLeave = await Leave.findOne({
        userId: user._id,
        status: 'approved',
        to: { $gte: from },
      }).sort({ to: -1 });
      if (recentLeave) {
        const gap = Math.ceil((new Date(from) - new Date(recentLeave.to)) / (1000 * 60 * 60 * 24)) - 1;
        if (gap < typeConfig.minGapDays) {
          return fail(`Minimum ${typeConfig.minGapDays} day(s) gap required between ${leaveType.name} applications`, 400);
        }
      }
    }

    // Get / create balance and check availability
    const balance = await getOrCreateBalance(user._id, policy);
    const balanceEntry = balance.balances.find(b => b.typeId.toString() === typeId);
    if (!balanceEntry) {
      return fail(`No balance record found for ${leaveType.name}`, 400);
    }

    const available = balanceEntry.allocated + balanceEntry.carriedForward - balanceEntry.used - balanceEntry.pending;
    if (days > available && typeConfig.isPaid) {
      return fail(`Insufficient ${leaveType.name} balance. Available: ${available} day(s), Requested: ${days} day(s)`, 400);
    }

    // Build workflow approvals from policy
    const workflowApprovals = (policy.approvalWorkflow || []).map(step => ({
      step: step.step,
      label: step.label,
      action: 'pending',
      approvedBy: null,
      approvedAt: null,
      holdReason: '',
      actionType: step.actionType,
    }));

    // Create leave record
    const leave = await Leave.create({
      userId: user._id,
      typeId,
      type: leaveType.name,
      from,
      to,
      days,
      halfDay,
      reason,
      documents,
      policyId: policy._id,
      workflowApprovals,
      status: 'pending',

      // Also set legacy fields for backward compat
      adminApproval: 'pending',
      teamAdminApproval: 'pending',
      tlApproval: 'pending',
    });

    // Update pending balance
    balanceEntry.pending += days;
    await balance.save();

    // Notify the first step approvers
    const firstStep = policy.approvalWorkflow?.[0];
    if (firstStep) {
      const approvers = await User.find({ role: { $in: firstStep.approverRoles }, status: 'active' }).select('_id');
      if (approvers.length) {
        await notify(
          approvers.map(a => a._id),
          'New Leave Request',
          `${user.name} applied for ${days} day(s) of ${leaveType.name} (${from} to ${to})`,
          'leave',
          leave._id
        );
      }
    }

    await auditLog('Leave Applied', 'Leave', user._id, `Applied for ${days} days of ${leaveType.name} (${from} to ${to})`, 'low', ip, null, user._id);
    return ok(leave, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
