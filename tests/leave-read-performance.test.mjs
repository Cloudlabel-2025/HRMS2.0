import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildEntitlementPlan } from '../src/lib/leave/entitlement-plan.js';
import { payrollPeriod } from '../src/lib/payroll-periods.js';

test('leave page preview returns current fractional balances without writes or payroll execution', async () => {
  const forbidden = () => { throw new Error('Page read attempted a database mutation'); };
  const query = data => ({ session() { return this; }, sort() { return this; }, lean: async () => data });
  const policy = { _id: 'policy', leaveTypeConfigs: [{ code: 'SL', isPaid: true }] };
  const leaves = [{ _id: 'leave', typeCode: 'SL', status: 'approved', from: '2026-10-01', to: '2026-10-02', days: 2, paidDays: 2, unpaidDays: 0 }];
  const models = {
    '@/lib/models/Leave': { default: { find: () => query(leaves), updateOne: forbidden } },
    '@/lib/models/User': { default: { findById: () => query({ _id: 'employee', role: 'employee', joinDate: '2026-09-26' }), collection: { updateOne: forbidden } } },
    '@/lib/models/UserLeaveBalance': { default: { find: () => query([]), updateOne: forbidden, deleteMany: forbidden } },
    '@/lib/models/LeavePolicy': { default: {} },
    '@/lib/models/LeaveBalanceAdjustment': { default: { find: () => query([]) } },
    '@/lib/models/AuditLog': { default: { create: forbidden } },
    '@/lib/models/Payroll': { Payroll: { find: forbidden, updateMany: forbidden } },
    '@/lib/models/index': { Holiday: { find: () => query([]) } },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({ payrollStartDay: 26, payrollEndDay: 25 }), isWorkingDay: () => true },
    '@/lib/timezone': { getTzDateStr: async () => '2026-10-30' },
    '@/lib/payroll-periods': { payrollPeriod },
    './entitlement-plan': { buildEntitlementPlan },
    mongoose: { default: { connection: { transaction: forbidden } } },
  };
  const context = vm.createContext({ console });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/lib/leave/reconcile-entitlements.js', import.meta.url), 'utf8'), {
    context, importModuleDynamically: forbidden,
  });
  await module.link(async name => {
    assert.ok(models[name], `Unexpected dependency ${name}`);
    const entries = models[name];
    return new vm.SyntheticModule(Object.keys(entries), function () {
      for (const [key, value] of Object.entries(entries)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const result = await module.namespace.reconcileEntitlements('employee', { preview: true, policy });
  assert.equal(result.balances[0].used, 1.5);
  assert.equal(result.leaveLedger[0].payrollDaySplit[1].unpaidDays, 0.5);
  assert.equal(result.changed, 1);
});
