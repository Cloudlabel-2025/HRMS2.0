import mongoose from 'mongoose';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import PayrollRule from '@/lib/models/PayrollRule';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { getGlobalConfig, getPayrollDay, getCycleRange, getWorkingDayCalendar, getCycleLabel, getCycleCalendarStats, buildWorkingDateSet, buildCalendarMap } from '@/lib/payroll-cycle';
import { calculatePayroll } from '@/lib/payroll-calculator';
import { classifyDayPay } from '@/lib/attendance-resolver';
import { isWorkedDay } from '@/lib/attendance-stats';
import { syncEmployeeCalendarRows } from '@/lib/attendance-sync';
import { auditLog } from '@/lib/middleware';
import { notify } from '@/lib/notify';
import { isEmployer } from '@/lib/permissions';
import { resolveShiftForDate } from '@/lib/shift-utils';
import { determineStatus, getShiftConfig } from '@/lib/attendance-constants';
import { getEmploymentStartDate, countUnpaidWorkingDays } from '@/lib/payroll-lop-utils';

const DEFAULT_LOP_CONFIG = { basis: 'working_days', deductFrom: 'gross', countHalfDay: true, graceDays: 0, lateLopMode: 'half', lateGraceMinutes: 0, halfDayThresholdFullLop: true };

