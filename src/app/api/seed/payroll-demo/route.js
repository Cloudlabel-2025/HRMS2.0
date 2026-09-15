import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Payroll, SalaryStructure, LeavePolicy, UserLeaveBalance, SelfServiceRequest, Employee, Shift, Holiday } from '@/lib/models';
import PayrollRule from '@/lib/models/PayrollRule';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, getPayrollDay, getCycleRange, buildWorkingDateSet } from '@/lib/payroll-cycle';
import { resolvePolicyForUser, getOrCreateBalance } from '@/app/api/leave/balance/route';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Only super admin can seed payroll demo', 403);

    await dbConnect();
    const body = await req.json().catch(() => ({}));
    const employeeEmail = String(body.employeeEmail || 'abishek@gmail.com').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employeeEmail)) return fail('Valid employeeEmail is required', 400);
    // Default month = current payroll cycle month (YYYY-MM of cycle end).
    const nowD = new Date();
    const defaultMonth = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
    const month = String(body.month || defaultMonth);
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('month must be YYYY-MM', 400);
    const grossLPA = Number(body.grossLPA || 624000);
    if (!Number.isFinite(grossLPA) || grossLPA <= 0) return fail('grossLPA must be positive', 400);

    // New-employee credentials (used only when the email does not exist yet).
    const empName = String(body.name || employeeEmail.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Demo').slice(0, 80);
    const empPassword = String(body.password || 'Temp@12345');
    if (empPassword.length < 6) return fail('password must be at least 6 characters', 400);
    const empDepartment = String(body.department || 'Engineering').slice(0, 80);
    const empDesignation = String(body.designation || 'SDE I').slice(0, 80);
    const empPhone = String(body.phone || '9876543210').slice(0, 20);
    const empShift = String(body.shift || 'Morning (9AM-6PM)').slice(0, 80);
    const empRole = ['employee', 'intern'].includes(body.role) ? body.role : 'employee';

    const [y, m] = month.split('-').map(Number);
    const config = await getGlobalConfig();
    const startDay = getPayrollDay(config.payrollStartDay, 26);
    const endDay = getPayrollDay(config.payrollEndDay, 25);
    const { fromDate, toDate } = getCycleRange(startDay, endDay, y, m - 1);
    const holidays = await Holiday.find({ date: { $gte: fromDate, $lte: toDate } }).lean();
    const workingSet = buildWorkingDateSet(fromDate, toDate, config, holidays);
    const workingDates = [...workingSet].sort();
    if (workingDates.length < 5) return fail('Not enough working days in this cycle to seed demo', 400);

    // ── 1. Employee (create with credentials if missing, else reuse + keep dept/shift) ──
    let emp = await User.findOne({ email: employeeEmail });
    if (!emp) {
      emp = await User.create({
        name: empName, email: employeeEmail, password: empPassword,
        role: empRole, department: empDepartment, designation: empDesignation,
        phone: empPhone, shift: empShift,
        joinDate: new Date('2025-06-01'), status: 'active', isFirstLogin: true,
      });
    }
    if (emp.status !== 'active') { emp.status = 'active'; await emp.save(); }

    let identity = emp.identityId ? await UsrIdentity.findById(emp.identityId) : await UsrIdentity.findOne({ primaryEmail: employeeEmail });
    if (!identity) {
      identity = await UsrIdentity.create({
        identityCode: `ID-DEMO-${Date.now().toString().slice(-6)}`,
        authUserId: emp._id, legalFirstName: emp.name.split(' ')[0], legalName: emp.name,
        displayName: emp.name, primaryEmail: employeeEmail, personalPhone: emp.phone || '',
        gender: 'prefer_not_to_say', recordStatus: 'active', sourceSystem: 'manual',
      });
    }
    let profile = emp.profileId ? await EmpProfile.findById(emp.profileId) : await EmpProfile.findOne({ identityId: identity._id });
    if (!profile) {
      const count = await EmpProfile.countDocuments();
      profile = await EmpProfile.create({
        identityId: identity._id, employeeNumber: `EMP-DEMO-${String(count + 1).padStart(3, '0')}`,
        employmentType: 'full_time', employmentStatus: 'active',
        department: emp.department || empDepartment, designation: emp.designation || empDesignation,
        shift: emp.shift || empShift, hireDate: new Date('2025-06-01'),
        sourceSystem: 'manual',
      });
    }
    await User.findByIdAndUpdate(emp._id, { identityId: identity._id, profileId: profile._id });
    await Employee.findOneAndUpdate(
      { userId: emp._id },
      { userId: emp._id, name: emp.name, email: emp.email, department: emp.department, designation: emp.designation, shift: emp.shift, status: 'active' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const shiftName = emp.shift || empShift;
    const shiftStart = /16:00|night|3rd/i.test(shiftName) ? '16:00' : '09:00';
    const shiftEnd = /16:00|night|3rd/i.test(shiftName) ? '06:00' : '18:00';
    await Shift.findOneAndUpdate(
      { name: shiftName },
      { name: shiftName, startTime: shiftStart, endTime: shiftEnd },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ── 2. Salary + rule ──
    let rule = await PayrollRule.findOne({ isDefault: true });
    if (!rule) {
      rule = await PayrollRule.create({
        name: 'Standard (India)', isDefault: true,
        earnings: [{ code: 'BASIC', label: 'Basic Pay', type: 'percent_of_gross', value: 50, taxable: true }],
        deductions: [], lopConfig: { basis: 'working_days', deductFrom: 'gross', countHalfDay: true, graceDays: 0 },
      });
    }
    await SalaryStructure.findOneAndUpdate(
      { userId: emp._id }, { userId: emp._id, grossLPA, ruleId: rule._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ── 3. Policy + balance (paid demo leave must be paid, not phantom LOP) ──
    const policy = await resolvePolicyForUser(emp);
    if (!policy) return fail('No active leave policy found. Seed /api/seed/leave-policy first.', 400);
    const balance = await getOrCreateBalance(emp._id, policy);
    for (const code of ['CL', 'SL', 'EL']) {
      const entry = balance.balances.find(b => b.typeCode === code);
      if (entry && (entry.allocated || 0) <= 0) {
        const cfg = policy.leaveTypeConfigs?.find(c => c.code === code);
        const annual = Number(cfg?.annualAllocation || 0);
        const div = cfg?.creditSchedule === 'monthly' ? 12 : cfg?.creditSchedule === 'half_yearly' ? 2 : 4;
        entry.allocated = Number((annual / div).toFixed(2)) || 1.5;
      }
      if (entry) { entry.used = 0; entry.pending = 0; }
    }
    await balance.save();

    // ── 4. Wipe prior demo data for this cycle (idempotent) ──
    await Payroll.deleteMany({ userId: emp._id, month });
    await Attendance.deleteMany({ userId: emp._id, date: { $gte: fromDate, $lte: toDate } });
    await Leave.deleteMany({ userId: emp._id, from: { $gte: fromDate }, to: { $lte: toDate } });
    await SelfServiceRequest.deleteMany({ profileId: profile._id, requestType: 'permission', 'payload.date': { $gte: fromDate, $lte: toDate } });

    // ── 5. Pick demo dates relative to THIS cycle (not hardcoded Feb) ──
    const at = i => workingDates[Math.min(Math.max(i, 0), workingDates.length - 1)];
    const pickWorking = iso => (workingSet.has(iso) ? iso : null);
    const halfDayDate = pickWorking(`${y}-${String(m).padStart(2, '0')}-10`) || at(5);
    const permDate = pickWorking(`${y}-${String(m).padStart(2, '0')}-12`) || at(6);
    const leaveDate = pickWorking(`${y}-${String(m).padStart(2, '0')}-14`) || at(8);
    const lateDates = [at(1), at(3)].filter(d => d !== halfDayDate && d !== leaveDate && d !== permDate);

    // ── 6. Leaves (approved, paid) ──
    const clCfg = policy.leaveTypeConfigs?.find(c => c.code === 'CL');
    const fullLeave = await Leave.create({
      userId: emp._id, typeCode: 'CL', type: clCfg?.name || 'Casual Leave',
      from: leaveDate, to: leaveDate, days: 1, paidDays: 1, unpaidDays: 0,
      halfDay: false, halfDayType: null, reason: 'Payroll demo full day leave',
      documents: [], policyId: policy._id, status: 'approved', balanceApplied: true,
      adminApproval: 'approved', teamAdminApproval: 'approved', tlApproval: 'approved',
    });
    const halfLeave = await Leave.create({
      userId: emp._id, typeCode: 'CL', type: clCfg?.name || 'Casual Leave',
      from: halfDayDate, to: halfDayDate, days: 0.5, paidDays: 0.5, unpaidDays: 0,
      halfDay: true, halfDayType: 'first_half', reason: 'Payroll demo half day leave',
      documents: [], policyId: policy._id, status: 'approved', balanceApplied: true,
      adminApproval: 'approved', teamAdminApproval: 'approved', tlApproval: 'approved',
    });
    const clEntry = balance.balances.find(b => b.typeCode === 'CL');
    if (clEntry) { clEntry.used = Number(((clEntry.used || 0) + 1.5).toFixed(2)); await balance.save(); }

    // ── 7. Attendance ──
    const docs = [];
    for (const d of workingDates) {
      if (d === leaveDate) {
        docs.push({ userId: emp._id, date: d, status: 'leave', relatedLeaveId: fullLeave._id });
        continue;
      }
      if (d === halfDayDate) {
        docs.push({
          userId: emp._id, date: d, clockIn: '09:30', clockOut: '13:30',
          hoursWorked: 240, payableHours: 240, baseHoursWorked: 240,
          status: 'half_day', lateFlag: false, approvedHalfDayLeave: true, relatedLeaveId: halfLeave._id,
        });
        continue;
      }
      if (d === permDate) {
        const perm = await SelfServiceRequest.create({
          identityId: identity._id, profileId: profile._id, requestType: 'permission',
          payload: {
            date: d, startTime: '09:00', endTime: '11:00', duration: 120,
            usedDuration: 60, refundedMins: 60, applied: true, actualClockIn: '10:00', isMidDay: false,
            cycleRange: { fromDate, toDate },
          },
          reason: 'Payroll demo permission 2 hours arrived in 1 hour',
          status: 'approved', reviewerUserId: user._id, reviewedAt: new Date(),
        });
        docs.push({
          userId: emp._id, date: d, clockIn: '10:00', clockOut: '18:00',
          hoursWorked: 480, payableHours: 480, baseHoursWorked: 480,
          status: 'present', lateFlag: false, shortHours: false,
          permission: {
            requestId: perm._id, startTime: '09:00', endTime: '11:00',
            duration: 120, grantedDuration: 120, usedDuration: 60, refundedDuration: 60,
            actualClockIn: '10:00', effectiveClockIn: '09:00', applied: true, isMidDay: false, status: 'approved',
          },
        });
        continue;
      }
      const late = lateDates.includes(d);
      docs.push({
        userId: emp._id, date: d,
        clockIn: late ? '09:45' : '09:30', clockOut: '18:00',
        hoursWorked: late ? 495 : 510, payableHours: late ? 495 : 510, baseHoursWorked: late ? 495 : 510,
        status: late ? 'late' : 'present', lateFlag: late, shortHours: false,
      });
    }
    // Leave the last 2 working dates with NO record → real LOP gap demo.
    const lopDemoDates = workingDates.slice(-2);
    const toInsert = docs.filter(r => !lopDemoDates.includes(r.date));
    if (toInsert.length) await Attendance.insertMany(toInsert);

    await auditLog('Payroll Demo Seeded', 'Payroll', user._id, `Seeded ${employeeEmail} for ${month} (${fromDate} to ${toDate})`, 'medium', req.headers.get('x-forwarded-for') || '', null, emp._id);

    const presentCredit = toInsert.reduce((s, r) => s + (r.status === 'half_day' ? 0.5 : 1), 0);
    return ok({
      employee: { email: employeeEmail, userId: emp._id, name: emp.name, department: emp.department, shift: emp.shift },
      cycle: { month, fromDate, toDate, workingDays: workingDates.length, holidayDates: holidays.map(h => h.date) },
      seeded: {
        attendance: toInsert.length, leaves: 2, permission: 1,
        halfDayDate, leaveDate, permDate, lateDates, lopGapDates: lopDemoDates,
        presentCredit, paidLeaveDays: 1.5,
        expectedLop: Math.max(0, workingDates.length - (presentCredit + 1.5)),
      },
      nextStep: `POST /api/payroll/run { month: "${month}" } then open Payroll → ${month} payslip for ${employeeEmail}`,
    }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
