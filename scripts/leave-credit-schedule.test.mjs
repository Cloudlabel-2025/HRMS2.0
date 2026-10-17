import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as creditSchedule from '../src/lib/leave/credit-schedule.js';

const source = await readFile(new URL('../src/app/api/leave/balance/route.js', import.meta.url), 'utf8');

async function setup(config, initialBalance = null) {
  let date = new Date(2026, 0, 1);
  let balance = initialBalance;
  const policy = { _id: 'policy', leaveTypeConfigs: [config] };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [date])); }
  }
  const context = vm.createContext({
    Date: Clock,
    require: specifier => {
      assert.equal(specifier, '@/lib/leave/eligibility');
      return { buildEmployeeContext: async () => ({}), evaluateEligibility: () => ({ eligible: true }) };
    },
  });
  const model = {
    findOne: async () => balance,
    create: async data => { balance = { ...data, async save() {} }; return balance; },
    find: async () => balance ? [balance] : [],
  };
  const adapters = {
    '@/lib/db': { default: async () => {} },
    '@/lib/models/index': { UserLeaveBalance: model, LeavePolicy: { findById: async () => policy } },
    '@/lib/models/User': { default: { findById: () => ({ select: async () => ({ role: 'employee' }) }), find: () => ({ select: async () => [] }) } },
    '@/lib/models/EmploymentProfile': { default: {} },
    '@/lib/middleware': { requireAuth: async () => ({ user: { role: 'super_admin' } }), auditLog: async () => {} },
    '@/lib/jwt': { ok: data => ({ data, status: 200 }), fail: (error, status) => ({ error, status }) },
    '@/lib/permissions': { EMPLOYER_ROLES: [], isEmployer: () => false },
    '@/lib/leave/credit-schedule': creditSchedule,
  };
  const route = new vm.SourceTextModule(source, { context });
  await route.link(specifier => {
    const values = adapters[specifier];
    assert.ok(values, `Unexpected dependency: ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await route.evaluate();
  return { route: route.namespace, policy, setMonth: month => { date = new Date(2026, month, 1); } };
}

const sickLeave = { code: 'SL', name: 'Sick Leave', annualAllocation: 6, creditSchedule: 'quarterly', enabled: true, isPaid: true };
const accrualRequest = { json: async () => ({ action: 'monthly-accrual' }), headers: { get: () => '' } };

test('1.5 quarterly days gives 6 yearly; changing frequency keeps the yearly entitlement', () => {
  assert.equal(creditSchedule.getAnnualEntitlement(1.5, 'quarterly'), 6);
  assert.equal(creditSchedule.getDaysPerCredit(sickLeave), 1.5);
  assert.equal(creditSchedule.getDaysPerCredit({ ...sickLeave, creditSchedule: 'monthly' }), 0.5);
  assert.equal(creditSchedule.getDaysPerCredit({ ...sickLeave, creditSchedule: 'half_yearly' }), 3);
  assert.equal(creditSchedule.getDaysPerCredit({ ...sickLeave, creditSchedule: 'upfront' }), 6);
});

test('four quarterly installments accrue 1.5, 3, 4.5, 6 and survive balance reloads', async () => {
  const { route, policy, setMonth } = await setup(sickLeave);
  const balance = await route.getOrCreateBalance('employee', policy);
  assert.equal(balance.balances[0].allocated, 1.5);
  for (const [month, expected] of [[3, 3], [6, 4.5], [9, 6]]) {
    setMonth(month);
    assert.equal((await route.POST(accrualRequest)).status, 200);
    assert.equal(balance.balances[0].allocated, expected);
    await route.getOrCreateBalance('employee', policy);
    assert.equal(balance.balances[0].allocated, expected);
    await route.POST(accrualRequest);
    assert.equal(balance.balances[0].allocated, expected, 'same-month retries cannot duplicate a credit');
  }
  setMonth(10);
  await route.POST(accrualRequest);
  assert.equal(balance.balances[0].allocated, 6, 'no additional credit between quarters');
});

test('adding a periodic type to an existing balance credits its first installment immediately', async () => {
  const balance = { userId: 'employee', policyId: 'policy', balances: [], async save() {} };
  const { route, policy } = await setup(sickLeave, balance);
  await route.getOrCreateBalance('employee', policy);
  assert.equal(balance.balances[0].allocated, 1.5);
});

test('unpaid types do not accrue a paid balance', async () => {
  const { route, policy, setMonth } = await setup({ ...sickLeave, isPaid: false });
  const balance = await route.getOrCreateBalance('employee', policy);
  assert.equal(balance.balances[0].allocated, 0);
  setMonth(3);
  await route.POST(accrualRequest);
  assert.equal(balance.balances[0].allocated, 0);
});

test('linked request types do not get independent balances or periodic credits', async () => {
  const linked = { ...sickLeave, code: 'EM', balanceMode: 'linked' };
  assert.equal(creditSchedule.getDaysPerCredit(linked), 0);
  const { route, policy } = await setup(linked);
  const balance = await route.getOrCreateBalance('employee', policy);
  assert.equal(balance.balances.length, 0);
});