/** 'HH:MM' → minutes since midnight, or null when unparseable. */
function toMinsOf(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** A leave is unpaid ONLY when its own type is explicitly unpaid (Loss of Pay). */
function isUnpaidLeave(leave) {
  return leave.typeCode === 'LOP'
    || leave.type === 'Loss of Pay'
    || leave.isPaid === false;
}

/**
 * Generate payroll drafts for one cycle month.
 *
 * Extracted from `POST /api/payroll/run` so the leave-approval path can safely
 * trigger a scoped re-run of a cycle it just reopened (see payroll-reopen.js).
 * The route handler is now a thin wrapper — this is the single source of truth
 * for how lopDays is derived.
 *
 * @param {Object} params
 * @param {string} params.month          - 'YYYY-MM'
 * @param {string[]} [params.userIds]    - scope to these user ids (default: all active)
 * @param {Object} [params.actor]        - user performing the run (audit)
 * @param {string} [params.ip]
 * @param {boolean} [params.force]       - re-generate even if approved/finalized
 *                                          (only set by an explicit reopen)
 * @returns {Object} summary
 */
export async function runPayrollForMonth({ month, userIds = null, actor = null, ip = '', force = false }) {
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
  const holidayDocs = workingCalendar.holidays.map(date => ({ date, workingDayOverride: (workingCalendar.workingDayOverrides || []).includes(date) }));
  // Full calendar classification for the cycle: every date is exactly one
  // of working | holiday | weekly_off. The attendance register is
  // materialised against this same map (see syncEmployeeCalendarRows), so
  // payroll, attendance and the absence grid always agree.
  const calMap = buildCalendarMap(fromDate, toDate, config, holidayDocs);
  const fullWorkingDateSet = buildWorkingDateSet(fromDate, toDate, config, holidayDocs);
  // Mid-cycle preview must be provisional: future dates with no record are
  // not LOP yet. Only dates up to today count toward the gap.
  const workingDateSet = isMidCycle
    ? new Set([...fullWorkingDateSet].filter(d => d <= todayStr))
    : fullWorkingDateSet;
  const effectiveWorkingDays = workingDateSet.size;
  const cycleLabel = getCycleLabel(year, monthIndex, startDay, endDay);

  const calendarStats = getCycleCalendarStats(fromDate, toDate, config);

  const defaultRule = await PayrollRule.findOne({ isDefault: true }).lean();

  const userFilter = { status: 'active' };
  if (Array.isArray(userIds) && userIds.length) userFilter._id = { $in: userIds.map(id => new mongoose.Types.ObjectId(String(id))) };
  const employees = await User.find(userFilter);

  const results = [];
  const skipped = [];
  const runId = new mongoose.Types.ObjectId();

  try {
    for (const emp of employees) {
      const existing = await Payroll.findOne({ userId: emp._id, month });
      if (!force) {
        if (existing?.status === 'finalized') continue;
        // Never demote an approved payroll back to draft without reopen.
        if (existing?.status === 'approved') continue;
      }

      const structure = await SalaryStructure.findOne({ userId: emp._id });
      if (!structure) { skipped.push({ userId: emp._id, reason: 'no salary structure' }); continue; }

      const rule = structure.ruleId
        ? (await PayrollRule.findById(structure.ruleId).lean()) || defaultRule
        : defaultRule;
      const lopConfig = rule?.lopConfig || DEFAULT_LOP_CONFIG;

      // Day counters are declared once for the whole employee and reused, so
      // the values persisted below are exactly the ones counted. (A previous
      // version re-declared `daysWorked` inside the else-block, which shadowed
      // the outer binding and persisted 0 for every non-employer.)
      let presentDays = 0;
      let daysWorked = 0;
      let absentDaysVal = 0;
      let paidLeaveDaysVal = 0;
      let unpaidLeaveDaysVal = 0;
      let holidayDaysVal = 0;
      let weeklyOffDaysVal = 0;
      let retroLopDaysVal = 0;
      let lopDays = 0;
      let retroLeaveIdsVal = [];
      // Late-arrival LOP, split by tier so the payslip can show its working.
      let lateLopDaysVal = 0;
      let slightLateDaysVal = 0;
      let pastThresholdLateDaysVal = 0;

      if (isEmployer(emp.role)) {
        presentDays = workingDays;
        daysWorked = workingDays;
        lopDays = 0;
      } else {
        const { default: Leave } = await import('@/lib/models/Leave');
        const approvedLeaves = await Leave.find({
          userId: emp._id,
          status: 'approved',
          from: { $lte: toDate },
          to: { $gte: fromDate },
        });

        // Employment-start guard (same rule as attendance-sync): pre-joining
        // dates are never LOP. The sync skips materialising them, so without
        // this filter the safety-net below would count every pre-joining
        // working date as an absence.
        const employmentStartDate = await getEmploymentStartDate(emp._id);

        // Approved-leave coverage clipped to this cycle. A date covered by an
        // approved leave is credited by the leave loop below, so the absent
        // branches must not count it even when its register row is missing
        // or stale — otherwise one day becomes absent 1.0 + unpaid 1.0.
        const leaveCoveredDates = new Set();
        for (const leave of approvedLeaves) {
          const start = leave.from < fromDate ? fromDate : leave.from;
          const end = leave.to > toDate ? toDate : leave.to;
          for (let cursor = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
            leaveCoveredDates.add(cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0'));
          }
        }

        // Materialise the calendar register first: every elapsed date gets a
        // row (missing working days become absent, non-working days become
        // holiday, approved-leave days become leave). Clocked rows are never
        // touched, so this is a pure backfill — the LOP below counts real rows.
        await syncEmployeeCalendarRows({
          userId: emp._id,
          fromDate,
          toDate,
          config,
          holidays: holidayDocs,
          todayStr,
          allowTodayAbsent: !isMidCycle,
          leaves: approvedLeaves,
        });

        const records = await Attendance.find({
          userId: emp._id,
          date: { $gte: fromDate, $lte: toDate },
        });

        // Recompute status and the half-day-threshold flag from the frozen
        // shift snapshot. The stored flag is unreliable — seed data set it true
        // on every late row and nothing corrected it — and the late LOP tiers
        // are money-bearing, so they must be derived here every run.
        //
        // PERMISSION: an approved window exempts lateness only while the
        // employee clocked in within it. Inside the window the day is Present
        // with no LOP; past the window end the normal late tiers apply.
        const eligibleRecords = records.filter(r => workingDateSet.has(r.date) && isWorkedDay(r));
        for (const record of eligibleRecords) {
          if (!record.clockIn || record.approvedHalfDayLeave || ['leave', 'holiday'].includes(record.status)) continue;
          const shift = await resolveShiftForDate(emp, record.date).catch(() => null);
          if (!shift?.startTime) continue;
          const cfg = getShiftConfig(shift, config);
          const [sh, sm] = shift.startTime.split(':').map(Number);
          const [h, mi] = record.clockIn.split(':').map(Number);
          let minutes = (h - sh) * 60 + (mi - sm);
          if (minutes < -720) minutes += 1440;
          if (minutes > 720) minutes -= 1440;
          record._minutesLate = minutes;

          // Approved permission covering this arrival -> authorised lateness.
          const permEnd = toMinsOf(record.permission?.endTime);
          const hasWindow = !!(record.permission?.requestId || record.permission?.startTime);
          if (hasWindow && permEnd !== null && toMinsOf(record.clockIn) <= permEnd) {
            record.status = 'present';
            record.lateFlag = false;
            record.halfDayThresholdExceeded = false;
            continue;
          }
          const result = determineStatus(minutes, cfg);
          record.status = result.status;
          record.lateFlag = result.lateFlag;
          record.halfDayThresholdExceeded = !!result.halfDayThresholdExceeded;
        }

        // Explicit day counting from the stored register — no gap arithmetic.
        // A working date with no row at this point is a safety-net absent
        // (the sync above should have written it).
        //
        // lopDays = absentDays + lateLopDays + unpaidLeaveDays.
        // classifyDayPay returns 0 lopDays for absent rows because they are
        // counted by absentDays above, so the two can never double-count.
        const byDate = new Map(records.map(r => [r.date, r]));
        presentDays = 0;
        absentDaysVal = 0;
        daysWorked = 0;
        let lateLopDays = 0;
        let slightLateDays = 0;
        let pastThresholdLateDays = 0;
        for (const d of workingDateSet) {
          if (employmentStartDate && d < employmentStartDate) continue;
          const r = byDate.get(d);
          if (!r) { if (!leaveCoveredDates.has(d)) absentDaysVal += 1; continue; }
          if (r.status === 'absent' && !r.clockIn) { if (!leaveCoveredDates.has(d)) absentDaysVal += 1; continue; }
          // Days Worked: integer count of working dates actually turned up
          // (same definition as the Team report card — not the fractional
          // payroll credit, which lives in presentDays).
          if (isWorkedDay(r)) daysWorked += 1;
          if (r.status === 'late') {
            if (r.halfDayThresholdExceeded && lopConfig.halfDayThresholdFullLop !== false && (lopConfig.lateLopMode ?? 'half') !== 'none') {
              pastThresholdLateDays += 1;
            } else {
              slightLateDays += 1;
            }
          }
          const { presence, lopDays: dayLop } = classifyDayPay(r, lopConfig, r._minutesLate ?? null);
          presentDays += presence;
          lateLopDays += dayLop;
        }
        lateLopDaysVal = Number(lateLopDays.toFixed(2));
        slightLateDaysVal = slightLateDays;
        pastThresholdLateDaysVal = pastThresholdLateDays;
        holidayDaysVal = [...calMap.holidays].filter(d => d <= todayStr).length;
        weeklyOffDaysVal = [...calMap.weeklyOff].filter(d => d <= todayStr).length;

        // Paid vs unpaid leave on elapsed working days.
        //
        // A PAID leave type is always paid in full, so paidRatio is 1 unless
        // the leave is explicitly unpaid (Loss of Pay). This is read from the
        // leave's own `isPaid` snapshot rather than `paidDays / days`, which
        // used to dilute a leave's paid ratio whenever it straddled a cycle
        // boundary (a 2-day leave fully inside the cycle became 0.19 because
        // days counted the whole span while the cycle loop only saw part).
        //
        // A day the employee actually worked (clock-in) is already credited via
        // presence, so the leave overlap skips it — except half-day leave,
        // where 0.5 presence + 0.5 leave correctly make a full day. A half-day
        // leave on a day NEVER clocked in leaves the remaining half of the
        // working day neither worked nor covered: that remainder is LOP.
        const clockedDates = new Set(records.filter(r => r.clockIn).map(r => r.date));
        let paidLeaveDays = 0;
        let unpaidLeaveDays = 0;
        let unpaidHalfDayRemainder = 0;
        for (const leave of approvedLeaves) {
          const paidRatio = isUnpaidLeave(leave) ? 0 : 1;
          const halfDayCountsAsFull = leave.halfDay && lopConfig.countHalfDay === false;
          const start = leave.from < fromDate ? fromDate : leave.from;
          const end = leave.to > toDate ? toDate : leave.to;
          for (let cursor = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
            const d = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
            if (!workingDateSet.has(d)) continue;
            if (employmentStartDate && d < employmentStartDate) continue;
            const workedThatDay = clockedDates.has(d);
            if (workedThatDay && !leave.halfDay) continue;
            const credit = leave.halfDay && !halfDayCountsAsFull ? 0.5 : 1;
            paidLeaveDays += credit * paidRatio;
            unpaidLeaveDays += credit * (1 - paidRatio);
            // Remainder is LOP-only: a paid half-day leave never creates LOP,
            // and when countHalfDay is false the full-day credit already
            // covers the whole working day.
            if (leave.halfDay && !workedThatDay && paidRatio === 0 && !halfDayCountsAsFull) unpaidHalfDayRemainder += 0.5;
          }
        }
        unpaidLeaveDays += unpaidHalfDayRemainder;
        paidLeaveDaysVal = Math.round(paidLeaveDays * 100) / 100;
        unpaidLeaveDaysVal = Math.round(unpaidLeaveDays * 100) / 100;

        // LOP = stored absent days + late-arrival LOP + unpaid leave days.
        // Nothing is inferred from a residual gap, so the figure always matches
        // the register. Short hours and break excess are NOT here by design.
        lopDays = Math.max(0, absentDaysVal + lateLopDaysVal + unpaidLeaveDaysVal);

        // Retroactive Leave Adjustments for prior locked cycles. Scoped to
        // leaves that closed BEFORE this cycle started — an unscoped query
        // pushed a backdated adjustment onto whatever cycle ran next.
        const retroLeaves = await Leave.find({
          userId: emp._id,
          status: 'approved',
          isRetroactive: true,
          retroAdjustedInPayroll: false,
          to: { $lt: fromDate },
        });

        let retroLopDays = 0;
        const retroLeaveIds = [];
        for (const rLeave of retroLeaves) {
          // Working-day count on the payroll calendar — the same figure the
          // in-cycle loop would have produced. Stored unpaidDays may include
          // weekends/holidays (leave-policy flags) or legacy bulk values.
          retroLopDays += await countUnpaidWorkingDays(rLeave, config, lopConfig);
          retroLeaveIds.push(rLeave._id);
        }
        retroLopDays = Math.round(retroLopDays * 100) / 100;
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
        lopBreakdownAbsent: absentDaysVal,
        lopBreakdownLate: lateLopDaysVal,
        lopBreakdownUnpaid: unpaidLeaveDaysVal,
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
          // Attendance — explicit day-breakdown from the stored register
          presentDays,
          daysWorked,
          absentDays: absentDaysVal,
          lateLopDays: lateLopDaysVal,
          slightLateDays: slightLateDaysVal,
          pastThresholdLateDays: pastThresholdLateDaysVal,
          // Always 0 — the overtime rule is not defined yet. Persisted so the
          // storage exists ahead of the rule; deliberately not in net pay.
          overtimeMinutes: 0,
          paidLeaveDays: paidLeaveDaysVal,
          unpaidLeaveDays: unpaidLeaveDaysVal,
          holidayDays: holidayDaysVal,
          weeklyOffDays: weeklyOffDaysVal,
          lopDays,
          effectiveLopDays: result.effectiveLopDays,
          graceDaysApplied: result.graceDaysApplied,
          retroLopDays: retroLopDaysVal,
          payableDays: result.payableDays,
          lopBaseAmount: result.lopBase,
          workingDays: effectiveWorkingDays,
          fullCycleWorkingDays: workingDays,
          salaryPerDay: result.salaryPerDay,
          holidayDates: workingCalendar.holidays,
          cycleLabel,
          runId,
          status: 'draft',
          processedBy: actor?._id || null,
          processedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      // Mark retro leaves consumed so the next run does not re-deduct them.
      if (retroLeaveIdsVal.length > 0) {
        try {
          await Leave.updateMany(
            { _id: { $in: retroLeaveIdsVal }, retroAdjustedInPayroll: { $ne: true } },
            { $set: { retroAdjustedInPayroll: true, retroPayrollRunId: payroll._id } }
          );
        } catch (e) {
          await auditLog('Payroll Retro Mark Failed', 'Payroll', actor?._id || null, `Run ${runId} could not mark retro leaves: ${e?.message || e}`, 'high', ip, null, emp._id);
        }
      }
      results.push(payroll);
    }
  } catch (runErr) {
    // Compensate: remove drafts created by this run so a retry starts clean.
    // Records that were already approved/finalized and merely re-run under
    // `force` are preserved — only drafts bearing this runId are removed.
    await Payroll.deleteMany({ runId, status: 'draft' }).catch(() => {});
    await auditLog('Payroll Run Failed', 'Payroll', actor?._id || null, `Run ${runId} for ${month} aborted: ${runErr?.message || runErr}. Drafts rolled back.`, 'high', ip, null, null);
    throw runErr;
  }

  await Promise.all(results.map(r =>
    auditLog('Payroll Run', 'Payroll', actor?._id || null, `Payroll draft generated for ${month} (${effectiveWorkingDays} working days) run ${runId}`, 'high', ip, null, r.userId)
  ));

  return {
    month,
    runId: runId.toString(),
    processed: results.length,
    skipped,
    workingDays: effectiveWorkingDays,
    fullCycleWorkingDays: workingDays,
    isMidCycle,
    payrolls: results,
  };
}

/** Best-effort admin notification about a completed run. Never fatal. */
export async function notifyPayrollRun(admins, summary) {
  try {
    await notify(
      admins.map(a => a._id),
      summary.isMidCycle ? `Payroll Preview — ${summary.month}` : `Payroll Processed — ${summary.month}`,
      `${summary.processed} draft(s) generated, ${summary.skipped.length} skipped (${summary.workingDays} working days).`,
      'payroll',
      null
    );
  } catch { /* non-fatal */ }
}