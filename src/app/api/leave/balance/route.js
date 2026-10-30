import { getGlobalConfig } from '@/lib/payroll-cycle';
import { payrollPeriod, payrollDay } from '@/lib/payroll-periods';
import { leaveBalanceDisplay } from '@/lib/leave/balance-display';
import { getTzDateStr } from '@/lib/timezone';
import { reconcileEntitlements, reconcileLeaveAndPayroll } from '@/lib/leave/reconcile-entitlements';
import dbConnect from '@/lib/db';
import { UserLeaveBalance, LeavePolicy } from '@/lib/models/index';
import User from '@/lib/models/User';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { EMPLOYER_ROLES, isEmployer } from '@/lib/permissions';
import { getDaysPerCredit } from '@/lib/leave/credit-schedule';

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

  // Try role-specific policy first (empty array/null/missing = all roles;
  // empty-string department/employmentType never matches a policy entry).
  const roleOr = [{ applicableRoles: { $size: 0 } }, { applicableRoles: userDoc.role }, { applicableRoles: { $exists: false } }, { applicableRoles: null }];
  const deptOr = userDepartment
    ? [{ applicableDepartments: { $size: 0 } }, { applicableDepartments: userDepartment }, { applicableDepartments: { $exists: false } }, { applicableDepartments: null }]
    : [{ applicableDepartments: { $size: 0 } }, { applicableDepartments: { $exists: false } }, { applicableDepartments: null }];
  const empOr = employmentType
    ? [{ applicableEmploymentTypes: { $size: 0 } }, { applicableEmploymentTypes: employmentType }, { applicableEmploymentTypes: { $exists: false } }, { applicableEmploymentTypes: null }]
    : [{ applicableEmploymentTypes: { $size: 0 } }, { applicableEmploymentTypes: { $exists: false } }, { applicableEmploymentTypes: null }];
  const toDateStr = (d) => {
    try {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    } catch { return ''; }
  };
  const todayStr = toDateStr(now);
  const candidates = await LeavePolicy.find({
    $and: [
      { status: 'active' },
      { $or: roleOr },
      { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }] },
      { $or: deptOr },
      { $or: empOr },
    ],
  }).sort({ createdAt: -1 }).lean();
  // Effective-from as YYYY-MM-DD string compare to avoid IST/UTC midnight drift
  const effective = candidates.filter(p => {
    if (!p.effectiveFrom) return false;
    return toDateStr(p.effectiveFrom) <= todayStr;
  });
  // Specificity score: role match + dept match + empType match, default is tie-breaker last
  const scored = effective.map(p => {
    let score = 0;
    if (Array.isArray(p.applicableRoles) && p.applicableRoles.includes(userDoc.role)) score += 3;
    if (userDepartment && Array.isArray(p.applicableDepartments) && p.applicableDepartments.includes(userDepartment)) score += 2;
    if (employmentType && Array.isArray(p.applicableEmploymentTypes) && p.applicableEmploymentTypes.includes(employmentType)) score += 1;
    if (p.isDefault) score -= 0.5;
    return { p, score };
  }).sort((a, b) => b.score - a.score || new Date(b.p.createdAt) - new Date(a.p.createdAt));
  const rolePolicy = scored.length ? await LeavePolicy.findById(scored[0].p._id) : null;

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
      { $or: deptOr },
      { $or: empOr },
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
  const result = await reconcileLeaveAndPayroll(userId, null, policy);
  if (result.skipped) return null;
  return UserLeaveBalance.findOne({ userId, cycleStart: new Date(result.cycleStart + 'T00:00:00Z') });
}

