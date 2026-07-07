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

  // Create new balances from policy
  const balances = await Promise.all(
    (policy.leaveTypeConfigs || [])
      .filter(c => c.enabled)
      .map(async (config) => {
        let allocated = config.annualAllocation || 0;
        if (config.accrualMode === 'monthly') {
          // Start with 0 if accrued monthly (or 1st month's worth if we run it on Jan 1st)
          // For now, let's start with 0 and let the monthly job add it
          allocated = 0;
        }
        
        // Proration logic for new joiners could go here if we fetch targetUser.joiningDate
        // if (config.prorateForNewJoiners && targetUser.joiningDate) { ... }

        return {
          typeId: config.typeId,
          allocated,
          used: 0,
          pending: 0,
          carriedForward: 0,
          expiryDate: config.carryForwardExpiryMonths
            ? new Date(cycleEnd.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000)
            : null,
        };
      })
  );

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

  return ok({
    policy: { _id: policy._id, name: policy.name },
    cycleStart: populated.cycleStart,
    cycleEnd: populated.cycleEnd,
    balances: populated.balances,
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
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    const allBalances = await UserLeaveBalance.find({ cycleStart });
    let processed = 0;

    for (const bal of allBalances) {
      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      let updated = false;
      for (const entry of bal.balances) {
        const config = policy.leaveTypeConfigs.find(c => c.typeId.toString() === entry.typeId.toString());
        if (config && config.enabled && config.accrualMode === 'monthly') {
          const monthlyAmount = Number((config.annualAllocation / 12).toFixed(2));
          entry.allocated = (entry.allocated || 0) + monthlyAmount;
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

    await auditLog('Monthly Accrual Processed', 'Leave', user._id, `Processed monthly accruals for ${processed} users`, 'high', req.headers.get('x-forwarded-for') || '');
    return ok({ message: `Monthly accrual processed for ${processed} users` });
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
