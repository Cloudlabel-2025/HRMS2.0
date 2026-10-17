import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import * as linkedTypes from '../src/lib/leave/linked-types.js';

const applySource = await readFile(new URL('../src/app/api/leave/route.js', import.meta.url), 'utf8');
const approvalSource = await readFile(new URL('../src/app/api/leave/[id]/route.js', import.meta.url), 'utf8');
const configs = [
  { code: 'CL', name: 'Casual Leave', enabled: true, isPaid: true, allowHalfDay: true, noticePeriodDays: 30 },
  { code: 'SL', name: 'Sick Leave', enabled: true, isPaid: true, requiresDocuments: true },
  { code: 'LOP', name: 'Loss of Pay', enabled: true, isPaid: false },
  { code: 'EM', name: 'Emergency Leave', enabled: true, balanceMode: 'linked', linkedLeaveTypes: ['CL', 'SL', 'LOP'] },
];
const request = data => ({ json: async () => data, headers: { get: () => '' } });

async function setup({ application = {}, noticePeriodDays = 0, expectedStatus = 201 } = {}) {
  let record;
  let role = 'employee';
  const applicant = { _id: 'employee', name: 'Employee', role: 'employee' };
  const policy = { _id: 'policy', leaveTypeConfigs: structuredClone(configs), maxPendingApplications: 5 };
  policy.leaveTypeConfigs.find(config => config.code === 'EM').noticePeriodDays = noticePeriodDays;
  const balance = { cycleStart: new Date(new Date().getFullYear(), 0, 1), balances: [
    { typeCode: 'CL', allocated: 10, carriedForward: 0, used: 1, pending: 2 },
    { typeCode: 'SL', allocated: 6, carriedForward: 0, used: 0, pending: 1 },
    { typeCode: 'LOP', allocated: 0, carriedForward: 0, used: 0, pending: 0 },
  ], async save() {} };
  const emptyDocs = () => Object.assign([], { lean: async () => [] });
  const leaveModel = {
    findOne: async () => null, countDocuments: async () => 0,
    create: async data => { record = { ...data, _id: 'request', balanceApplied: false, async save() {}, toObject() { return { ...this }; } }; return record; },
    findById: () => ({ populate: async () => { record.userId = applicant; return record; } }),
  };
  const adapters = {
    '@/lib/db': { connectDB: async () => {} },
    '@/lib/models/index': { Leave: leaveModel, LeavePolicy: { findById: async () => policy }, EmpProfile: {}, Holiday: { find: emptyDocs }, UserLeaveBalance: { findOne: async () => balance } },
    '@/lib/models/Attendance': { default: { findOneAndUpdate: async () => {}, deleteMany: async () => {} } },
    '@/lib/models/User': { default: { find: () => ({ select: async () => [] }), findById: () => ({ select: () => ({ lean: async () => null }) }) } },
    '@/lib/middleware': { requireAuth: async () => ({ user: role === 'employee' ? applicant : { _id: 'approver', name: 'Approver', role } }), auditLog: async () => {} },
    '@/lib/jwt': { ok: (data, status = 200) => ({ data, status }), fail: (error, status) => ({ error, status }) },
    '@/lib/validation': { CreateLeaveSchema: {}, validateRequest: (_, data) => ({ valid: true, data }) },
    '@/lib/notify': { notify: async () => {} },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({}), countWorkingDaysInRange: () => 2, isWorkingDay: () => true },
    '@/app/api/leave/balance/route': { resolvePolicyForUser: async () => policy, getOrCreateBalance: async () => balance },
    '@/lib/permissions': { MANAGER_ROLES: ['super_admin'], isEmployer: () => false },
    '@/lib/rbac': { canApproveLeave: () => true, getDepartmentUserIds: async () => null, canViewUser: async () => true },
    '@/lib/leave/eligibility': { buildEmployeeContext: async () => ({ gender: 'male' }), evaluateEligibility: () => ({ eligible: true }) },
    '@/lib/leave/accrual': { calculatePeriodAllowance: () => 10, getRelativePeriod: () => ({}), recordPeriodUsageSplit: () => {}, recordPeriodUsage: () => {} },
    '@/lib/payroll-reopen': { reopenPayrollForLeave: async () => [] },
    '@/lib/leave/linked-types': linkedTypes,
    '@/lib/leave-permission-revert': { expandDates: () => [], revertPermissionsForLeave: async () => {} },
    zod: { z },
  };
  const context = vm.createContext({ console: { log() {}, error() {} } });
  async function dependency(specifier) {
    const values = adapters[specifier];
    assert.ok(values, `Unexpected dependency: ${specifier}`);
    const module = new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
    await module.link(() => {});
    return module;
  }
  async function load(source) {
    const module = new vm.SourceTextModule(source, { context, importModuleDynamically: async specifier => { const dep = await dependency(specifier); await dep.evaluate(); return dep; } });
    await module.link(dependency);
    await module.evaluate();
    return module.namespace;
  }
  const apply = await load(applySource);
  const approval = await load(approvalSource);
  const created = await apply.POST(request({ typeCode: 'EM', from: '2026-11-02', to: '2026-11-03', halfDay: false, reason: 'Urgent family situation', documents: [], ...application }));
  assert.equal(created.status, expectedStatus, created.error);
  return { created, balance, policy, record, setRole: value => { role = value; }, approve: data => approval.PUT(request(data), { params: Promise.resolve({ id: 'request' }) }) };
}

