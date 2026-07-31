import dbConnect from '@/lib/db';
import { UserLeaveBalance, LeavePolicy } from '@/lib/models/index';
import User from '@/lib/models/User';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { EMPLOYER_ROLES, isEmployer } from '@/lib/permissions';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

/** Resolve the applicable policy for a user (role override → default) */
export async function resolvePolicyForUser(userDoc) {
  await dbConnect();
  const now = new Date();

  console.log('[LEAVE DEBUG] Resolving policy for user:', userDoc._id, 'role:', userDoc.role);

  // Look up employment type from profile
  let employmentType = '';
  if (userDoc.profileId) {
    const profile = await EmpProfile.findById(userDoc.profileId).select('employmentType');
    employmentType = profile?.employmentType || '';
  }

  const userDepartment = userDoc.department || '';
  console.log('[LEAVE DEBUG] User department:', JSON.stringify(userDepartment), '| employmentType:', JSON.stringify(employmentType));

  // Try role-specific policy first
  const rolePolicy = await LeavePolicy.findOne({
    $and: [
      { status: 'active' },
      { $or: [{ applicableRoles: { $size: 0 } }, { applicableRoles: userDoc.role }] },
      { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }] },
      { effectiveFrom: { $lte: now } },
      { $or: [{ applicableDepartments: { $size: 0 } }, { applicableDepartments: userDepartment }] },
      { $or: [{ applicableEmploymentTypes: { $size: 0 } }, { applicableEmploymentTypes: employmentType }] },
    ],
  }).sort({ createdAt: -1 });

  if (rolePolicy) {
    console.log('[LEAVE DEBUG] Found role-specific policy:', rolePolicy.name, '| isDefault:', rolePolicy.isDefault);
    return rolePolicy;
  }

  console.log('[LEAVE DEBUG] No role-specific policy found. Checking each condition individually...');

  // Debug: find ALL active policies and check each condition
  const allPolicies = await LeavePolicy.find({ status: 'active' }).sort({ createdAt: -1 });
  console.log('[LEAVE DEBUG] Total active policies:', allPolicies.length);

  for (const p of allPolicies) {
    console.log(`[LEAVE DEBUG] Checking policy: "${p.name}" (isDefault: ${p.isDefault})`);
    console.log(`  applicableRoles: ${JSON.stringify(p.applicableRoles)} — includes "${userDoc.role}"? ${p.applicableRoles.includes(userDoc.role)}`);
    console.log(`  effectiveFrom: ${p.effectiveFrom} — <= now (${now})? ${p.effectiveFrom <= now}`);
    console.log(`  effectiveTo: ${p.effectiveTo} — null or >= now? ${p.effectiveTo === null || p.effectiveTo >= now}`);
    console.log(`  applicableDepartments: ${JSON.stringify(p.applicableDepartments)} — empty? ${p.applicableDepartments.length === 0} — includes "${userDepartment}"? ${p.applicableDepartments.includes(userDepartment)}`);
    console.log(`  applicableEmploymentTypes: ${JSON.stringify(p.applicableEmploymentTypes)} — empty? ${p.applicableEmploymentTypes.length === 0} — includes "${employmentType}"? ${p.applicableEmploymentTypes.includes(employmentType)}`);
    console.log(`  isDefault: ${p.isDefault}`);
  }

  // Try default policy
  const defaultPolicy = await LeavePolicy.findOne({
    $and: [
      { status: 'active' },
      { isDefault: true },
      { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }] },
      { effectiveFrom: { $lte: now } },
      { $or: [{ applicableDepartments: { $size: 0 } }, { applicableDepartments: userDepartment }] },
      { $or: [{ applicableEmploymentTypes: { $size: 0 } }, { applicableEmploymentTypes: employmentType }] },
    ],
  }).sort({ createdAt: -1 });

  if (defaultPolicy) {
    console.log('[LEAVE DEBUG] Found default policy:', defaultPolicy.name);
    return defaultPolicy;
  }

  console.log('[LEAVE DEBUG] NO POLICY FOUND for this user');
  return null;
}

/** Check if a user is eligible for a given leave type config */
function isEligibleForType(config, employeeContext) {
  if (config.genderRestriction && config.genderRestriction !== 'all') {
    const userGender = (employeeContext.gender || '').toLowerCase();
    if (config.genderRestriction === 'male' || config.genderRestriction === 'paternity') {
      if (userGender !== 'male') return false;
    }
    if (config.genderRestriction === 'female' || config.genderRestriction === 'maternity') {
      if (userGender !== 'female') return false;
    }
  }
  const { evaluateEligibility } = require('@/lib/leave/eligibility');
  const elig = evaluateEligibility(config.eligibilityRules, employeeContext);
  return elig.eligible;
}

