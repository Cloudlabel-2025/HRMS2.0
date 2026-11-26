// Run: node --experimental-vm-modules --test scripts/attendance-device-time.test.mjs
// Real clock handler, timestamp validation, timezone conversion, and hours/status
// calculations with an isolated in-memory attendance store. Never connects to DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
register(new URL('./hrms-loader.mjs', import.meta.url));
const validation = await import('../src/lib/validation.js');
const constants = await import('../src/lib/attendance-constants.js');
const resolver = await import('../src/lib/attendance-resolver.js');
const breaks = await import('../src/lib/attendance-breaks.js');
const permissionHours = await import('../src/lib/permission-hours.js');
const { getAttendanceDate } = await import('../src/lib/attendance-date.js');

async function session({ startTime = '10:00', endTime = '19:00' } = {}) {
  // Deliberately different server DATE and time; a five-minute tolerance
  // or fallback to server time would fail the stored-time/date assertions.
  class ServerClock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-24T00:00:00Z'])); }
    static now() { return new Date('2026-11-24T00:00:00Z').getTime(); }
  }
  const context = vm.createContext({ Date: ServerClock, console });
  const user = { _id: 'shakil', name: 'Mohamed Shakil', role: 'employee', shift: 'Morning Shift' };
  const shift = { _id: 'shift', name: 'Morning Shift', startTime, endTime };
  let record = null;
  let writes = 0;
  const attendance = {
    findOne: filter => {
      const found = record && (!filter.date || filter.date === record.date) && (!filter.clockOut || !record.clockOut) ? record : null;
      return { then: resolve => resolve(found), sort: async () => found };
    },
    find: () => ({ sort: async () => record && !record.clockOut ? [record] : [] }),
    findOneAndUpdate: async (filter, update) => {
      writes++;
      record = update.$set
        ? { _id: 'record', ...filter, ...update.$setOnInsert, ...update.$set }
        : { ...record, ...update };
      return record;
    },
  };
  const adapters = {
    '@/lib/db': { connectDB: async () => {} },
    '@/lib/models/Attendance': { default: attendance },
    '@/lib/models/User': { default: {} },
    '@/lib/models/index': {
      Leave: { findOne: async () => null }, Holiday: { find: () => ({ lean: async () => [] }) },
      SelfServiceRequest: { find: async () => [] },
      SystemConfig: { findOne: () => ({ lean: async () => ({ value: { timezone: 'Asia/Kolkata' } }) }) },
    },
    '@/lib/middleware': { requireAuth: async () => ({ user }), auditLog: async () => {} },
    '@/lib/jwt': { ok: data => ({ status: 200, data }), fail: (error, status = 400) => ({ status, error }) },
    '@/lib/validation': validation,
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({}), parseShiftStartTime: () => startTime, isWorkingDay: () => true },
    '@/lib/attendance-date': { getAttendanceDate },
    '@/lib/attendance-utils': { checkAndApplyAutoLogout: () => { throw new Error('Unexpected auto logout'); }, finalizeDayWork: rows => rows },
    '@/lib/shift-utils': {
      resolveShiftAtTime: async (_user, now) => ({ shift, date: getAttendanceDate(now, startTime, endTime) }),
      resolveRecordShift: async () => shift,
      getShiftEndMinutes: () => { const [h, m] = endTime.split(':').map(Number); return h * 60 + m; },
    },
    '@/lib/shift-assign': { applyDueShiftChangesForUser: async () => 0 },
    '@/lib/shift-schedule': { snapshotShift: value => value },
    '@/lib/attendance-constants': constants,
    '@/lib/attendance-resolver': resolver,
    '@/lib/permission-hours': permissionHours,
    '@/lib/leave-cover': { isFullDayLeaveCovered: async () => false },
    '@/lib/permission-allowance': { computePermissionUsage: () => { throw new Error('Unexpected permission'); }, permissionCoversShiftStart: () => false },
    '@/lib/permission-work': { reconcilePermissionWorkProgress: () => false, closePermissionEarly: () => { throw new Error('Unexpected permission'); } },
    '@/lib/attendance-breaks': breaks,
    '@/lib/permissions': { isEmployer: () => false },
    '@/lib/notify': { notify: async () => {} },
    '@/lib/sse': { publishAttendance: () => {} },
  };
  async function load(specifier) {
    const exports = adapters[specifier];
    let module;
    if (exports) {
      module = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, { context });
    } else {
      assert.equal(specifier, '@/lib/timezone');
      module = new vm.SourceTextModule(await readFile(new URL('../src/lib/timezone.js', import.meta.url), 'utf8'), { context });
    }
    await module.link(load);
    await module.evaluate();
    return module;
  }
  const route = new vm.SourceTextModule(await readFile(new URL('../src/app/api/attendance/clock/route.js', import.meta.url), 'utf8'), {
    context, importModuleDynamically: load,
  });
  await route.link(load);
  await route.evaluate();
  return {
    clock: (action, clientTime) => route.namespace.POST(new Request('https://hrms.example/api/attendance/clock', {
      method: 'POST', body: JSON.stringify({ action, clientTime }),
    })),
    get writes() { return writes; },
  };
}

test('clock-in and clock-out persist device time even days away from server clock', async () => {
  const app = await session();
  const clockIn = await app.clock('in', '2026-11-26T10:00:00+05:30');
  assert.equal(clockIn.status, 200, clockIn.error);
  assert.equal(clockIn.data.record.clockIn, '10:00');
  assert.equal(clockIn.data.record.date, '2026-11-26');
  assert.equal(clockIn.data.record.workProgress[0].startTime, '10:00');
  assert.equal(clockIn.data.record.status, 'present');
  const clockOut = await app.clock('out', '2026-11-26T19:00:00+05:30');
  assert.equal(clockOut.status, 200, clockOut.error);
  assert.equal(clockOut.data.record.clockOut, '19:00');
  assert.equal(app.writes, 2);
});

test('overnight clock-out uses device time and retains shift start date', async () => {
  const app = await session({ startTime: '22:00', endTime: '06:00' });
  assert.equal((await app.clock('in', '2026-11-26T22:00:00+05:30')).status, 200);
  const clockOut = await app.clock('out', '2026-11-27T05:30:00+05:30');
  assert.equal(clockOut.status, 200, clockOut.error);
  assert.equal(clockOut.data.record.clockOut, '05:30');
  assert.equal(clockOut.data.record.date, '2026-11-26');
});

test('invalid or missing device time cannot write attendance', async () => {
  const app = await session();
  for (const time of [undefined, null, '', 'bad-time']) {
    assert.equal((await app.clock('in', time)).status, 400);
    assert.equal((await app.clock('out', time)).status, 400);
  }
  assert.equal(app.writes, 0);
});
