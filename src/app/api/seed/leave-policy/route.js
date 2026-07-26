import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { LeavePolicy, UserLeaveBalance } from '@/lib/models';
import { ok, fail } from '@/lib/jwt';
import { requireAuth } from '@/lib/middleware';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Only super admin can seed', 403);

    await dbConnect();

    // Upsert the default leave policy
    const leavePolicy = await LeavePolicy.findOneAndUpdate(
      { name: 'Standard Leave Policy' },
      {
        name: 'Standard Leave Policy',
        description: 'Default leave policy for all employees. Quarterly accrual for Sick, Casual, and Earned leaves.',
        isDefault: true,
        status: 'active',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
        applicableRoles: [],
        applicableDepartments: [],
        applicableEmploymentTypes: [],
        requireProbationCompletion: false,
        genderRestriction: 'all',
        maxPendingApplications: 3,
        countWeekends: false,
        countHolidays: false,
        approvalWorkflow: [
          { step: 1, label: 'Admin', approverRoles: ['super_admin', 'admin_full'], actionType: 'approve', required: true, escalateAfterHours: 0 },
        ],
        leaveTypeConfigs: [
          {
            code: 'SL', name: 'Sick Leave', description: 'Leave for medical reasons and health issues.',
            color: '#ef4444', icon: 'bi-heart-pulse', sortOrder: 1, enabled: true,
            annualAllocation: 6, isPaid: true, maxConsecutiveDays: 0, minGapDays: 0,
            requiresDocuments: false, allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true,
            genderRestriction: 'all', carryForwardAllowed: false, carryForwardMaxDays: 0,
            carryForwardExpiryMonths: 0, encashmentAllowed: false, probationAllowed: true,
            accrualMode: 'monthly', prorateForNewJoiners: true, noticePeriodDays: 0,
            requireDocsIfConsecutiveDays: 0, eligibilityRules: [], useCustomWorkflow: false,
            approvalWorkflow: [], creditSchedule: 'quarterly', maxUsagePerPeriod: 1.5,
            usagePeriod: 'quarterly', unusedPeriodRollover: false,
          },
          {
            code: 'CL', name: 'Casual Leave', description: 'Leave for personal work and casual purposes.',
            color: '#3b82f6', icon: 'bi-calendar-check', sortOrder: 2, enabled: true,
            annualAllocation: 6, isPaid: true, maxConsecutiveDays: 0, minGapDays: 0,
            requiresDocuments: false, allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true,
            genderRestriction: 'all', carryForwardAllowed: false, carryForwardMaxDays: 0,
            carryForwardExpiryMonths: 0, encashmentAllowed: false, probationAllowed: true,
            accrualMode: 'monthly', prorateForNewJoiners: true, noticePeriodDays: 0,
            requireDocsIfConsecutiveDays: 0, eligibilityRules: [], useCustomWorkflow: false,
            approvalWorkflow: [], creditSchedule: 'quarterly', maxUsagePerPeriod: 1.5,
            usagePeriod: 'quarterly', unusedPeriodRollover: false,
          },
          {
            code: 'EL', name: 'Earned Leave', description: 'Earned leave that accumulates with service. Carry forward allowed.',
            color: '#8b5cf6', icon: 'bi-award', sortOrder: 3, enabled: true,
            annualAllocation: 12, isPaid: true, maxConsecutiveDays: 0, minGapDays: 0,
            requiresDocuments: false, allowHalfDay: false, allowFirstHalf: true, allowSecondHalf: true,
            genderRestriction: 'all', carryForwardAllowed: true, carryForwardMaxDays: 12,
            carryForwardExpiryMonths: 3, encashmentAllowed: false, probationAllowed: true,
            accrualMode: 'monthly', prorateForNewJoiners: true, noticePeriodDays: 0,
            requireDocsIfConsecutiveDays: 0, eligibilityRules: [], useCustomWorkflow: false,
            approvalWorkflow: [], creditSchedule: 'quarterly', maxUsagePerPeriod: 3,
            usagePeriod: 'quarterly', unusedPeriodRollover: false,
          },
        ],
      },
      { upsert: true, new: true }
    );

    // Create UserLeaveBalance for all active users who don't have one yet
    const users = await User.find({ status: 'active' }).select('_id');
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    const cycleEnd = new Date(now.getFullYear(), 11, 31);

    let balancesCreated = 0;
    for (const u of users) {
      const existing = await UserLeaveBalance.findOne({ userId: u._id, cycleStart });
      if (existing) continue;

      await UserLeaveBalance.create({
        userId: u._id,
        policyId: leavePolicy._id,
        cycleStart,
        cycleEnd,
        balances: [
          { typeCode: 'SL', allocated: 0, used: 0, pending: 0, carriedForward: 0, periodUsage: [] },
          { typeCode: 'CL', allocated: 0, used: 0, pending: 0, carriedForward: 0, periodUsage: [] },
          { typeCode: 'EL', allocated: 0, used: 0, pending: 0, carriedForward: 0, periodUsage: [] },
        ],
      });
      balancesCreated++;
    }

    return ok({
      message: 'Leave policy seeded successfully',
      policyId: leavePolicy._id,
      balancesCreated,
    }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
