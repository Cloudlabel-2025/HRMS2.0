import dbConnect from '@/lib/db';
import LeavePolicy from '@/lib/models/LeavePolicy';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied: Admin rights required', 403);
    }

    await dbConnect();

    // Fetch active policies
    let policies = await LeavePolicy.find({ status: 'active' }).sort({ isDefault: -1, createdAt: -1 }).lean();
    if (!policies || policies.length === 0) {
      // Create a default policy if none exists
      const defaultPolicy = await LeavePolicy.create({
        name: 'Corporate Default Leave Policy',
        description: 'Standard leave policy for company employees',
        isDefault: true,
        status: 'active',
        effectiveFrom: new Date(),
        maxPendingApplications: 2,
        countWeekends: false,
        countHolidays: false,
        requireProbationCompletion: false,
        leaveTypeConfigs: [
          {
            code: 'CL',
            name: 'Casual Leave',
            description: 'Short notice leave for unexpected personal work',
            annualAllocation: 12,
            isPaid: true,
            allowHalfDay: true,
            allowFirstHalf: true,
            allowSecondHalf: true,
            maxConsecutiveDays: 3,
            minGapDays: 0,
            noticePeriodDays: 0,
            requiresDocuments: false,
            enabled: true,
          },
          {
            code: 'SL',
            name: 'Sick Leave',
            description: 'Leave for medical recovery and health reasons',
            annualAllocation: 10,
            isPaid: true,
            allowHalfDay: true,
            allowFirstHalf: true,
            allowSecondHalf: true,
            maxConsecutiveDays: 5,
            minGapDays: 0,
            noticePeriodDays: 0,
            requiresDocuments: true,
            requireDocsIfConsecutiveDays: 2,
            enabled: true,
          },
          {
            code: 'PL',
            name: 'Privilege Leave',
            description: 'Planned annual vacation leave',
            annualAllocation: 15,
            isPaid: true,
            allowHalfDay: false,
            maxConsecutiveDays: 10,
            minGapDays: 7,
            noticePeriodDays: 7,
            requiresDocuments: false,
            enabled: true,
          },
          {
            code: 'LOP',
            name: 'Loss of Pay',
            description: 'Unpaid absence',
            annualAllocation: 0,
            isPaid: false,
            allowHalfDay: true,
            allowFirstHalf: true,
            allowSecondHalf: true,
            maxConsecutiveDays: 30,
            enabled: true,
          },
        ],
      });
      policies = [defaultPolicy.toObject()];
    }

    // Fetch user list for simulator dropdown
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
    if (!['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied: Admin rights required', 403);
    }

    const body = await req.json();
    const { policyId, name, description, countWeekends, countHolidays, maxPendingApplications, requireProbationCompletion, leaveTypeConfigs } = body;

    if (!policyId) {
      return fail('Policy ID is required', 400);
    }

    await dbConnect();

    const policy = await LeavePolicy.findById(policyId);
    if (!policy) {
      return fail('Policy not found', 404);
    }

    if (name !== undefined) policy.name = name;
    if (description !== undefined) policy.description = description;
    if (countWeekends !== undefined) policy.countWeekends = Boolean(countWeekends);
    if (countHolidays !== undefined) policy.countHolidays = Boolean(countHolidays);
    if (maxPendingApplications !== undefined) policy.maxPendingApplications = Number(maxPendingApplications);
    if (requireProbationCompletion !== undefined) policy.requireProbationCompletion = Boolean(requireProbationCompletion);

    if (leaveTypeConfigs && Array.isArray(leaveTypeConfigs)) {
      policy.leaveTypeConfigs = leaveTypeConfigs;
    }

    await policy.save();

    return ok({ message: 'Leave policy updated successfully', policy }, 200);
  } catch (e) {
    return fail(e.message, 500);
  }
}