test('selected or all underlying types exclude self, disabled, and other linked types', () => {
  const source = configs[3];
  assert.deepEqual(linkedTypes.getLinkedTypes(source, configs).map(type => type.code), ['CL', 'SL', 'LOP']);
  assert.deepEqual(linkedTypes.getLinkedTypes({ ...source, linkAllLeaveTypes: true }, [...configs, { code: 'OFF', enabled: false }, { code: 'OTHER', balanceMode: 'linked' }]).map(type => type.code), ['CL', 'SL', 'LOP']);
  assert.ok(linkedTypes.linkedTypeError([{ ...source, linkedLeaveTypes: ['EM'] }]));
  assert.ok(linkedTypes.linkedTypeError([{ ...source, linkedLeaveTypes: [] }]));
});

test('an employee can request emergency leave with no own balance or reservation', async () => {
  const { record, balance } = await setup();
  assert.equal(record.requestedTypeCode, 'EM');
  assert.equal(record.classificationRequired, true);
  assert.equal(record.paidDays, 0);
  assert.equal(record.unpaidDays, 0);
  assert.equal(record.workflowApprovals.length, 1);
  assert.equal(record.workflowApprovals[0].label, 'Super Admin classification');
  assert.equal(balance.balances[0].pending, 2);
  assert.equal(balance.balances.some(entry => entry.typeCode === 'EM'), false);
});

test('only Super Admin can classify, including through a direct API call', async () => {
  const state = await setup();
  state.setRole('admin_full');
  assert.equal((await state.approve({ action: 'approved', classifiedTypeCode: 'CL' })).status, 403);
  assert.equal(state.record.typeCode, 'EM');
  assert.equal(state.balance.balances[0].used, 1);
});

test('missing, unlinked, and document-restricted classifications cannot approve', async () => {
  const state = await setup();
  state.setRole('super_admin');
  for (const code of [undefined, 'EM', 'OTHER', 'SL']) {
    assert.equal((await state.approve({ action: 'approved', classifiedTypeCode: code })).status, 400);
  }
  assert.equal(state.record.typeCode, 'EM');
  assert.equal(state.balance.balances[0].used, 1);
});

test('classification charges only the chosen source and preserves unrelated pending reservations', async () => {
  const state = await setup();
  state.setRole('super_admin');
  const result = await state.approve({ action: 'approved', classifiedTypeCode: 'CL' });
  assert.equal(result.status, 200, result.error);
  assert.equal(state.record.status, 'approved');
  assert.equal(state.record.typeCode, 'CL');
  assert.equal(state.record.requestedTypeCode, 'EM');
  assert.equal(state.record.classifiedBy, 'approver');
  assert.equal(state.record.paidDays, 2);
  assert.equal(state.record.unpaidDays, 0);
  assert.equal(state.balance.balances[0].used, 3);
  assert.equal(state.balance.balances[0].pending, 2);
  assert.equal(state.balance.balances[1].used, 0);
  assert.equal((await state.approve({ action: 'approved', classifiedTypeCode: 'CL' })).status, 400);
  assert.equal(state.balance.balances[0].used, 3);
  assert.equal((await state.approve({ action: 'rejected', reason: 'Request withdrawn' })).status, 200);
  assert.equal(state.balance.balances[0].used, 1);
  assert.equal(state.balance.balances[0].pending, 2);
});

test('classifying as an explicitly unpaid type records unpaid days without a paid deduction', async () => {
  const state = await setup();
  state.setRole('super_admin');
  assert.equal((await state.approve({ action: 'approved', classifiedTypeCode: 'LOP' })).status, 200);
  assert.equal(state.record.paidDays, 0);
  assert.equal(state.record.unpaidDays, 2);
  assert.equal(state.balance.balances[0].used, 1);
});

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

test('zero-notice emergency leave can be requested today and classified against a 30-day-notice type', async () => {
  const state = await setup({ application: { from: today(), to: today() } });
  state.setRole('super_admin');
  assert.equal((await state.approve({ action: 'approved', classifiedTypeCode: 'CL' })).status, 200);
  assert.equal(state.record.typeCode, 'CL');
  assert.equal(state.record.requestedTypeCode, 'EM');
});

test('an integrated request still follows its own configured notice period', async () => {
  const state = await setup({ application: { from: today(), to: today() }, noticePeriodDays: 2, expectedStatus: 400 });
  assert.match(state.created.error, /at least 2 days advance notice/);
});

test('applying directly for a standard type still enforces that type’s notice period', async () => {
  const state = await setup({ application: { typeCode: 'CL', from: today(), to: today() }, expectedStatus: 400 });
  assert.match(state.created.error, /at least 30 days advance notice/);
});
