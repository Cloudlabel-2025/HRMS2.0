import dbConnect from '@/lib/db';
import { UserLeaveBalance, LeavePolicy, LeaveType } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

/** Resolve the applicable policy for a user (role override → default) */
export async function resolvePolicyForUser(userDoc) {
  await dbConnect();
  const rolePolicy = await LeavePolicy.findOne({
    status: 'active',
    applicableRoles: userDoc.role,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
  }).sort({ createdAt: -1 });
  if (rolePolicy) return rolePolicy;

  const defaultPolicy = await LeavePolicy.findOne({
    status: 'active',
    isDefault: true,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
  }).sort({ createdAt: -1 });
  return defaultPolicy;
}

/** Get or create a user's balance for the current cycle */
export async function getOrCreateBalance(userId, policy) {
  await dbConnect();
  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), 0, 1);
  const cycleEnd = new Date(now.getFullYear(), 11, 31);

  let balance = await UserLeaveBalance.findOne({ userId, cycleStart });
  if (balance) return balance;

  const { buildEmployeeContext, evaluateEligibility } = require('@/lib/leave/eligibility');
  const employeeContext = await buildEmployeeContext(userId);

  // Create new balances from policy
  const balances = [];
  for (const config of policy.leaveTypeConfigs || []) {
    if (!config.enabled) continue;

    // Evaluate gender restrictions
    if (config.genderRestriction && config.genderRestriction !== 'all') {
      const userGender = (employeeContext.gender || '').toLowerCase();
      if (config.genderRestriction === 'male' || config.genderRestriction === 'paternity') {
        if (userGender !== 'male') continue;
      }
      if (config.genderRestriction === 'female' || config.genderRestriction === 'maternity') {
        if (userGender !== 'female') continue;
      }
    }

    // Evaluate eligibility rules
    const elig = evaluateEligibility(config.eligibilityRules, employeeContext);
    if (!elig.eligible) continue;

    let allocated = config.annualAllocation || 0;
    
    // For periodic schedules, the initial allocation starts with the first installment
    if (config.creditSchedule && config.creditSchedule !== 'upfront') {
      const divisor = config.creditSchedule === 'monthly' ? 12 : config.creditSchedule === 'quarterly' ? 4 : 2;
      allocated = Number((config.annualAllocation / divisor).toFixed(2));
    }

    balances.push({
      typeId: config.typeId,
      allocated,
      used: 0,
      pending: 0,
      carriedForward: 0,
      expiryDate: config.carryForwardExpiryMonths
        ? new Date(cycleEnd.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000)
        : null,
      periodUsage: [],
    });
  }

  balance = await UserLeaveBalance.create({ userId, policyId: policy._id, cycleStart, cycleEnd, balances });
  return balance;
}

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const userIdParam = new URL(req.url).searchParams.get('userId');
  const targetUserId = userIdParam && ADMIN_ROLES.includes(user.role) ? userIdParam : user._id;

  await dbConnect();
  const targetUser = await User.findById(targetUserId).select('-password');
  if (!targetUser) return fail('User not found', 404);

  const policy = await resolvePolicyForUser(targetUser);
  if (!policy) return fail('No active leave policy found for this user', 400);

  const balance = await getOrCreateBalance(targetUserId, policy);

  // Populate type details
  const populated = await UserLeaveBalance.findById(balance._id)
    .populate('balances.typeId', 'name code color icon')
    .lean();

  const { buildEmployeeContext } = require('@/lib/leave/eligibility');
  const employeeContext = await buildEmployeeContext(targetUserId);

  const eligibleBalances = [];
  for (const b of populated.balances || []) {
    const typeIdStr = (b.typeId?._id || b.typeId || '').toString();
    if (!typeIdStr) continue;

    const config = policy.leaveTypeConfigs?.find(c => c.typeId.toString() === typeIdStr);
    if (!config || !config.enabled) continue;

    // Evaluate gender restrictions
    if (config.genderRestriction && config.genderRestriction !== 'all') {
      const userGender = (employeeContext.gender || '').toLowerCase();
      if (config.genderRestriction === 'male' || config.genderRestriction === 'paternity') {
        if (userGender !== 'male') continue;
      }
      if (config.genderRestriction === 'female' || config.genderRestriction === 'maternity') {
        if (userGender !== 'female') continue;
      }
    }
    eligibleBalances.push(b);
  }

  return ok({
    policy: { _id: policy._id, name: policy.name, leaveTypeConfigs: policy.leaveTypeConfigs },
    cycleStart: populated.cycleStart,
    cycleEnd: populated.cycleEnd,
    balances: eligibleBalances,
  });
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const body = await req.json();
  const { action, userId, adjustments } = body;

  if (action === 'recalculate') {
    // Admin manually recalculates balance for a user
    if (!userId) return fail('userId is required', 400);
    const targetUser = await User.findById(userId).select('-password');
    if (!targetUser) return fail('User not found', 404);

    const policy = await resolvePolicyForUser(targetUser);
    if (!policy) return fail('No active leave policy found', 400);

    // Delete existing balance for current cycle and recreate
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    await UserLeaveBalance.deleteOne({ userId, cycleStart });

    const balance = await getOrCreateBalance(userId, policy);
    const populated = await UserLeaveBalance.findById(balance._id)
      .populate('balances.typeId', 'name code color icon').lean();

    await auditLog('Leave Balance Recalculated', 'Leave', user._id, `Recalculated leave balance for user ${userId}`, 'medium', req.headers.get('x-forwarded-for') || '', null, userId);
    return ok({ message: 'Balance recalculated', balance: populated });
  }

  if (action === 'monthly-accrual') {
    const now = new Date();
    const allBalances = await UserLeaveBalance.find();
    let processed = 0;

    for (const bal of allBalances) {
      if (now < bal.cycleStart || now > bal.cycleEnd) continue;

      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      const cycleStart = new Date(bal.cycleStart);
      const monthsDiff = (now.getFullYear() - cycleStart.getFullYear()) * 12 + now.getMonth() - cycleStart.getMonth();

      if (monthsDiff <= 0) continue; // Skip first month (initialized on creation)

      let updated = false;
      for (const entry of bal.balances) {
        const config = policy.leaveTypeConfigs.find(c => c.typeId.toString() === entry.typeId.toString());
        if (!config || !config.enabled) continue;

        let creditAmount = 0;
        if (config.creditSchedule === 'monthly') {
          creditAmount = Number((config.annualAllocation / 12).toFixed(2));
        } else if (config.creditSchedule === 'quarterly' && monthsDiff % 3 === 0) {
          creditAmount = Number((config.annualAllocation / 4).toFixed(2));
        } else if (config.creditSchedule === 'half_yearly' && monthsDiff % 6 === 0) {
          creditAmount = Number((config.annualAllocation / 2).toFixed(2));
        }

        if (creditAmount > 0) {
          entry.allocated = (entry.allocated || 0) + creditAmount;
          // Cap it at annual allocation
          if (entry.allocated > config.annualAllocation) {
            entry.allocated = config.annualAllocation;
          }
          updated = true;
        }
      }
      if (updated) {
        await bal.save();
        processed++;
      }
    }

    await auditLog('Monthly Accrual Processed', 'Leave', user._id, `Processed periodic accruals for ${processed} users`, 'high', req.headers.get('x-forwarded-for') || '');
    return ok({ message: `Periodic accruals processed for ${processed} users` });
  }

  if (action === 'adjust') {
    // Legacy adjust handler - but frontend now uses /api/leave/balance/adjust
    if (!userId || !adjustments?.typeId || adjustments.used === undefined) {
      return fail('userId, typeId, and used are required', 400);
    }
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    const balance = await UserLeaveBalance.findOne({ userId, cycleStart });
    if (!balance) return fail('No balance record found for this user', 404);

    const entry = balance.balances.find(b => b.typeId.toString() === adjustments.typeId);
    if (!entry) return fail('Leave type not found in balance', 400);

    if (adjustments.used !== undefined) entry.used = adjustments.used;
    if (adjustments.allocated !== undefined) entry.allocated = adjustments.allocated;
    if (adjustments.carriedForward !== undefined) entry.carriedForward = adjustments.carriedForward;
    if (adjustments.pending !== undefined) entry.pending = adjustments.pending;

    await balance.save();
    await auditLog('Leave Balance Adjusted', 'Leave', user._id, `Adjusted balance for user ${userId}`, 'medium', req.headers.get('x-forwarded-for') || '', null, userId);
    return ok({ message: 'Balance adjusted' });
  }

  if (action === 'carry-forward') {
    // Process carry forward for all users (annual)
    const now = new Date();
    const currentCycleStart = new Date(now.getFullYear(), 0, 1);
    const nextCycleStart = new Date(now.getFullYear() + 1, 0, 1);
    const nextCycleEnd = new Date(now.getFullYear() + 1, 11, 31);

    const allBalances = await UserLeaveBalance.find({ cycleStart: currentCycleStart })
      .populate('balances.typeId', 'name code');

    let processed = 0;
    for (const bal of allBalances) {
      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      const nextBalances = [];
      for (const entry of bal.balances) {
        const config = policy.leaveTypeConfigs.find(
          c => c.typeId.toString() === entry.typeId.toString()
        );
        if (!config || !config.enabled || !config.carryForwardAllowed) continue;

        const unused = Math.max(0, (entry.allocated + entry.carriedForward) - entry.used - entry.pending);
        const carryOver = Math.min(unused, config.carryForwardMaxDays || Infinity);

        let expiryDate = null;
        if (carryOver > 0 && config.carryForwardExpiryMonths > 0) {
          expiryDate = new Date(nextCycleStart.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000);
        }

        nextBalances.push({
          typeId: entry.typeId,
          allocated: config.annualAllocation || 0,
          used: 0,
          pending: 0,
          carriedForward: carryOver,
          expiryDate,
        });
      }

      if (nextBalances.length > 0) {
        await UserLeaveBalance.create({
          userId: bal.userId,
          policyId: bal.policyId,
          cycleStart: nextCycleStart,
          cycleEnd: nextCycleEnd,
          balances: nextBalances,
        });
        processed++;
      }
    }

    await auditLog('Carry Forward Processed', 'Leave', user._id, `Processed carry forward for ${processed} users`, 'high', req.headers.get('x-forwarded-for') || '');
    return ok({ message: `Carry forward processed for ${processed} users` });
  }

  return fail('Unknown action', 400);
}
