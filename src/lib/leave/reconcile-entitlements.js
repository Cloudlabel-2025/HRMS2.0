import mongoose from 'mongoose';
import Leave from '@/lib/models/Leave';
import LeavePolicy from '@/lib/models/LeavePolicy';
import UserLeaveBalance from '@/lib/models/UserLeaveBalance';
import User from '@/lib/models/User';
import AuditLog from '@/lib/models/AuditLog';
import LeaveBalanceAdjustment from '@/lib/models/LeaveBalanceAdjustment';
import { Payroll } from '@/lib/models/Payroll';
import { Holiday } from '@/lib/models/index';
import { getGlobalConfig, isWorkingDay } from '@/lib/payroll-cycle';
import { getTzDateStr } from '@/lib/timezone';
import { buildEntitlementPlan } from './entitlement-plan';
import { payrollPeriod } from '@/lib/payroll-periods';

export async function reconcileEntitlements(userId, { session = null, preview = false, policy: suppliedPolicy = null, actor = null } = {}) {
  if (!session && !preview) return mongoose.connection.transaction(tx => reconcileEntitlements(userId, { session: tx, actor, policy: suppliedPolicy }));
  const employee = await User.findById(userId).session(session).lean();
  if (!employee || ['employer', 'super_admin'].includes(employee.role)) return { skipped: true, reason: 'No employee leave entitlement' };
  if (!preview) await User.collection.updateOne({ _id: employee._id }, { $inc: { leaveEntitlementRevision: 1 } }, { session });
  const oldBalances = await UserLeaveBalance.find({ userId }).session(session).sort({ updatedAt: -1 }).lean();
  const leaves = await Leave.find({ userId }).session(session).sort({ from: 1, createdAt: 1 }).lean();
  const policyId = suppliedPolicy?._id || oldBalances[0]?.policyId || leaves.find(row => row.policyId)?.policyId;
  const policy = suppliedPolicy ? (typeof suppliedPolicy.toObject === 'function' ? suppliedPolicy.toObject() : suppliedPolicy) : (policyId ? await LeavePolicy.findById(policyId).session(session).lean() : null);
  if (!policy) return { skipped: true, reason: 'No assigned leave policy', userId: String(userId) };
  // Mixed policies need explicit review rather than charging a request under
  // another policy's entitlement.
  if (leaves.some(row => ['approved', 'pending'].includes(row.status) && !['SL', 'CL', 'EL'].includes(row.typeCode) && row.policyId && String(row.policyId) !== String(policy._id))) {
    throw new Error(`${employee.name}: leave history spans multiple policies; reconcile policy assignment first.`);
  }
  const config = await getGlobalConfig(), today = await getTzDateStr();
  const holidays = await Holiday.find({}).session(session).lean();
  const adjustments = await LeaveBalanceAdjustment.find({ userId }).session(session).lean();
  const plan = buildEntitlementPlan({ leaves, policy, config, today, joined: employee.joinDate || employee.createdAt,
    adjustments,
    isChargeDate: (date, p) => {
      const holiday = holidays.some(row => row.date === date && !row.workingDayOverride);
      if (holiday) return !!p.countHolidays;
      return p.countWeekends || isWorkingDay(date, config, holidays);
    } });
  const changes = plan.leaves.filter(row => row.leave.entitlementVersion !== 1 || row.paidDays !== row.leave.paidDays || row.unpaidDays !== row.leave.unpaidDays || JSON.stringify(row.payrollDaySplit) !== JSON.stringify((row.leave.payrollDaySplit || []).map(({ date, paidDays, unpaidDays }) => ({ date, paidDays, unpaidDays }))));
  const months = new Set();
  for (const row of changes.filter(row => row.leave.status === 'approved')) for (const d of row.payrollDaySplit) months.add(payrollPeriod(d.date, config).monthKey);
  const summary = { userId: String(userId), name: employee.name, changed: changes.length, affectedMonths: [...months],
    changes: changes.map(row => ({ leaveId: String(row.leave._id), typeCode: row.leave.typeCode, from: row.leave.from, to: row.leave.to, status: row.leave.status,
      oldPaidDays: row.leave.paidDays, oldUnpaidDays: row.leave.unpaidDays, paidDays: row.paidDays, unpaidDays: row.unpaidDays })),
    cycleStart: plan.cycleStart, cycleEnd: plan.cycleEnd, quarterStart: plan.quarterStart, quarterEnd: plan.quarterEnd, balances: plan.balances };
  if (preview) return summary;
  if (months.size) await Payroll.updateMany({ userId, month: { $in: [...months] } }, { $set: { leaveRecalculationRequired: true } }, { session });
  for (const row of changes) await Leave.updateOne({ _id: row.leave._id }, { $set: {
    paidDays: row.paidDays, unpaidDays: row.unpaidDays, payrollDaySplit: row.payrollDaySplit,
    entitlementVersion: 1, balanceApplied: row.leave.status === 'approved',
  } }, { session });
  const year = Number(plan.cycleEnd.slice(0, 4));
  const duplicates = oldBalances.filter(row => {
    const day = new Date(row.cycleStart).toISOString().slice(0, 10);
    return day >= `${year - 1}-12-01` && day <= `${year}-01-02`;
  });
  const start = new Date(`${plan.cycleStart}T00:00:00Z`), end = new Date(`${plan.cycleEnd}T23:59:59.999Z`);
  const canonical = duplicates.find(row => +new Date(row.cycleStart) === +start);
  const unchanged = canonical && duplicates.length === 1 && JSON.stringify(canonical.balances.map(({ typeCode, used, pending, periodUsage, allocated, carriedForward }) => ({ typeCode, used, pending, periodUsage: periodUsage.map(({period,used,cap})=>({period,used,cap})), allocated, carriedForward }))) === JSON.stringify(plan.balances);
  if (!unchanged) {
    await UserLeaveBalance.updateOne({ _id: canonical?._id || new mongoose.Types.ObjectId() }, { $set: {
      userId, policyId: policy._id, cycleStart: start, cycleEnd: end, balances: plan.balances,
    }, $inc: { __v: 1 } }, { upsert: true, session });
    const stale = duplicates.filter(row => String(row._id) !== String(canonical?._id));
    if (stale.length) await UserLeaveBalance.deleteMany({ _id: { $in: stale.map(row => row._id) } }, { session });
  }
  if (changes.length || !unchanged) await AuditLog.create([{
    action: 'Leave Entitlement Reconciled', module: 'Leave', userId: actor?._id || null, targetUserId: userId, severity: 'high',
    details: JSON.stringify({ rule: 'payroll-period-excess-lop-v1', ...summary, previousBalances: duplicates }),
  }], { session });
  return summary;
}

