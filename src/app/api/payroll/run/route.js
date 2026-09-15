import { connectDB } from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import PayrollRule from '@/lib/models/PayrollRule';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { getGlobalConfig, getPayrollDay, getCycleRange, getWorkingDayCalendar, getCycleLabel, getCycleCalendarStats, isWorkingDay } from '@/lib/payroll-cycle';
import { calculatePayroll } from '@/lib/payroll-calculator';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { isEmployer } from '@/lib/permissions';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { month } = await req.json();
    if (!month) return fail('Month is required (YYYY-MM)');

    const [y, m] = month.split('-').map(Number);
    const year = y;
    const monthIndex = m - 1;

    const config = await getGlobalConfig();
    const startDay = getPayrollDay(config.payrollStartDay, 26);
    const endDay = getPayrollDay(config.payrollEndDay, 25);
    const { fromDate, toDate } = getCycleRange(startDay, endDay, year, monthIndex);

    const todayStr = new Date().toISOString().slice(0, 10);
    const isMidCycle = todayStr <= toDate;

    const workingCalendar = await getWorkingDayCalendar(fromDate, toDate, config);
    const workingDays = workingCalendar.workingDays;
    const holidayDocs = workingCalendar.holidays.map(date => ({ date }));
    // Single source for working dates: local-midnight iteration (same as
    // getWorkingDayCalendar) to avoid UTC DST day-slip.
    const workingDateSet = new Set();
    for (let cursor = new Date(`${fromDate}T00:00:00`), end = new Date(`${toDate}T00:00:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const date = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
      if (isWorkingDay(date, config, holidayDocs)) workingDateSet.add(date);
    }
    const cycleLabel = getCycleLabel(year, monthIndex, startDay, endDay);

    const calendarStats = getCycleCalendarStats(fromDate, toDate);

    // Load default payroll rule
    const defaultRule = await PayrollRule.findOne({ isDefault: true }).lean();

    const employees = await User.find({ status: 'active' });
    const results = [];

    for (const emp of employees) {
      const existing = await Payroll.findOne({ userId: emp._id, month });
      if (existing?.status === 'finalized') continue;
      // Never demote an approved payroll back to draft without reopen.
      if (existing?.status === 'approved') continue;

      const structure = await SalaryStructure.findOne({ userId: emp._id });
      if (!structure) continue;

      // Resolve the payroll rule for this employee
      const rule = structure.ruleId
        ? (await PayrollRule.findById(structure.ruleId).lean()) || defaultRule
        : defaultRule;
      const lopConfig = rule?.lopConfig || { basis: 'working_days', deductFrom: 'gross', countHalfDay: true };

      let presentDays;
      let lopDays;
      let retroLopDaysVal = 0;
      let retroLeaveIdsVal = [];

      if (isEmployer(emp.role)) {
        presentDays = workingDays;
        lopDays = 0;
      } else {
        const records = await Attendance.find({
          userId: emp._id,
          date: { $gte: fromDate, $lte: toDate },
        });
        // Any clocked working day is present. Short hours and late arrival are
        // deliberately informational and never become LOP.
        presentDays = records.filter(r => workingDateSet.has(r.date) && r.clockIn && ['present','late','half_day'].includes(r.status))
          .reduce((sum, r) => sum + (r.status === 'half_day' && lopConfig.countHalfDay ? 0.5 : 1), 0);

        const { default: Leave } = await import('@/lib/models/Leave');
        const approvedLeaves = await Leave.find({
          userId: emp._id,
          status: 'approved',
          from: { $lte: toDate },
          to: { $gte: fromDate },
        });

        const paidLeaveDays = approvedLeaves.reduce((sum, leave) => {
          if (leave.typeCode === 'LOP' || leave.type === 'Loss of Pay') return sum;
          const totalRequested = Number(leave.days) || 0;
          const totalPaid = leave.paidDays == null ? totalRequested : Number(leave.paidDays);
          const paidRatio = totalRequested > 0 ? Math.min(1, Math.max(0, totalPaid / totalRequested)) : 0;
          let overlap = 0;
          const start = leave.from < fromDate ? fromDate : leave.from;
          const end = leave.to > toDate ? toDate : leave.to;
          for (let cursor = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
            const d = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
            if (workingDateSet.has(d)) overlap += leave.halfDay ? 0.5 : 1;
          }
          return sum + (overlap * paidRatio);
        }, 0);

        lopDays = Math.max(0, workingDays - (presentDays + paidLeaveDays));

        // Retroactive Leave Adjustments for prior locked cycles
        const retroLeaves = await Leave.find({
          userId: emp._id,
          status: 'approved',
          isRetroactive: true,
          retroAdjustedInPayroll: false,
        });

        let retroLopDays = 0;
        const retroLeaveIds = [];
        for (const rLeave of retroLeaves) {
          retroLopDays += Number(rLeave.unpaidDays) || (rLeave.typeCode === 'LOP' ? Number(rLeave.days) : 0);
          retroLeaveIds.push(rLeave._id);
        }
        retroLopDaysVal = retroLopDays;
        retroLeaveIdsVal = retroLeaveIds;
      }

      const result = calculatePayroll({
        rule,
        grossLPA: structure.grossLPA,
        workingDays,
        totalDaysInMonth: calendarStats.totalDays,
        lopDays,
        retroLopDays: retroLopDaysVal,
        overrides: structure.overrides || [],
        adhocBonuses: [],
      });

      const payroll = await Payroll.findOneAndUpdate(
        { userId: emp._id, month },
        {
          // Legacy flat fields (backward compat)
          monthlyGross:        result.legacy.monthlyGross,
          basicPay:            result.legacy.basicPay,
          hra:                 result.legacy.hra,
          dearnessAllowance:   result.legacy.dearnessAllowance,
          conveyanceAllowance: result.legacy.conveyanceAllowance,
          medicalAllowance:    result.legacy.medicalAllowance,
          pf:                  result.legacy.pf,
          esi:                 result.legacy.esi,
          lossOfPay:           result.legacy.lossOfPay,
          totalDeductions:     result.legacy.totalDeductions,
          netPay:              result.netPay,
          // Dynamic arrays (new rule-driven system)
          earningsArray:       result.earnings,
          deductionsArray:     result.deductions,
          bonuses:             result.bonuses,
          totalEarnings:       result.totalEarnings,
          totalBonuses:        result.totalBonuses,
          ruleSnapshot:        { name: rule?.name || 'Default', ruleId: rule?._id || null },
          // Attendance
          presentDays,
          lopDays,
          workingDays,
          salaryPerDay: result.salaryPerDay,
          holidayDates: workingCalendar.holidays,
          cycleLabel,
          status: 'draft',
          processedBy: user._id,
          processedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      // Mark retro leaves as consumed so the next run does not re-deduct them.
      if (retroLeaveIdsVal.length > 0) {
        try {
          const { default: Leave } = await import('@/lib/models/Leave');
          await Leave.updateMany(
            { _id: { $in: retroLeaveIdsVal } },
            { $set: { retroAdjustedInPayroll: true, retroPayrollRunId: payroll._id } }
          );
        } catch (e) { console.error('Failed to mark retro leaves consumed:', e?.message || e); }
      }
      results.push(payroll);
    }

    const ip = req.headers.get('x-forwarded-for') || '';
    await Promise.all(results.map(r =>
      auditLog('Payroll Run', 'Payroll', user._id, `Payroll draft generated for ${month} (${workingDays} working days)`, 'high', ip, null, r.userId)
    ));

    return ok({ processed: results.length, month, workingDays, isMidCycle });
  } catch (e) {
    return fail(e.message, 500);
  }
}
