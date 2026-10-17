import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as linkedTypes from '../src/lib/leave/linked-types.js';

const source = await readFile(new URL('../src/app/api/admin/control-center/policies/route.js', import.meta.url), 'utf8');
const policyId = '507f1f77bcf86cd799439011';

// Run the real route handlers with isolated auth/database adapters; never touch live HR data.
async function setup({ authorized = true, policies = [], hasHistory = true } = {}) {
  const calls = { writes: [], audits: [] };
  const context = vm.createContext({});
  const model = {
    find: () => ({ sort: async () => policies }),
    exists: async () => hasHistory,
    create: async data => { calls.writes.push(data); return data; },
    findById: async () => policies[0] || null,
    findOneAndUpdate: async (filter, update) => {
      calls.writes.push({ filter, update });
      return policies.find(policy => policy._id === filter._id && policy.status === filter.status) || null;
    },
  };
  const adapters = {
    '@/lib/db': { default: async () => {} },
    '@/lib/models/LeavePolicy': { default: model },
    '@/lib/models/User': { default: { find: () => ({ select: () => ({ sort: () => ({ lean: async () => [] }) }) }) } },
    '@/lib/middleware': {
      requireAuth: async () => ({ user: { _id: 'dev-admin', email: authorized ? 'dev@example.com' : 'employee@example.com' } }),
      auditLog: async (...args) => { calls.audits.push(args); },
    },
    '@/lib/permissions': { isDevAdminEmail: email => email === 'dev@example.com' },
    '@/lib/jwt': { ok: (data, status = 200) => ({ data, status }), fail: (error, status) => ({ error, status }) },
    mongoose: { default: { isValidObjectId: id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) } },
    '@/lib/leave/linked-types': linkedTypes,
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
  return { route: route.namespace, calls };
}

const request = body => ({ json: async () => body, headers: { get: () => '' } });
function policy(configs = []) {
  return {
    _id: policyId, name: 'Test policy', status: 'active', isDefault: true,
    version: 1, leaveTypeConfigs: configs,
    toObject() { return { _id: this._id, status: this.status, leaveTypeConfigs: this.leaveTypeConfigs }; },
    async save() {},
  };
}

test('policy deletion requires Dev Admin access', async () => {
  const { route, calls } = await setup({ authorized: false });
  assert.equal((await route.DELETE(request({ policyId }))).status, 403);
  assert.equal(calls.writes.length, 0);
});

test('deletion validates policy IDs and reports missing policies', async () => {
  const { route, calls } = await setup();
  assert.equal((await route.DELETE(request({ policyId: 'invalid' }))).status, 400);
  assert.equal(calls.writes.length, 0);
  assert.equal((await route.DELETE(request({ policyId }))).status, 404);
});

test('deleting a default policy archives it and clears its draft without deleting history', async () => {
  const { route, calls } = await setup({ policies: [policy()] });
  const result = await route.DELETE(request({ policyId }));
  assert.equal(result.status, 200);
  assert.equal(result.data.deleted, true);
  assert.equal(calls.writes[0].filter.status, 'active');
  assert.equal(calls.writes[0].update.$set.status, 'archived');
  assert.equal(calls.writes[0].update.$set.isDefault, false);
  assert.equal(calls.writes[0].update.$set.draftConfig, null);
  assert.equal(calls.audits.length, 1);
});

test('loading policies does not restore removed standard leave types', async () => {
  const custom = [{ code: 'STUDY', name: 'Study Leave' }];
  const { route, calls } = await setup({ policies: [policy(custom)] });
  const result = await route.GET(request());
  assert.equal(result.data.policies[0].leaveTypeConfigs.length, 1);
  assert.equal(result.data.policies[0].leaveTypeConfigs[0].code, 'STUDY');
  assert.equal(calls.writes.length, 0);
});

test('loading after the last policy is deleted does not recreate it', async () => {
  const { route, calls } = await setup({ policies: [], hasHistory: true });
  const result = await route.GET(request());
  assert.equal(result.data.policies.length, 0);
  assert.equal(calls.writes.length, 0);
});

