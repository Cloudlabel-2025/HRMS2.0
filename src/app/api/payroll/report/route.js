import { connectDB } from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import PayrollRule from '@/lib/models/PayrollRule';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import {
  getGlobalConfig,
  getPayrollDay,
  getCycleRange,
  getWorkingDayCalendar,
  getCycleLabel,
  getCycleCalendarStats,
  buildWorkingDateSet,
} from '@/lib/payroll-cycle';
import { classifyDayPay } from '@/lib/attendance-resolver';
import { resolveShiftForDate } from '@/lib/shift-utils';
import { determineStatus, getShiftConfig } from '@/lib/attendance-constants';

const DEFAULT_LOP_CONFIG = {
  basis: 'working_days',
  deductFrom: 'gross',
  countHalfDay: true,
  graceDays: 0,
  lateLopMode: 'half',
  lateGraceMinutes: 0,
  halfDayThresholdFullLop: true,
};

const round = (n) => Math.round(Number(n || 0) * 100) / 100;

/** A leave is unpaid ONLY when its own type is explicitly unpaid (Loss of Pay). */
function isUnpaidLeave(leave) {
  return leave.typeCode === 'LOP' || leave.type === 'Loss of Pay' || leave.isPaid === false;
}

function toMinsOf(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayNameOf = (dateStr) => DAY_NAMES[new Date(`${dateStr}T00:00:00`).getDay()] || '';

/**
 * GET /api/payroll/report?month=YYYY-MM
 *
 * Read-only report payload for the payroll Excel export. Returns stored
 * payroll totals plus re-derived per-date LOP rows (LOP-generating dates
 * only) so the workbook can show which date produced how much LOP, of which
 * type/quantum and on which rule basis. Never writes to the database.
 */
export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    if (!month) return fail('Month is required (YYYY-MM)');
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('Month must be in YYYY-MM format');

    const [y, m] = month.split('-').map(Number);
    const config = await getGlobalConfig();
    const startDay = getPayrollDay(config.payrollStartDay, 26);
    const endDay = getPayrollDay(config.payrollEndDay, 25);
    const { fromDate, toDate } = getCycleRange(startDay, endDay, y, m - 1);

    const todayStr = new Date().toISOString().slice(0, 10);
    const isMidCycle = todayStr <= toDate;

    const workingCalendar = await getWorkingDayCalendar(fromDate, toDate, config);
    const holidayDocs = workingCalendar.holidays.map((date) => ({
      date,
      workingDayOverride: (workingCalendar.workingDayOverrides || []).includes(date),
    }));
    const fullWorkingDateSet = buildWorkingDateSet(fromDate, toDate, config, holidayDocs);
    const workingDateSet = isMidCycle
      ? new Set([...fullWorkingDateSet].filter((d) => d <= todayStr))
      : fullWorkingDateSet;
    const orderedWorkingDates = [...workingDateSet].sort();
    const cycleLabel = getCycleLabel(y, m - 1, startDay, endDay);
    const calendarStats = getCycleCalendarStats(fromDate, toDate, config);

    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const query = { month };
    if (!isAdmin) query.userId = user._id;

    const payrolls = await Payroll.find(query)
      .populate('userId', 'name avatar department designation role')
      .sort({ 'userId.name': 1 })
      .lean();

    const { default: Leave } = await import('@/lib/models/Leave');
    const defaultRule = await PayrollRule.findOne({ isDefault: true }).lean();

    const details = {};

    for (const payroll of payrolls) {
      const empId = payroll.userId?._id || payroll.userId;
      const pid = String(payroll._id);
      const salaryPerDay = Number(payroll.salaryPerDay) || 0;

      const structure = await SalaryStructure.findOne({ userId: empId }).lean();
      const rule = structure?.ruleId
        ? ((await PayrollRule.findById(structure.ruleId).lean()) || defaultRule)
        : defaultRule;
      const lopConfig = rule?.lopConfig || DEFAULT_LOP_CONFIG;
      const basisLabel = `${lopConfig.deductFrom || 'gross'} / ${lopConfig.basis || 'working_days'}`;
      const ruleLabel = `${basisLabel} · late:${lopConfig.lateLopMode ?? 'half'}`;

      // Employers never accrue LOP — no per-date rows.
      const empRole = payroll.userId?.role;
      if (empRole && ['employer', 'super_admin', 'admin_full'].includes(empRole) && (payroll.lopDays || 0) === 0) {
        details[pid] = { rows: [], rule: lopConfig, basisLabel, ruleLabel };
        continue;
      }

      const [records, approvedLeaves] = await Promise.all([
        Attendance.find({ userId: empId, date: { $gte: fromDate, $lte: toDate } }).lean(),
        Leave.find({ userId: empId, status: 'approved', from: { $lte: toDate }, to: { $gte: fromDate } }).lean(),
      ]);

      // Recompute late tiers from the frozen shift snapshot (same as the run
      // engine) so half/full escalation matches the stored lateLopDays.
      const byDate = new Map(records.map((r) => [r.date, { ...r }]));
      const empDoc = { _id: empId, role: empRole };
      for (const d of orderedWorkingDates) {
        const record = byDate.get(d);
        if (!record?.clockIn || record.approvedHalfDayLeave || ['leave', 'holiday'].includes(record.status)) continue;
        const shift = await resolveShiftForDate(empDoc, d).catch(() => null);
        if (!shift?.startTime) continue;
        const cfg = getShiftConfig(shift, config);
        const [sh, sm] = String(shift.startTime).split(':').map(Number);
        const [h, mi] = String(record.clockIn).split(':').map(Number);
        if ([sh, sm, h, mi].some((v) => Number.isNaN(v))) continue;
        let minutes = (h - sh) * 60 + (mi - sm);
        if (minutes < -720) minutes += 1440;
        if (minutes > 720) minutes -= 1440;
        record._minutesLate = minutes;

        const permEnd = toMinsOf(record.permission?.endTime);
        const hasWindow = !!(record.permission?.requestId || record.permission?.startTime);
        if (hasWindow && permEnd !== null && toMinsOf(record.clockIn) <= permEnd) {
          record.status = 'present';
          record.halfDayThresholdExceeded = false;
          continue;
        }
        const result = determineStatus(minutes, cfg);
        record.status = result.status;
        record.halfDayThresholdExceeded = !!result.halfDayThresholdExceeded;
      }

      // Leave overlap lookup: date -> covering approved leaves.
      const leavesByDate = new Map();
      for (const leave of approvedLeaves) {
        const start = leave.from < fromDate ? fromDate : leave.from;
        const end = leave.to > toDate ? toDate : leave.to;
        for (
          let cursor = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`);
          cursor <= last;
          cursor.setDate(cursor.getDate() + 1)
        ) {
          const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
          if (!workingDateSet.has(d)) continue;
          if (!leavesByDate.has(d)) leavesByDate.set(d, []);
          leavesByDate.get(d).push(leave);
        }
      }
      const clockedDates = new Set(records.filter((r) => r.clockIn).map((r) => r.date));

      const rows = [];
      for (const d of orderedWorkingDates) {
        const r = byDate.get(d);
        const covering = leavesByDate.get(d) || [];

        // 1. Absent (no row, or absent with no clock-in) → Full day LOP.
        if (!r || (r.status === 'absent' && !r.clockIn)) {
          rows.push({
            date: d,
            day: dayNameOf(d),
            status: 'absent',
            clockIn: '',
            lopType: 'Absent',
            quantum: 'Full',
            dayLop: 1,
            amount: round(salaryPerDay * 1),
            basis: ruleLabel,
          });
          continue;
        }

        // 2. Late arrival LOP via the shared money classifier.
        if (r.status === 'late') {
          const { lopDays: dayLop } = classifyDayPay(r, lopConfig, r._minutesLate ?? null);
          if (dayLop > 0) {
            const full = dayLop >= 1;
            rows.push({
              date: d,
              day: dayNameOf(d),
              status: full && r.halfDayThresholdExceeded ? 'late (past half-day)' : 'late',
              clockIn: r.clockIn || '',
              lopType: 'Late',
              quantum: full ? 'Full' : 'Half',
              dayLop,
              amount: round(salaryPerDay * dayLop),
              basis: ruleLabel,
            });
          }
          continue;
        }

        // 3. Unpaid leave overlap (skips days already worked, except half-day
        // leave which splits 0.5 presence + 0.5 leave; a half-day leave with
        // no clock-in leaves a 0.5 remainder that is also LOP).
        for (const leave of covering) {
          if (!isUnpaidLeave(leave)) continue;
          const workedThatDay = clockedDates.has(d);
          if (workedThatDay && !leave.halfDay) continue;
          const halfDayCountsAsFull = leave.halfDay && lopConfig.countHalfDay === false;
          const credit = leave.halfDay && !halfDayCountsAsFull ? 0.5 : 1;
          let dayLop = credit;
          if (leave.halfDay && !workedThatDay) dayLop += 0.5;
          dayLop = round(dayLop);
          if (dayLop <= 0) continue;
          rows.push({
            date: d,
            day: dayNameOf(d),
            status: `leave (${leave.typeCode || leave.type || 'LOP'})`,
            clockIn: r.clockIn || '',
            lopType: 'Unpaid Leave',
            quantum: dayLop >= 1 ? 'Full' : 'Half',
            dayLop,
            amount: round(salaryPerDay * dayLop),
            basis: ruleLabel,
          });
        }
      }

      // 4. Retro LOP rows (prior locked cycles, adjusted in this run).
      let retroRows = [];
      try {
        const retroLeaves = await Leave.find({
          $or: [{ retroPayrollRunId: payroll._id }, { _id: { $in: [] } }],
          userId: empId,
          status: 'approved',
        }).lean();
        for (const rl of retroLeaves) {
          const days = Number(rl.unpaidDays) || (rl.typeCode === 'LOP' ? Number(rl.days) : 0) || 0;
          if (days <= 0) continue;
          retroRows.push({
            date: rl.to || rl.from || '',
            day: (rl.to || rl.from) ? dayNameOf(rl.to || rl.from) : '',
            status: `retro leave (${rl.typeCode || rl.type || 'LOP'})`,
            clockIn: '',
            lopType: 'Retro',
            quantum: days >= 1 ? 'Full' : 'Half',
            dayLop: round(days),
            amount: round(salaryPerDay * days),
            basis: ruleLabel,
          });
        }
      } catch {
        retroRows = [];
      }
      // Fallback: run marked retro days but the link lookup found nothing
      // (e.g. legacy data) — still show one summary retro row.
      if (retroRows.length === 0 && Number(payroll.retroLopDays) > 0) {
        retroRows.push({
          date: '',
          day: '',
          status: 'retro adjustment (prior cycle)',
          clockIn: '',
          lopType: 'Retro',
          quantum: Number(payroll.retroLopDays) >= 1 ? 'Full' : 'Half',
          dayLop: round(payroll.retroLopDays),
          amount: round(salaryPerDay * Number(payroll.retroLopDays)),
          basis: ruleLabel,
        });
      }

      details[pid] = { rows: [...rows, ...retroRows], rule: lopConfig, basisLabel, ruleLabel };
    }

    return ok({
      month,
      cycleLabel,
      fromDate,
      toDate,
      isMidCycle,
      calendarDays: calendarStats.totalDays,
      payrolls,
      details,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
