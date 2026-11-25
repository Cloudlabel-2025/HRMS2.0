import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLeaveCalendar, isWorkingDay } from '../src/lib/leave/calendar.js';
import { buildEntitlementPlan } from '../src/lib/leave/entitlement-plan.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as calendarModule from '../src/lib/leave/calendar.js';
import * as leaveTypes from '../src/lib/leave/types.js';

const config = { saturdayWorking: 'none' };
const holidays = [{ date: '2026-11-23', name: 'Company holiday' }];

test('consecutive leave excludes Sunday, off Saturday and named holidays', () => {
  const result = calculateLeaveCalendar('2026-11-20', '2026-11-24', config, holidays);
  assert.equal(result.days, 2);
  assert.equal(result.calendarDays, 5);
  assert.deepEqual(result.chargeableDates, ['2026-11-20', '2026-11-24']);
  assert.deepEqual(result.excludedDates, [
    { date: '2026-11-21', reason: 'Saturday (weekly holiday)' },
    { date: '2026-11-22', reason: 'Sunday (weekly holiday)' },
    { date: '2026-11-23', reason: 'Company holiday' },
  ]);
});

test('working Saturdays count, marked holidays do not, and compensated Saturdays count', () => {
  assert.equal(calculateLeaveCalendar('2026-11-21', '2026-11-21', { saturdayWorking: 'all' }).days, 1);
  assert.equal(calculateLeaveCalendar('2026-11-21', '2026-11-21', { saturdayWorking: 'all' }, [{ date: '2026-11-21', name: 'Holiday' }]).days, 0);
  assert.equal(calculateLeaveCalendar('2026-11-21', '2026-11-21', config, [{ date: '2026-11-21', workingDayOverride: true }]).days, 1);
  assert.equal(isWorkingDay('2026-11-22', config, [{ date: '2026-11-22', workingDayOverride: true }]), false);
});

test('alternate Saturdays and year boundaries use the same working calendar', () => {
  const result = calculateLeaveCalendar('2026-12-25', '2027-01-05', { saturdayWorking: 'alternate' }, ['2027-01-01']);
  assert.equal(result.calendarDays, 12);
  assert.equal(result.days + result.excludedDates.length, 12);
  assert.equal(result.chargeableDates.includes('2027-01-01'), false);
  const saturdays = ['2026-12-26', '2027-01-02'];
  assert.equal(saturdays.filter(date => result.chargeableDates.includes(date)).length, 1);
});

test('half days require one working date; holidays and invalid ranges charge zero', () => {
  assert.equal(calculateLeaveCalendar('2026-11-20', '2026-11-20', config, holidays, { halfDay: true }).days, 0.5);
  for (const [from, to] of [['2026-11-21', '2026-11-21'], ['2026-11-22', '2026-11-22'], ['2026-11-23', '2026-11-23'], ['2026-11-20', '2026-11-24']]) {
    assert.equal(calculateLeaveCalendar(from, to, config, holidays, { halfDay: true }).days, 0);
  }
  for (const [from, to] of [['', ''], ['2026-02-30', '2026-03-02'], ['2026-11-24', '2026-11-20']]) {
    assert.equal(calculateLeaveCalendar(from, to, config, holidays).days, 0);
  }
});

test('leave balance and payroll splits charge only calendar working dates', () => {
  const calendar = calculateLeaveCalendar('2026-11-20', '2026-11-24', config, holidays);
  const leave = { _id: 'new', typeCode: 'CL', from: '2026-11-20', to: '2026-11-24',
    status: 'pending', days: calendar.days, calendarVersion: 1 };
  const plan = buildEntitlementPlan({ leaves: [leave], policy: {
    countHolidays: true, countWeekends: true, sandwichRule: true,
    leaveTypeConfigs: [{ code: 'CL', isPaid: true, annualAllocation: 24, maxUsagePerPeriod: 6 }],
  }, config, today: '2026-11-25', joined: '2026-01-01',
  isChargeDate: (date, policy, request) => request.calendarVersion === 1 && isWorkingDay(date, config, holidays) });
  assert.deepEqual(plan.leaves[0].payrollDaySplit.map(row => row.date), calendar.chargeableDates);
  assert.equal(plan.leaves[0].paidDays + plan.leaves[0].unpaidDays, 2);
});