test('drafting and publishing support custom types and removal of all types', async () => {
  const live = policy([{ code: 'CL', name: 'Casual Leave' }]);
  const { route } = await setup({ policies: [live] });
  const custom = [{ code: ' study ', name: ' Study Leave ', color: '#15803d', icon: 'bi-gift' }];
  assert.equal((await route.PUT(request({ policyId, action: 'save_draft', leaveTypeConfigs: custom }))).status, 200);
  assert.equal(live.leaveTypeConfigs[0].code, 'CL');
  assert.equal(live.draftConfig.leaveTypeConfigs[0].code, 'STUDY');
  assert.equal((await route.PUT(request({ policyId, leaveTypeConfigs: custom }))).status, 200);
  assert.equal(live.leaveTypeConfigs[0].code, 'STUDY');
  assert.equal(live.leaveTypeConfigs[0].icon, 'bi-gift');
  assert.equal(live.draftConfig, null);
  assert.equal((await route.PUT(request({ policyId, leaveTypeConfigs: [] }))).status, 200);
  assert.equal(live.leaveTypeConfigs.length, 0);
});

test('invalid and duplicate type codes are rejected for drafts, publishing, and creation', async () => {
  const { route } = await setup({ policies: [policy()] });
  for (const configs of [null, [{}], [{ code: 'CL', name: 'Casual' }, { code: ' cl ', name: 'Duplicate' }]]) {
    for (const action of ['publish', 'save_draft']) {
      assert.equal((await route.PUT(request({ policyId, action, leaveTypeConfigs: configs }))).status, 400);
    }
    assert.equal((await route.POST(request({ name: 'New policy', leaveTypeConfigs: configs }))).status, 400);
  }
});

test('archived policies cannot be republished', async () => {
  const archived = { ...policy(), status: 'archived' };
  const { route } = await setup({ policies: [archived] });
  assert.equal((await route.PUT(request({ policyId, leaveTypeConfigs: [] }))).status, 404);
});

test('quarterly entitlement persists in drafts and published policies', async () => {
  const live = policy([{ code: 'SL', name: 'Sick Leave', annualAllocation: 10 }]);
  const { route } = await setup({ policies: [live] });
  const configs = [{ code: 'SL', name: 'Sick Leave', annualAllocation: 6, creditSchedule: 'quarterly', accrualMode: 'quarterly' }];
  assert.equal((await route.PUT(request({ policyId, action: 'save_draft', leaveTypeConfigs: configs }))).status, 200);
  assert.equal(live.leaveTypeConfigs[0].annualAllocation, 10);
  assert.equal(live.draftConfig.leaveTypeConfigs[0].creditSchedule, 'quarterly');
  assert.equal((await route.PUT(request({ policyId, leaveTypeConfigs: configs }))).status, 200);
  assert.equal(live.leaveTypeConfigs[0].annualAllocation, 6);
  assert.equal(live.leaveTypeConfigs[0].creditSchedule, 'quarterly');
});

test('invalid entitlement and frequency are rejected before saving drafts', async () => {
  const { route } = await setup({ policies: [policy()] });
  for (const values of [{ annualAllocation: -1 }, { annualAllocation: '' }, { annualAllocation: Infinity }, { creditSchedule: 'weekly' }]) {
    const configs = [{ code: 'SL', name: 'Sick Leave', ...values }];
    assert.equal((await route.PUT(request({ policyId, action: 'save_draft', leaveTypeConfigs: configs }))).status, 400);
  }
});

test('linked leave sources persist and broken links are rejected when saving policies', async () => {
  const live = policy();
  const { route } = await setup({ policies: [live] });
  const configs = [
    { code: 'CL', name: 'Casual Leave', enabled: true },
    { code: 'EM', name: 'Emergency Leave', balanceMode: 'linked', linkedLeaveTypes: ['CL'] },
  ];
  assert.equal((await route.PUT(request({ policyId, leaveTypeConfigs: configs }))).status, 200);
  assert.equal(live.leaveTypeConfigs[1].linkedLeaveTypes[0], 'CL');
  assert.equal((await route.PUT(request({ policyId, leaveTypeConfigs: [configs[1]] }))).status, 400);
});
