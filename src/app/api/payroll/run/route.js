import { connectDB } from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { getGlobalConfig, getPayrollDay, getCycleRange, getWorkingDayCalendar, getCycleLabel, getCycleCalendarStats } from '@/lib/payroll-cycle';
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
    if (todayStr <= toDate) {
      return fail(`Payroll can only be processed after the cycle end date (${toDate})`, 400);
    }

    const workingCalendar = await getWorkingDayCalendar(fromDate, toDate, config);
    const workingDays = workingCalendar.workingDays;
    const cycleLabel = getCycleLabel(year, monthIndex, startDay, endDay);

    const calendarStats = getCycleCalendarStats(fromDate, toDate);

    const employees = await User.find({ status: 'active' });
    const results = [];

    for (const emp of employees) {
      const existing = await Payroll.findOne({ userId: emp._id, month });
      if (existing?.status === 'finalized') continue;

      const structure = await SalaryStructure.findOne({ userId: emp._id });
      if (!structure) continue;

      let presentDays;
      let lopDays;
      let unpaidLeaves;

      if (isEmployer(emp.role)) {
        presentDays = workingDays;
        lopDays = 0;
        unpaidLeaves = 0;
      } else {
        const records = await Attendance.find({
          userId: emp._id,
          date: { $gte: fromDate, $lte: toDate },
        });
        presentDays = records.filter(r => ['present','late'].includes(r.status)).length;

        const { default: Leave } = await import('@/lib/models/Leave');
        const approvedLeaves = await Leave.find({
          userId: emp._id,
          status: 'approved',
          from: { $lte: toDate },
          to: { $gte: fromDate },
        });

        const paidLeaveDays = approvedLeaves
          .filter(l => l.typeCode !== 'LOP' && l.type !== 'Loss of Pay')
          .reduce((sum, l) => sum + (l.paidDays || l.days), 0);

        const autoLopDays = approvedLeaves.reduce((sum, l) => sum + (l.unpaidDays || 0), 0);
        lopDays = Math.max(0, workingDays - (presentDays + paidLeaveDays)) + autoLopDays;
      }

      const result = calculatePayroll({
        grossLPA: structure.grossLPA,
        totalDaysInMonth: calendarStats.totalDays,
        sundaysInMonth: calendarStats.sundays,
        alternateSaturdaysInMonth: calendarStats.alternateSaturdays,
        unpaidLeavesTaken: unpaidLeaves,
        workingDays,
      });

      const payroll = await Payroll.findOneAndUpdate(
        { userId: emp._id, month },
        {
          monthlyGross: result.earnings.monthlyGross,
          basicPay: result.earnings.basicPay,
          hra: result.earnings.hra,
          dearnessAllowance: result.earnings.dearnessAllowance,
          conveyanceAllowance: result.earnings.conveyanceAllowance,
          medicalAllowance: result.earnings.medicalAllowance,
          pf: result.deductions.employeePF,
          esi: result.deductions.employeeESI,
          lossOfPay: result.deductions.lossOfPayDeduction,
          totalDeductions: result.deductions.totalDeductions,
          netPay: result.netTakeHome,
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
      results.push(payroll);
    }

    const ip = req.headers.get('x-forwarded-for') || '';
    await Promise.all(results.map(r =>
      auditLog('Payroll Run', 'Payroll', user._id, `Payroll draft generated for ${month} (${workingDays} working days)`, 'high', ip, null, r.userId)
    ));

    return ok({ processed: results.length, month, workingDays });
  } catch (e) {
    return fail(e.message, 500);
  }
}
