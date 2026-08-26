import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { Holiday, Leave } from '@/lib/models/index';
import { resolvePolicyForUser, getOrCreateBalance } from '@/app/api/leave/balance/route';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { buildEmployeeContext, evaluateEligibility } from '@/lib/leave/eligibility';
import { calculatePeriodAllowance } from '@/lib/leave/accrual';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied: Admin rights required', 403);
    }

    const body = await req.json();
    const { targetUserId, typeCode = 'CL', from, to, halfDay = false, halfDayType, reason = 'Test simulation', documents = [] } = body;

    if (!from || !to) {
      return fail('From date and To date are required for simulation', 400);
    }

    await dbConnect();

    const testUser = targetUserId ? await User.findById(targetUserId) : user;
    if (!testUser) {
      return fail('Target employee user not found', 404);
    }

    const traceLogs = [];
    const addTrace = (step, status, message) => {
      traceLogs.push({
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        step,
        status, // 'PASS' | 'FAIL' | 'INFO' | 'WARN'
        message,
      });
    };

    addTrace('Initialization', 'PASS', `Started dry-run simulation for employee: ${testUser.name} (${testUser.role}, Dept: ${testUser.department || 'N/A'})`);

    // 1. Resolve Policy
    const policy = await resolvePolicyForUser(testUser);
    if (!policy) {
      addTrace('Policy Resolution', 'FAIL', 'No active leave policy found for user role/department.');
      return ok({
        isValid: false,
        rejectionReason: 'No active leave policy found for user role/department.',
        traceLogs,
      });
    }
    addTrace('Policy Resolution', 'PASS', `Resolved Active Policy: "${policy.name}" (Count Weekends: ${policy.countWeekends ? 'YES' : 'NO'}, Count Holidays: ${policy.countHolidays ? 'YES' : 'NO'})`);

    // 2. Find Type Config
    const typeConfig = policy.leaveTypeConfigs?.find(c => c.code === typeCode);
    if (!typeConfig || !typeConfig.enabled) {
      addTrace('Leave Type Config', 'FAIL', `Leave type "${typeCode}" is disabled or not found in policy "${policy.name}".`);
      return ok({
        isValid: false,
        rejectionReason: `Leave type "${typeCode}" is disabled or not available under current policy.`,
        traceLogs,
      });
    }
    addTrace('Leave Type Config', 'PASS', `Selected Leave Type: ${typeConfig.name} (${typeConfig.code}) — Annual Allocation: ${typeConfig.annualAllocation} days.`);

    // 3. Dynamic Eligibility Check
    const empContext = await buildEmployeeContext(testUser._id);
    const eligResult = evaluateEligibility(typeConfig.eligibilityRules, empContext);
    if (!eligResult.eligible) {
      addTrace('Eligibility Check', 'FAIL', `Eligibility rule failed: ${eligResult.failedRule}`);
      return ok({
        isValid: false,
        rejectionReason: `Eligibility check failed: ${eligResult.failedRule}`,
        traceLogs,
      });
    }
    addTrace('Eligibility Check', 'PASS', 'Passed all dynamic eligibility rules for this leave type.');

    // 4. Date Range & Weekend / Holiday Calculation
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (toDate < fromDate) {
      addTrace('Date Validation', 'FAIL', 'End date cannot be earlier than start date.');
      return ok({ isValid: false, rejectionReason: 'End date cannot be earlier than start date.', traceLogs });
    }

    const totalCalendarDays = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
    addTrace('Date Range', 'INFO', `Requested Range: ${from} to ${to} (${totalCalendarDays} calendar day(s)).`);

    // Holiday Check
    const holidayDocs = await Holiday.find({
      date: {
        $gte: fromDate.toISOString().split('T')[0],
        $lte: toDate.toISOString().split('T')[0],
      },
    });
    const holidayDates = new Set(holidayDocs.map(h => h.date));
    if (holidayDocs.length > 0) {
      addTrace('Holiday Check', 'INFO', `Found ${holidayDocs.length} holiday(s) in date range: ${holidayDocs.map(h => `${h.name} (${h.date})`).join(', ')}.`);
    }

    let calculatedDays = 0;
    let weekendCount = 0;
    let holidayCount = 0;

    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay(); // 0: Sun, 6: Sat
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
      if (isWeekend && !policy.countWeekends) {
        weekendCount++;
        continue;
      }

      if (holidayDates.has(dateStr) && !policy.countHolidays) {
        holidayCount++;
        continue;
      }

      calculatedDays += 1;
    }

    if (halfDay) {
      calculatedDays = 0.5;
      addTrace('Half-Day Duration', 'INFO', `Half-day leave applied (${halfDayType || 'First Half'}). Calculated duration set to 0.5 days.`);
    }

    if (calculatedDays <= 0) {
      addTrace('Working Days Calculation', 'FAIL', 'Requested leave dates consist only of non-working weekends/holidays.');
      return ok({
        isValid: false,
        rejectionReason: 'Requested leave dates consist only of holidays/weekends.',
        calculatedDays: 0,
        weekendCount,
        holidayCount,
        traceLogs,
      });
    }
    addTrace('Working Days Calculation', 'PASS', `Net Calculated Working Leave Days: ${calculatedDays} day(s) (Excluded ${weekendCount} weekend day(s), ${holidayCount} holiday(s)).`);

    // 5. Notice Period Check
    if (typeConfig.noticePeriodDays > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const applyFrom = new Date(from);
      applyFrom.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((applyFrom - today) / (1000 * 60 * 60 * 24));
      if (diffDays < typeConfig.noticePeriodDays) {
        addTrace('Notice Period Check', 'FAIL', `Requires ${typeConfig.noticePeriodDays} days advance notice. Applied with ${diffDays} day(s) notice.`);
        return ok({
          isValid: false,
          rejectionReason: `This leave type requires at least ${typeConfig.noticePeriodDays} days advance notice.`,
          traceLogs,
        });
      }
      addTrace('Notice Period Check', 'PASS', `Advance notice check passed (${diffDays} days notice >= ${typeConfig.noticePeriodDays} days required).`);
    }

    // 6. Max Consecutive Days Check
    if (typeConfig.maxConsecutiveDays > 0 && calculatedDays > typeConfig.maxConsecutiveDays) {
      addTrace('Max Consecutive Days', 'FAIL', `Calculated days (${calculatedDays}) exceeds max allowed limit (${typeConfig.maxConsecutiveDays} days).`);
      return ok({
        isValid: false,
        rejectionReason: `Maximum ${typeConfig.maxConsecutiveDays} consecutive days allowed for ${typeConfig.name}.`,
        traceLogs,
      });
    }

    // 7. Documents Requirement Check
    const needsDocs = typeConfig.requiresDocuments || (typeConfig.requireDocsIfConsecutiveDays > 0 && calculatedDays >= typeConfig.requireDocsIfConsecutiveDays);
    if (needsDocs && (!documents || documents.length === 0)) {
      addTrace('Document Requirement', 'WARN', `Supporting document is required for ${typeConfig.name}${typeConfig.requireDocsIfConsecutiveDays > 0 ? ` when >= ${typeConfig.requireDocsIfConsecutiveDays} days` : ''}.`);
    } else if (needsDocs) {
      addTrace('Document Requirement', 'PASS', 'Supporting document requirement satisfied.');
    }

    // 8. Balance & Paid vs LOP Split
    let paidDays = calculatedDays;
    let unpaidDays = 0;

    const balance = await getOrCreateBalance(testUser._id, policy);
    const balanceEntry = balance?.balances?.find(b => b.typeCode === typeCode);

    if (balanceEntry && typeConfig.isPaid) {
      const overallAvailable = Math.max(0, balanceEntry.allocated + balanceEntry.carriedForward - balanceEntry.used - balanceEntry.pending);
      const periodAllowed = Math.max(0, calculatePeriodAllowance(typeConfig, balanceEntry, balance.cycleStart, fromDate));
      const allowedPaidDays = Math.min(overallAvailable, periodAllowed);

      if (calculatedDays > allowedPaidDays) {
        paidDays = allowedPaidDays;
        unpaidDays = Number((calculatedDays - allowedPaidDays).toFixed(2));
        addTrace('Balance Allocation', 'WARN', `Insufficient paid balance (${overallAvailable} available). Split: ${paidDays} Paid Day(s), ${unpaidDays} Unpaid (LOP) Day(s).`);
      } else {
        addTrace('Balance Allocation', 'PASS', `Sufficient balance available (${overallAvailable} remaining). All ${calculatedDays} day(s) marked as Paid.`);
      }
    } else if (!typeConfig.isPaid) {
      paidDays = 0;
      unpaidDays = calculatedDays;
      addTrace('Balance Allocation', 'INFO', `Unpaid Leave Type (${typeConfig.name}). All ${calculatedDays} day(s) marked as Unpaid (LOP).`);
    }

    // 9. Approval Workflow Routing Preview
    const activeWorkflow = (typeConfig.useCustomWorkflow && typeConfig.approvalWorkflow?.length)
      ? typeConfig.approvalWorkflow
      : (policy.approvalWorkflow || []);

    const workflowPreview = activeWorkflow.length > 0
      ? activeWorkflow.map(s => ({ step: s.step, label: s.label, roles: s.approverRoles || ['admin_full'] }))
      : [
          { step: 1, label: 'Line Manager / Team Admin Approval', roles: ['team_admin', 'team_lead'] },
          { step: 2, label: 'Super Admin Final Approval', roles: ['super_admin', 'admin_full'] },
        ];

    addTrace('Workflow Generation', 'PASS', `Generated ${workflowPreview.length}-step approval workflow chain.`);
    addTrace('Simulation Complete', 'PASS', 'Dry-run simulation completed successfully without errors.');

    return ok({
      isValid: true,
      calculatedDays,
      totalCalendarDays,
      weekendCount,
      holidayCount,
      paidDays,
      unpaidDays,
      approvalWorkflow: workflowPreview,
      traceLogs,
    });
  } catch (e) {
    return fail('Simulation engine exception: ' + e.message, 500);
  }
}