export async function getOrCreateBalanceForYear(userId, policy, year) {
  await dbConnect();
  const y = Number(year) || new Date().getFullYear();
  const globalConfig = await getGlobalConfig();
  const period = payrollPeriod(y + '-06-15', globalConfig);
  const cycleStart = new Date(period.yearStart + 'T00:00:00Z');
  const cycleEnd = new Date(period.yearEnd + 'T23:59:59.999Z');

  const now = new Date();
  if (y === payrollPeriod(await getTzDateStr(), globalConfig).year) {
    return getOrCreateBalance(userId, policy);
  }

  const user = await User.findById(userId).select('role');
  if (!user || isEmployer(user.role)) return null;

  const { buildEmployeeContext } = require('@/lib/leave/eligibility');
  const employeeContext = await buildEmployeeContext(userId);

  let balance = await UserLeaveBalance.findOne({ userId, cycleStart });
  if (!balance) {
    const balances = [];
    for (const config of policy.leaveTypeConfigs || []) {
      if (!config.code || !config.enabled || config.balanceMode === 'linked') continue;
      if (!isEligibleForType(config, employeeContext)) continue;
      balances.push({
        typeCode: config.code,
        allocated: config.isPaid === false ? 0 : config.annualAllocation || 0,
        used: 0,
        pending: 0,
        carriedForward: 0,
        expiryDate: null,
        periodUsage: [],
      });
    }
    balance = await UserLeaveBalance.create({ userId, policyId: policy._id, cycleStart, cycleEnd, balances });
    return balance;
  }

  const existingCodes = new Set(balance.balances.map(b => b.typeCode));
  let changed = false;
  for (const config of policy.leaveTypeConfigs || []) {
    if (!config.code || !config.enabled || config.balanceMode === 'linked') continue;
    if (!existingCodes.has(config.code)) {
      balance.balances.push({
        typeCode: config.code,
        allocated: config.isPaid === false ? 0 : config.annualAllocation || 0,
        used: 0, pending: 0, carriedForward: 0, expiryDate: null, periodUsage: [],
      });
      changed = true;
    } else if (config.isPaid === false) {
      const entry = balance.balances.find(b => b.typeCode === config.code);
      if (entry && Number(entry.allocated || 0) !== 0) {
        entry.allocated = 0;
        changed = true;
      }
    }
  }
  if (String(balance.policyId) !== String(policy._id)) {
    balance.policyId = policy._id;
    changed = true;
  }
  if (changed) await balance.save();
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
      const period = payrollPeriod(await getTzDateStr(), await getGlobalConfig());
      return ok({
        policy: null,
        cycleStart: new Date(period.yearStart + 'T00:00:00Z'),
        cycleEnd: new Date(period.yearEnd + 'T23:59:59.999Z'),
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

    // Page reads calculate a current view without locking the employee,
    // writing balances/audits, or rerunning payroll. Mutation paths reconcile.
    const { buildEmployeeContext } = require('@/lib/leave/eligibility');
    const [populated, employeeContext, payrollConfig, today] = await Promise.all([
      reconcileEntitlements(targetUserId, { preview: true, policy }),
      buildEmployeeContext(targetUserId), getGlobalConfig(), getTzDateStr(),
    ]);
    if (populated.skipped) return fail('No leave balance could be loaded for this employee.', 404);

    const eligibleBalances = [];
    const currentPeriod = payrollPeriod(today, payrollConfig);
    const activeLeaves = populated.leaveLedger;
    for (const b of populated.balances || []) {
      const typeCodeStr = b.typeCode || '';
      if (!typeCodeStr) continue;

      const config = policy.leaveTypeConfigs?.find(c => c.code === typeCodeStr);
      if (!config || !config.enabled || config.balanceMode === 'linked') continue;

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
      eligibleBalances.push({ ...b, ...leaveBalanceDisplay(b, config, activeLeaves, currentPeriod, {
        startDay: payrollDay(payrollConfig.payrollStartDay, 26), endDay: payrollDay(payrollConfig.payrollEndDay, 25),
      }) });
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

  if (['recalculate', 'monthly-accrual', 'carry-forward'].includes(action)) {
    if (action === 'recalculate' && !userId) return fail('userId is required', 400);
    const targets = await User.find(userId ? { _id: userId } : { status: 'active', role: { $nin: EMPLOYER_ROLES } }).select('_id');
    const results = [];
    for (const target of targets) results.push(await reconcileLeaveAndPayroll(target._id, user));
    return ok({ message: 'Payroll-period leave balances reconciled', processed: results.length, results });
  }

  if (action === 'adjust') return fail('Use the leave balance adjustment form so adjustments are recorded in the entitlement ledger.', 400);

  return fail('Invalid action', 400);
}
