import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import * as scheduleHelpers from '../src/lib/shift-schedule.js';

async function loadModule(path, mocks, globals = {}) {
  const context = vm.createContext({ console, Date, Map, Set, ...globals });
  const modules = new Map();
  const dependency = async specifier => {
    if (!modules.has(specifier)) {
      const exports = mocks[specifier];
      assert.ok(exports, `Unexpected dependency: ${specifier}`);
      const module = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
      modules.set(specifier, module);
      await module.link(dependency);
      await module.evaluate();
    }
    return modules.get(specifier);
  };
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    context, importModuleDynamically: dependency,
  });
  await module.link(dependency);
  await module.evaluate();
  return module.namespace;
}

test('monthly shift resolution preserves legacy results with two batched queries', async () => {
  const users = Array.from({ length: 50 }, (_, i) => ({ _id: `u${i}`, shiftId: 'current', shift: 'Current' }));
  const shifts = [
    { _id: 'current', name: 'Current', startTime: '09:00' },
    { _id: 'old', name: 'Old', startTime: '08:00' },
  ];
  const changes = users.map(user => ({
    userIds: [user._id], status: 'applied', effectiveDate: '2026-10-15', appliedAt: 1, createdAt: 1,
    targetShiftId: 'current', fromShiftId: 'old',
    userAssignments: [{ userId: user._id, targetShiftId: 'current', fromShiftId: 'old',
      targetShiftSnapshot: { startTime: '10:00', endTime: '18:00' },
      fromShiftSnapshot: { startTime: '07:00', endTime: '15:00' } }],
  }));
  // Same-day tie: latest applied change wins; before both changes, earliest wins.
  changes.push({ userIds: ['u0'], status: 'applied', effectiveDate: '2026-10-15', appliedAt: 2, createdAt: 2,
    targetShiftId: 'old', fromShiftId: 'current' });
  let queries = 0;
  const query = rows => ({
    sort(order) {
      rows = [...rows].sort((a, b) => {
        for (const [key, direction] of Object.entries(order)) {
          if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * direction;
        }
        return 0;
      });
      return this;
    },
    lean: async () => rows,
  });
  const Shift = {
    find: () => { queries++; return query(shifts); },
    findById: id => { queries++; return query(shifts.find(s => s._id === id) || null); },
    findOne: ({ name }) => { queries++; return query(shifts.find(s => s.name === name) || null); },
  };
  const matching = filter => changes.filter(change => {
    const matchesUser = filter.userIds?.$in
      ? change.userIds.some(id => filter.userIds.$in.includes(id)) : change.userIds.includes(filter.userIds);
    return matchesUser && (!filter.effectiveDate || (filter.effectiveDate.$lte
      ? change.effectiveDate <= filter.effectiveDate.$lte : change.effectiveDate > filter.effectiveDate.$gt));
  });
  const ShiftChange = {
    find: filter => { queries++; return query(matching(filter)); },
    findOne: filter => {
      queries++;
      const result = query(matching(filter));
      const sorted = result.sort.bind(result);
      result.sort = order => { sorted(order); return { lean: async () => (await result.lean())[0] || null }; };
      return result;
    },
  };
  const module = await loadModule('../src/lib/shift-utils.js', {
    mongoose: { default: { Types: { ObjectId: { isValid: () => true } } } },
    './models/index': { Shift, ShiftChange },
    './models/ShiftDayOverride': { default: {
      find: () => ({ session() { return this; }, lean: async () => [] }),
      findOne: () => ({ lean: async () => null }),
    } },
    './shift-schedule': scheduleHelpers,
    './timezone': { getTzTime: async () => new Date(2026, 9, 30), formatDateStr: () => '2026-10-30' },
  });
  const resolver = await module.createAttendanceShiftResolver(users);
  const results = [];
  for (const user of users) {
    assert.equal(resolver.current(user), shifts[0]);
    for (let day = 1; day <= 31; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      results.push([user, date, resolver.forDate(user, date)]);
    }
  }
  assert.equal(queries, 2, '50 employees × 31 dates must use only two database queries');
  for (const [user, date, actual] of results) {
    const expected = await module.resolveShiftForDate(user, date, { fallbackToCurrent: false });
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${user._id} on ${date}`);
  }
  assert.equal(resolver.forDate({ _id: 'unknown' }, '2026-10-01'), null);
  assert.equal(resolver.current({ shift: 'Old' }), shifts[1]);
});

test('concurrent database failures share one attempt and allow a later retry', async () => {
  const cache = { conn: null, promise: null };
  let attempts = 0;
  let rejectConnection;
  const mongoose = {
    connect: () => {
      attempts++;
      return new Promise((resolve, reject) => { rejectConnection = reject; });
    },
  };
  const module = await loadModule('../src/lib/db.js', {
    mongoose: { default: mongoose },
    'node:dns': { setServers() {} },
    './runtime-config': { assertProductionConfiguration() {} },
  }, { global: { _mongoose: cache }, process: { env: { MONGODB_URI: 'mock://test' } } });
  const requests = Array.from({ length: 20 }, () => module.default());
  const failure = new Error('unavailable');
  rejectConnection(failure);
  assert.ok((await Promise.allSettled(requests)).every(result => result.status === 'rejected' && result.reason === failure));
  assert.equal(attempts, 1);
  await assert.rejects(module.default(), /unavailable/);
  assert.equal(attempts, 1, 'cooldown prevents a reconnect storm');
  cache.retryAfter = 0;
  mongoose.connect = async () => { attempts++; return { connection: { readyState: 1 } }; };
  const connection = await module.default();
  assert.equal(connection.connection.readyState, 1);
  assert.equal(attempts, 2);
  assert.equal(await module.default(), connection);
  assert.equal(attempts, 2);
});

test('parallel expired reads share one refresh and retain impersonation on retry', async () => {
  let refreshes = 0;
  let releaseRefresh;
  const seen = new Set();
  const module = await loadModule('../src/lib/api.js', {}, {
    FormData, AbortSignal,
    window: { __impersonatedUser: { _id: 'employee' } },
    fetch: async (url, options) => {
      if (url === '/api/auth/refresh') {
        refreshes++;
        await new Promise(resolve => { releaseRefresh = resolve; });
        return { ok: true, json: async () => ({}) };
      }
      assert.equal(options.headers['X-Impersonate'], 'employee');
      assert.ok(options.signal, 'page reads have a deadline');
      if (!seen.has(url)) { seen.add(url); return { status: 401 }; }
      return { ok: true, status: 200, json: async () => ({ data: url }) };
    },
  });
  const first = module.api.get('/one');
  const second = module.api.get('/two');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 1);
  releaseRefresh();
  assert.deepEqual(await Promise.all([first, second]), ['/one', '/two']);
});

test('exports can opt out of read deadlines and writes are not aborted', async () => {
  const module = await loadModule('../src/lib/api.js', {}, {
    FormData, AbortSignal,
    fetch: async (url, options) => {
      assert.equal(options.signal, undefined);
      assert.equal('timeoutMs' in options, false);
      return { ok: true, status: 200, json: async () => ({ data: 'ok' }) };
    },
  });
  assert.equal(await module.api.get('/export', { timeoutMs: 0 }), 'ok');
  assert.equal(await module.api.post('/save', { value: 1 }), 'ok');
});
