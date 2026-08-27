import dbConnect from '@/lib/db';
import LeavePolicy from '@/lib/models/LeavePolicy';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export const ALL_MASTER_LEAVE_TYPES = [
  { code: 'SL', name: 'Sick Leave', description: 'Medical recovery & health leave', annualAllocation: 10, isPaid: true, allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true, maxConsecutiveDays: 5, minGapDays: 0, noticePeriodDays: 0, requiresDocuments: true, requireDocsIfConsecutiveDays: 2, genderRestriction: 'all', enabled: true, sortOrder: 1 },
  { code: 'CL', name: 'Casual Leave', description: 'Short notice leave for personal work', annualAllocation: 12, isPaid: true, allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true, maxConsecutiveDays: 3, minGapDays: 0, noticePeriodDays: 0, requiresDocuments: false, requireDocsIfConsecutiveDays: 0, genderRestriction: 'all', enabled: true, sortOrder: 2 },
  { code: 'PL', name: 'Privilege / Earned Leave', description: 'Planned annual vacation leave', annualAllocation: 15, isPaid: true, allowHalfDay: false, allowFirstHalf: false, allowSecondHalf: false, maxConsecutiveDays: 10, minGapDays: 7, noticePeriodDays: 7, requiresDocuments: false, requireDocsIfConsecutiveDays: 0, genderRestriction: 'all', enabled: true, sortOrder: 3 },
  { code: 'LOP', name: 'Loss of Pay', description: 'Unpaid absence beyond allocated quota', annualAllocation: 0, isPaid: false, allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true, maxConsecutiveDays: 30, minGapDays: 0, noticePeriodDays: 0, requiresDocuments: false, requireDocsIfConsecutiveDays: 0, genderRestriction: 'all', enabled: true, sortOrder: 4 },
  { code: 'ML', name: 'Maternity Leave', description: 'Statutory leave for female employees for childbirth & care', annualAllocation: 180, isPaid: true, allowHalfDay: false, allowFirstHalf: false, allowSecondHalf: false, maxConsecutiveDays: 180, minGapDays: 0, noticePeriodDays: 30, requiresDocuments: true, requireDocsIfConsecutiveDays: 1, genderRestriction: 'female', enabled: true, sortOrder: 5 },
  { code: 'PATL', name: 'Paternity Leave', description: 'Leave for male employees for child birth support', annualAllocation: 15, isPaid: true, allowHalfDay: false, allowFirstHalf: false, allowSecondHalf: false, maxConsecutiveDays: 15, minGapDays: 0, noticePeriodDays: 15, requiresDocuments: true, requireDocsIfConsecutiveDays: 1, genderRestriction: 'male', enabled: true, sortOrder: 6 },
  { code: 'CO', name: 'Compensatory Off', description: 'Credit for working on weekend or public holiday', annualAllocation: 0, isPaid: true, allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true, maxConsecutiveDays: 3, minGapDays: 0, noticePeriodDays: 1, requiresDocuments: false, requireDocsIfConsecutiveDays: 0, genderRestriction: 'all', enabled: true, sortOrder: 7 },
  { code: 'BL', name: 'Bereavement Leave', description: 'Leave for mourning immediate family member passing', annualAllocation: 5, isPaid: true, allowHalfDay: false, allowFirstHalf: false, allowSecondHalf: false, maxConsecutiveDays: 5, minGapDays: 0, noticePeriodDays: 0, requiresDocuments: false, requireDocsIfConsecutiveDays: 0, genderRestriction: 'all', enabled: true, sortOrder: 8 },
  { code: 'MARL', name: 'Marriage Leave', description: 'Special leave granted for employee marriage event', annualAllocation: 5, isPaid: true, allowHalfDay: false, allowFirstHalf: false, allowSecondHalf: false, maxConsecutiveDays: 5, minGapDays: 0, noticePeriodDays: 15, requiresDocuments: true, requireDocsIfConsecutiveDays: 1, genderRestriction: 'all', enabled: true, sortOrder: 9 },
];

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.email?.toLowerCase() !== 'kavin.dev01@gmail.com') {
      return fail('Access denied: Policy Control Portal is strictly restricted to designated Dev Admin', 403);
    }

    await dbConnect();

    // Fetch active policies
    let policyDocs = await LeavePolicy.find({ status: 'active' }).sort({ isDefault: -1, createdAt: -1 });
    if (!policyDocs || policyDocs.length === 0) {
      // Create default policy with all master leave types
      const defaultPolicy = await LeavePolicy.create({
        name: 'Corporate Default Leave Policy',
        description: 'Standard leave policy for company employees',
        isDefault: true,
        status: 'active',
        version: 1,
        publishedAt: new Date(),
        publishedBy: user._id,
        effectiveFrom: new Date(),
        maxPendingApplications: 2,
        countWeekends: false,
        countHolidays: false,
        sandwichRule: false,
        requireProbationCompletion: false,
        leaveTypeConfigs: ALL_MASTER_LEAVE_TYPES,
      });
      policyDocs = [defaultPolicy];
    } else {
      // Auto-sync missing master leave types into existing active policies
      for (const policyDoc of policyDocs) {
        const existingCodes = new Set((policyDoc.leaveTypeConfigs || []).map(c => c.code));
        let updated = false;
        for (const masterType of ALL_MASTER_LEAVE_TYPES) {
          if (!existingCodes.has(masterType.code)) {
            policyDoc.leaveTypeConfigs.push(masterType);
            updated = true;
          }
        }
        if (updated) {
          await policyDoc.save();
        }
      }
    }

    const policies = policyDocs.map(p => p.toObject());
    const employees = await User.find({ status: 'active' }).select('_id name email role department designation').sort({ name: 1 }).lean();

    return ok({
      policies,
      employees,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.email?.toLowerCase() !== 'kavin.dev01@gmail.com') {
      return fail('Access denied: Policy Control Portal is strictly restricted to designated Dev Admin', 403);
    }

    const body = await req.json();
    const { action = 'publish', policyId, name, description, countWeekends, countHolidays, sandwichRule, maxPendingApplications, requireProbationCompletion, leaveTypeConfigs } = body;

    if (!policyId) {
      return fail('Policy ID is required', 400);
    }

    await dbConnect();

    const policy = await LeavePolicy.findById(policyId);
    if (!policy) {
      return fail('Policy not found', 404);
    }

    const proposedConfig = {
      name: name !== undefined ? name : policy.name,
      description: description !== undefined ? description : policy.description,
      countWeekends: countWeekends !== undefined ? Boolean(countWeekends) : policy.countWeekends,
      countHolidays: countHolidays !== undefined ? Boolean(countHolidays) : policy.countHolidays,
      sandwichRule: sandwichRule !== undefined ? Boolean(sandwichRule) : (policy.sandwichRule || false),
      maxPendingApplications: maxPendingApplications !== undefined ? Number(maxPendingApplications) : policy.maxPendingApplications,
      requireProbationCompletion: requireProbationCompletion !== undefined ? Boolean(requireProbationCompletion) : policy.requireProbationCompletion,
      leaveTypeConfigs: Array.isArray(leaveTypeConfigs) ? leaveTypeConfigs : policy.leaveTypeConfigs,
    };

    if (action === 'save_draft') {
      policy.draftConfig = proposedConfig;
      await policy.save();
      return ok({ message: 'Policy configuration draft saved successfully. Changes are staged and NOT yet live.', policy, isDraft: true }, 200);
    }

    // Explicit Publish Action
    policy.name = proposedConfig.name;
    policy.description = proposedConfig.description;
    policy.countWeekends = proposedConfig.countWeekends;
    policy.countHolidays = proposedConfig.countHolidays;
    policy.sandwichRule = proposedConfig.sandwichRule;
    policy.maxPendingApplications = proposedConfig.maxPendingApplications;
    policy.requireProbationCompletion = proposedConfig.requireProbationCompletion;
    policy.leaveTypeConfigs = proposedConfig.leaveTypeConfigs;

    policy.status = 'active';
    policy.version = (policy.version || 1) + 1;
    policy.publishedAt = new Date();
    policy.publishedBy = user._id;
    policy.draftConfig = null;

    await policy.save();

    return ok({ message: `Leave policy v${policy.version} published successfully! Live structure has been updated.`, policy, isDraft: false }, 200);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.email?.toLowerCase() !== 'kavin.dev01@gmail.com') {
      return fail('Access denied: Policy Control Portal is strictly restricted to designated Dev Admin', 403);
    }

    const body = await req.json();
    const { name, description = '', isDefault = false, applicableRoles = [], applicableDepartments = [], leaveTypeConfigs = [] } = body;

    if (!name || !name.trim()) {
      return fail('Policy name is required', 400);
    }

    await dbConnect();

    const defaultConfigs = leaveTypeConfigs.length > 0 ? leaveTypeConfigs : [
      { code: 'CL', name: 'Casual Leave', annualAllocation: 12, isPaid: true, allowHalfDay: true, enabled: true },
      { code: 'SL', name: 'Sick Leave', annualAllocation: 10, isPaid: true, allowHalfDay: true, requiresDocuments: true, requireDocsIfConsecutiveDays: 2, enabled: true },
      { code: 'PL', name: 'Privilege Leave', annualAllocation: 15, isPaid: true, allowHalfDay: false, noticePeriodDays: 7, enabled: true },
      { code: 'LOP', name: 'Loss of Pay', annualAllocation: 0, isPaid: false, allowHalfDay: true, enabled: true },
    ];

    const newPolicy = await LeavePolicy.create({
      name: name.trim(),
      description: description.trim(),
      isDefault: Boolean(isDefault),
      status: 'active',
      version: 1,
      publishedAt: new Date(),
      publishedBy: user._id,
      effectiveFrom: new Date(),
      applicableRoles,
      applicableDepartments,
      maxPendingApplications: 2,
      countWeekends: false,
      countHolidays: false,
      sandwichRule: false,
      requireProbationCompletion: false,
      leaveTypeConfigs: defaultConfigs,
    });

    return ok({ message: `New Leave Policy "${newPolicy.name}" created successfully!`, policy: newPolicy }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
