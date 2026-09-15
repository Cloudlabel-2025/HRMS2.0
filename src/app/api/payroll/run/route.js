import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import PayrollRule from '@/lib/models/PayrollRule';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { getGlobalConfig, getPayrollDay, getCycleRange, getWorkingDayCalendar, getCycleLabel, getCycleCalendarStats, isWorkingDay, buildWorkingDateSet } from '@/lib/payroll-cycle';
import { calculatePayroll } from '@/lib/payroll-calculator';
import { classifyPresence } from '@/lib/attendance-resolver';
import { requireAuth, auditLog } from '@/lib/middleware';
import { notify } from '@/lib/notify';
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
    // Single source for working dates: buildWorkingDateSet uses the same
    // isWorkingDay (Saturday policy + holidays) as getWorkingDayCalendar,
    // so payroll, leave and attendance agree. No duplicate iteration logic.
    const fullWorkingDateSet = buildWorkingDateSet(fromDate, toDate, config, holidayDocs);
    // Mid-cycle preview must be provisional: future dates with no record are
    // not LOP yet. Only dates up to today count toward the gap.
    const workingDateSet = isMidCycle
      ? new Set([...fullWorkingDateSet].filter(d => d <= todayStr))
      : fullWorkingDateSet;
    const effectiveWorkingDays = workingDateSet.size;
    const cycleLabel = getCycleLabel(year, monthIndex, startDay, endDay);

    const calendarStats = getCycleCalendarStats(fromDate, toDate);

    // Load default payroll rule
    const defaultRule = await PayrollRule.findOne({ isDefault: true }).lean();

    const employees = await User.find({ status: 'active' });
    const results = [];
    const skipped = [];
    const runId = new mongoose.Types.ObjectId();

    try {
    for (const emp of employees) {
      const existing = await Payroll.findOne({ userId: emp._id, month });
      if (existing?.status === 'finalized') continue;
      // Never demote an approved payroll back to draft without reopen.
      if (existing?.status === 'approved') continue;

      const structure = await SalaryStructure.findOne({ userId: emp._id });
      if (!structure) { skipped.push({ userId: emp._id, reason: 'no salary structure' }); continue; }

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
        // Any clocked working day is present. Short hours, late arrival and
        // permission are deliberately informational and never become LOP.
        // Half-day leave + clock-in credits 0.5 via classifyPresence.
        presentDays = records
          .filter(r => workingDateSet.has(r.date) && r.clockIn && ['present', 'late', 'half_day'].includes(r.status))
          .reduce((sum, r) => sum + classifyPresence(r, lopConfig), 0);

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

        lopDays = Math.max(0, effectiveWorkingDays - (presentDays + paidLeaveDays));

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
        workingDays: effectiveWorkingDays,
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
          effectiveLopDays: result.effectiveLopDays,
          graceDaysApplied: result.graceDaysApplied,
          retroLopDays: retroLopDaysVal,
          workingDays: effectiveWorkingDays,
          fullCycleWorkingDays: workingDays,
          salaryPerDay: result.salaryPerDay,
          holidayDates: workingCalendar.holidays,
          cycleLabel,
          runId,
          status: 'draft',
          processedBy: user._id,
          processedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      // Mark retro leaves as consumed so the next run does not re-deduct them.
      // Only mark leaves consumed for payrolls actually (re)generated in this run.
      if (retroLeaveIdsVal.length > 0) {
        try {
          const { default: Leave } = await import('@/lib/models/Leave');
          await Leave.updateMany(
            { _id: { $in: retroLeaveIdsVal }, retroAdjustedInPayroll: { $ne: true } },
            { $set: { retroAdjustedInPayroll: true, retroPayrollRunId: payroll._id } }
          );
        } catch (e) {
          await auditLog('Payroll Retro Mark Failed', 'Payroll', user._id, `Run ${runId} could not mark retro leaves: ${e?.message || e}`, 'high', req.headers.get('x-forwarded-for') || '', null, emp._id);
        }
      }
      results.push(payroll);
    }
    } catch (runErr) {
      // Compensate: remove drafts created by this run so a retry starts clean.
      // Finalized/approved records are never touched (skipped above).
      await Payroll.deleteMany({ runId, status: 'draft' }).catch(() => {});
      await auditLog('Payroll Run Failed', 'Payroll', user._id, `Run ${runId} for ${month} aborted: ${runErr?.message || runErr}. Drafts rolled back.`, 'high', req.headers.get('x-forwarded-for') || '', null, null);
      return fail(`Payroll run aborted and rolled back: ${runErr?.message || runErr}`, 500);
    }

    const ip = req.headers.get('x-forwarded-for') || '';
    await Promise.all(results.map(r =>
      auditLog('Payroll Run', 'Payroll', user._id, `Payroll draft generated for ${month} (${effectiveWorkingDays} working days) run ${runId}`, 'high', ip, null, r.userId)
    ));
    // Persistent Topbar alert (type payroll) so the run result survives the
    // transient 3s toast — the runResult modal reads the same payload.
    try {
      const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
      await notify(
        admins.map(a => a._id),
        isMidCycle ? `Payroll Preview — ${month}` : `Payroll Processed — ${month}`,
        `${results.length} draft(s) generated, ${skipped.length} skipped (${effectiveWorkingDays} working days).`,
        'payroll',
        null
      );
    } catch { /* non-fatal */ }

    return ok({ processed: results.length, skipped, runId: runId.toString(), month, workingDays: effectiveWorkingDays, fullCycleWorkingDays: workingDays, isMidCycle });
  } catch (e) {
    return fail(e.message, 500);
  }
}