// Update all affected stored payrolls along with the corrected leave ledger.
export async function reconcileLeaveAndPayroll(userId, actor = null, policy = null, { session: existingSession = null, forceAllPayrolls = false } = {}) {
  const { runPayrollForMonth } = await import('@/lib/payroll-run-engine');
  const execute = async session => {
    const result = await reconcileEntitlements(userId, { session, actor, policy });
    if (result.skipped) return result;
    const payrolls = await Payroll.find(forceAllPayrolls ? { userId } : { userId, $or: [{ month: { $in: result.affectedMonths } }, { leaveRecalculationRequired: true }] }).session(session).lean();
    for (const payroll of payrolls) {
      await AuditLog.create([{ action: 'Payroll Reopened for Leave Entitlement', module: 'Payroll', targetUserId: userId,
        userId: actor?._id || null, severity: 'high', details: JSON.stringify({ previousPayroll: payroll, rule: 'payroll-period-excess-lop-v1' }) }], { session });
      const summary = await runPayrollForMonth({ month: payroll.month, userIds: [String(userId)], force: true, session, actor, skipEntitlementReconcile: true });
      if (summary.processed !== 1) throw new Error(`Payroll ${payroll.month} could not be recalculated for ${result.name}.`);
    }
    return { ...result, payrollsUpdated: payrolls.length };
  };
  return existingSession ? execute(existingSession) : mongoose.connection.transaction(execute);
}

export async function reconcileAllLeaveAndPayroll(actor = null) {
  const users = await User.find({ role: { $nin: ['super_admin', 'employer'] } }).select('_id');
  const results = [];
  for (const user of users) results.push(await reconcileLeaveAndPayroll(user._id, actor, null, { forceAllPayrolls: true }));
  return { employees: results.length, payrollsUpdated: results.reduce((sum, row) => sum + (row.payrollsUpdated || 0), 0) };
}