async function applyLeave(role, overrides = {}) {
  let record;
  const user = { _id: 'employee', role, name: 'Employee' };
  const policy = { countHolidays: true, countWeekends: true, sandwichRule: true,
    leaveTypeConfigs: [{ code: 'CL', name: 'Casual leave', enabled: true, isPaid: true, allowHalfDay: true }] };
  const balance = { cycleStart: new Date('2026-01-01'), balances: [
    { typeCode: 'CL', allocated: 12, carriedForward: 0, used: 0, pending: 0 },
  ], save: async () => {} };
  const leaveModel = { findOne: async () => null, countDocuments: async () => 0,
    create: async data => (record = { _id: 'request', ...data }),
    findById: () => ({ lean: async () => record }),
  };
  const adapters = {
    '@/lib/db': { connectDB: async () => {} },
    '@/lib/models/index': { Leave: leaveModel, LeavePolicy: {}, EmpProfile: {},
      Holiday: { find: () => ({ lean: async () => holidays }) },
      SelfServiceRequest: {}, SME: { findOne: async () => ({ _id: 'sme', status: 'active' }) } },
    '@/lib/models/User': { default: { find: () => ({ select: async () => [] }) } },
    '@/lib/middleware': { requireAuth: async () => ({ user }), auditLog: async () => {} },
    '@/lib/jwt': { ok: (data, status = 200) => ({ data, status }), fail: (error, status) => ({ error, status }) },
    '@/lib/validation': { CreateLeaveSchema: {}, validateRequest: (_, data) => ({ valid: true, data }) },
    '@/lib/notify': { notify: async () => {} },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => config },
    '@/lib/leave/calendar': calendarModule,
    '@/lib/leave/types': leaveTypes,
    '@/app/api/leave/balance/route': { resolvePolicyForUser: async () => policy, getOrCreateBalance: async () => balance },
    '@/lib/permissions': { MANAGER_ROLES: [], isEmployer: value => value === 'employer' },
    '@/lib/rbac': { canApproveLeave: () => true, getDepartmentUserIds: async () => [] },
    '@/lib/leave/eligibility': { buildEmployeeContext: async () => ({}), evaluateEligibility: () => ({ eligible: true }) },
    '@/lib/leave/accrual': { calculatePeriodAllowance: () => 12 },
    '@/lib/leave/linked-types': { getLinkedTypes: () => [], CLASSIFICATION_WORKFLOW: [] },
    '@/lib/leave/reconcile-entitlements': { reconcileLeaveAndPayroll: async () => {} },
  };
  const context = vm.createContext({ console: { log() {}, error() {} } });
  const modules = new Map();
  async function dependency(specifier) {
    if (modules.has(specifier)) return modules.get(specifier);
    const values = adapters[specifier];
    assert.ok(values, `Unexpected dependency: ${specifier}`);
    const module = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
    modules.set(specifier, module);
    await module.link(() => {});
    await module.evaluate();
    return module;
  }
  const source = await readFile(new URL('../src/app/api/leave/route.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context, importModuleDynamically: dependency });
  await module.link(dependency);
  await module.evaluate();
  const response = await module.namespace.POST({ headers: { get: () => '' }, json: async () => ({
    typeCode: 'CL', from: '2026-11-20', to: '2026-11-24', halfDay: false,
    reason: 'Family leave', documents: [], ...overrides,
  }) });
  return { response, record, balance };
}

for (const role of ['employee', 'employer', 'sme']) {
  test(`${role} application excludes calendar holidays even with sandwich/count flags enabled`, async () => {
    const { response, record } = await applyLeave(role);
    assert.equal(response.status, 201, response.error);
    assert.equal(record.days, 2);
    assert.equal(record.calendarVersion, 1);
    assert.equal(record.excludedDates.length, 3);
  });
}

test('API rejects holidays-only and half-day holiday applications without creating leave', async () => {
  for (const halfDay of [false, true]) {
    const { response, record } = await applyLeave('employee', { from: '2026-11-23', to: '2026-11-23', halfDay });
    assert.equal(response.status, 400);
    assert.equal(record, undefined);
  }
});
