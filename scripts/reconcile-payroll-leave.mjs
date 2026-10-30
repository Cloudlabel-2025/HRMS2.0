import nextEnv from '@next/env';
import mongoose from 'mongoose';
import { setServers } from 'node:dns';
nextEnv.loadEnvConfig(process.cwd());
if (process.env.MONGODB_DNS_SERVERS) setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()));
const apply = process.argv.includes('--apply');
const repairBalances = process.argv.includes('--repair-balances');
try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const { reconcileEntitlements, reconcileLeaveAndPayroll } = await import('../src/lib/leave/reconcile-entitlements.js');
  const { normalizeEntitlementType } = await import('../src/lib/payroll-periods.js');
  const { default: Policy } = await import('../src/lib/models/LeavePolicy.js');
  const { default: User } = await import('../src/lib/models/User.js');
  const { default: AuditLog } = await import('../src/lib/models/AuditLog.js');
  if (apply) {
    const policies = await Policy.find({ status: 'active' });
    for (const policy of policies) {
      const configs = policy.leaveTypeConfigs.map(row => normalizeEntitlementType(row.toObject()));
      await mongoose.connection.transaction(async session => {
        await AuditLog.create([{ action: 'Payroll-period Leave Policy Updated', module: 'Leave', severity: 'high', details: JSON.stringify({ previousPolicy: policy.toObject(), leaveTypeConfigs: configs }) }], { session });
        await Policy.updateOne({ _id: policy._id }, { $set: { leaveTypeConfigs: configs } }, { session });
      });
    }
  }
  const users = await User.find({ role: { $nin: ['super_admin', 'employer'] } }).select('_id name').lean();
  let failed = 0, updated = 0, payrolls = 0;
  for (const user of users) {
    try {
      const result = apply || repairBalances ? await reconcileLeaveAndPayroll(user._id, null, null, { forceAllPayrolls: apply }) : await reconcileEntitlements(user._id, { preview: true });
      console.log(JSON.stringify({ name: user.name, ...result }));
      updated += result.changed || 0; payrolls += result.payrollsUpdated || 0;
    } catch (error) { failed++; console.error(JSON.stringify({ name: user.name, error: error.message })); }
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : repairBalances ? 'repair-balances' : 'preview', users: users.length, leavesChanged: updated, payrollsUpdated: payrolls, failed }));
  if (process.argv.includes('--verify')) {
    const { Payroll } = await import('../src/lib/models/Payroll.js');
    const { default: Balance } = await import('../src/lib/models/UserLeaveBalance.js');
    const { default: Leave } = await import('../src/lib/models/Leave.js');
    const pending = await Payroll.countDocuments({ leaveRecalculationRequired: true });
    const duplicateCycles = await Balance.aggregate([{ $group: { _id: { userId: '$userId', cycleStart: '$cycleStart' }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
    const stephen = users.find(user => /Stephen Praveen/i.test(user.name));
    const leaves = stephen ? await Leave.find({ userId: stephen._id, status: 'approved', typeCode: 'SL', from: { $gte: '2026-09-26', $lte: '2026-12-25' } }).select('from to days paidDays unpaidDays').sort({ from: 1 }).lean() : [];
    const payrolls = stephen ? await Payroll.find({ userId: stephen._id }).select('month status paidLeaveDays unpaidLeaveDays lopDays leaveRecalculationRequired').sort({ month: 1 }).lean() : [];
    console.log(JSON.stringify({ verification: { pendingPayrolls: pending, duplicateCycles: duplicateCycles.length, stephen: { leaves, payrolls } } }));
    if (updated || pending || duplicateCycles.length) process.exitCode = 1;
  }
  if (failed) process.exitCode = 1;
} catch (error) { console.error(error.name, error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