/** Get or create a user's balance for the current cycle */
export async function getOrCreateBalance(userId, policy) {
  await dbConnect();
  const user = await User.findById(userId).select('role');
  if (!user || isEmployer(user.role)) return null;

  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), 0, 1);
  const cycleEnd = new Date(now.getFullYear(), 11, 31);

  const { buildEmployeeContext } = require('@/lib/leave/eligibility');
  const employeeContext = await buildEmployeeContext(userId);

  let balance = await UserLeaveBalance.findOne({ userId, cycleStart });
  if (balance) {
    // Sanitize: remove stale entries that lack typeCode (from pre-merge records)
    const staleCount = balance.balances.filter(b => !b.typeCode).length;
    if (staleCount > 0) {
      balance.balances = balance.balances.filter(b => b.typeCode);
      await balance.save();
    }

    // Sync: add balance entries for any new leave types added to the policy
    const existingCodes = new Set(balance.balances.map(b => b.typeCode));
    let changed = false;
    for (const config of policy.leaveTypeConfigs || []) {
      if (!config.code || !config.enabled || existingCodes.has(config.code)) continue;
      if (!isEligibleForType(config, employeeContext)) continue;

      let allocated = 0;
      if (config.creditSchedule === 'upfront' || !config.creditSchedule) {
        allocated = config.annualAllocation || 0;
      }
      // For monthly/quarterly/half_yearly, start at 0 and let accrual handle it

      balance.balances.push({
        typeCode: config.code,
        allocated,
        used: 0,
        pending: 0,
        carriedForward: 0,
        expiryDate: config.carryForwardExpiryMonths
          ? new Date(cycleEnd.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000)
          : null,
        periodUsage: [],
      });
      changed = true;
    }
    if (changed) await balance.save();
    return balance;
  }

  // Create new balances from policy
  const balances = [];
  for (const config of policy.leaveTypeConfigs || []) {
    if (!config.code || !config.enabled) continue;
    if (!isEligibleForType(config, employeeContext)) continue;

    let allocated = config.annualAllocation || 0;
    
    // For periodic schedules, the initial allocation starts with the first installment
    if (config.creditSchedule && config.creditSchedule !== 'upfront') {
      const divisor = config.creditSchedule === 'monthly' ? 12 : config.creditSchedule === 'quarterly' ? 4 : 2;
      allocated = Number((config.annualAllocation / divisor).toFixed(2));
    }

    balances.push({
      typeCode: config.code,
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
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const userIdParam = new URL(req.url).searchParams.get('userId');
    const targetUserId = userIdParam && ADMIN_ROLES.includes(user.role) ? userIdParam : user._id;

    await dbConnect();
    const targetUser = await User.findById(targetUserId).select('-password');
    if (!targetUser) return fail('User not found', 404);

    if (isEmployer(targetUser.role)) {
      const now = new Date();
      return ok({
        policy: null,
        cycleStart: new Date(now.getFullYear(), 0, 1),
        cycleEnd: new Date(now.getFullYear(), 11, 31),
        balances: [],
      });
    }

    const policy = await resolvePolicyForUser(targetUser);
    if (!policy) {
      // Diagnostic: surface why no policy matched
      let employmentType = '';
      if (targetUser.profileId) {
        const profile = await EmpProfile.findById(targetUser.profileId).select('employmentType');
        employmentType = profile?.employmentType || '';
      }
      const userDepartment = targetUser.department || '';
      const now = new Date();
      const allPolicies = await LeavePolicy.find({ status: 'active' }).sort({ createdAt: -1 });
      const diagnostics = allPolicies.map(p => ({
        name: p.name,
        isDefault: p.isDefault,
        roleMatch: p.applicableRoles?.includes(targetUser.role) ?? false,
        deptMatch: !p.applicableDepartments?.length || p.applicableDepartments.includes(userDepartment),
        empTypeMatch: !p.applicableEmploymentTypes?.length || p.applicableEmploymentTypes.includes(employmentType),
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        effectiveFromOk: p.effectiveFrom <= now,
        effectiveToOk: !p.effectiveTo || p.effectiveTo >= now,
      }));
      console.error('[LEAVE DEBUG] No policy found. User:', { role: targetUser.role, department: userDepartment, employmentType, profileId: targetUser.profileId });
      console.error('[LEAVE DEBUG] Policy diagnostics:', JSON.stringify(diagnostics, null, 2));
      return fail(`No active leave policy found. User role=${targetUser.role}, dept="${userDepartment}", empType="${employmentType}", activePolicies=${allPolicies.length}. Check server logs for [LEAVE DEBUG] details.`, 400);
    }

    const balance = await getOrCreateBalance(targetUserId, policy);

    // Populate type details
    const populated = await UserLeaveBalance.findById(balance._id).lean();

    const { buildEmployeeContext } = require('@/lib/leave/eligibility');
    const employeeContext = await buildEmployeeContext(targetUserId);

    const eligibleBalances = [];
    for (const b of populated.balances || []) {
      const typeCodeStr = b.typeCode || '';
      if (!typeCodeStr) continue;

      const config = policy.leaveTypeConfigs?.find(c => c.code === typeCodeStr);
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
  } catch (e) {
    console.error('[LEAVE DEBUG] GET /api/leave/balance error:', e);
    return fail(e.message || 'Internal server error', 500);
  }
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

    if (isEmployer(targetUser.role)) {
      const now = new Date();
      const cycleStart = new Date(now.getFullYear(), 0, 1);
      await UserLeaveBalance.deleteOne({ userId, cycleStart });
      return ok({ message: 'Employer accounts do not track leave balances', balance: null });
    }

    const policy = await resolvePolicyForUser(targetUser);
    if (!policy) return fail('No active leave policy found', 400);

    // Delete existing balance for current cycle and recreate
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    await UserLeaveBalance.deleteOne({ userId, cycleStart });

    const balance = await getOrCreateBalance(userId, policy);
    const populated = await UserLeaveBalance.findById(balance._id).lean();

    await auditLog('Leave Balance Recalculated', 'Leave', user._id, `Recalculated leave balance for user ${userId}`, 'medium', req.headers.get('x-forwarded-for') || '', null, userId);
    return ok({ message: 'Balance recalculated', balance: populated });
  }

  if (action === 'monthly-accrual') {
    const now = new Date();
    const currentMonth = now.getMonth();
    const employers = await User.find({ role: { $in: EMPLOYER_ROLES } }).select('_id');
    const employerIds = employers.map(u => u._id.toString());
    const allBalances = await UserLeaveBalance.find();
    let processed = 0;

    for (const bal of allBalances) {
      if (employerIds.includes(bal.userId.toString())) continue;
      if (now < bal.cycleStart || now > bal.cycleEnd) continue;

      // Idempotency: skip if already accrued this month
      if (bal.lastAccrualMonth === currentMonth) continue;

      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      const cycleStart = new Date(bal.cycleStart);
      const monthsDiff = (now.getFullYear() - cycleStart.getFullYear()) * 12 + now.getMonth() - cycleStart.getMonth();

      if (monthsDiff <= 0) continue; // Skip first month (initialized on creation)

      let updated = false;
      for (const entry of bal.balances) {
        const config = policy.leaveTypeConfigs.find(c => c.code === entry.typeCode);
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
        bal.lastAccrualMonth = currentMonth;
        await bal.save();
        processed++;
      }
    }

    await auditLog('Monthly Accrual Processed', 'Leave', user._id, `Processed periodic accruals for ${processed} users`, 'high', req.headers.get('x-forwarded-for') || '');
    return ok({ message: `Periodic accruals processed for ${processed} users` });
  }

  if (action === 'adjust') {
    // Legacy adjust handler - but frontend now uses /api/leave/balance/adjust
    if (!userId || !adjustments?.typeCode || adjustments.used === undefined) {
      return fail('userId, typeCode, and used are required', 400);
    }
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    const balance = await UserLeaveBalance.findOne({ userId, cycleStart });
    if (!balance) return fail('No balance record found for this user', 404);

    const entry = balance.balances.find(b => b.typeCode === adjustments.typeCode);
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

    const allBalances = await UserLeaveBalance.find({ cycleStart: currentCycleStart });
    const employers = await User.find({ role: { $in: EMPLOYER_ROLES } }).select('_id');
    const employerIds = employers.map(u => u._id.toString());

    let processed = 0;
    for (const bal of allBalances) {
      if (employerIds.includes(bal.userId.toString())) continue;
      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      const nextBalances = [];
      for (const entry of bal.balances) {
        const config = policy.leaveTypeConfigs.find(
          c => c.code === entry.typeCode
        );
        if (!config || !config.enabled || !config.carryForwardAllowed) continue;

        const unused = Math.max(0, (entry.allocated + entry.carriedForward) - entry.used - entry.pending);
        const carryOver = Math.min(unused, config.carryForwardMaxDays || Infinity);

        let expiryDate = null;
        if (carryOver > 0 && config.carryForwardExpiryMonths > 0) {
          expiryDate = new Date(nextCycleStart.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000);
        }

        nextBalances.push({
          typeCode: entry.typeCode,
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
