// Run: node --experimental-vm-modules --test scripts/login-joining-day.test.mjs
// Real login handler and timezone helper; isolated database and token adapters.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { register } from 'node:module';
register(new URL('./hrms-loader.mjs', import.meta.url));
const { LoginSchema, ClockInOutSchema, validateRequest } = await import('../src/lib/validation.js');
const { evaluateHalfDayGate, resolveHalfDaySplitMins } = await import('../src/lib/half-day-window.js');

async function loginAt(instant, { serverInstant = '2026-11-26T00:00:00Z', clientTime = instant, joinDate = '2026-11-26', status = 'active', passwordValid = true, locked = false, leave = null } = {}) {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [serverInstant])); }
    static now() { return new Date(serverInstant).getTime(); }
  }
  const context = vm.createContext({ Date: Clock, console });
  const calls = { resets: 0, refreshes: 0 };
  const user = {
    _id: 'employee', name: 'Mohamed Shakil', email: 'shakilibm05@gmail.com', role: 'employee',
    status, joinDate: new Date(`${joinDate}T00:00:00Z`), shift: 'Morning Shift',
    isFirstLogin: true, loginAttempts: 0,
    isLocked: () => locked, lockUntil: new Date(Clock.now() + 60000),
    comparePassword: async () => passwordValid,
    incrementLoginAttempts: async () => { user.loginAttempts++; },
    resetLoginAttempts: async () => { calls.resets++; },
  };
  const basicModel = { findOne: async () => null, create: async () => {}, updateOne: async () => {},
    findOneAndUpdate: async () => {}, deleteOne: async () => {} };
  const adapters = {
    '@/lib/db': { default: async () => {} },
    '@/lib/models/User': { default: { findOne: () => ({ select: async () => user }), findByIdAndUpdate: async () => {} } },
    '@/lib/models/EmploymentProfile': { default: basicModel },
    '@/lib/models/Attendance': { default: { findOne: () => ({ sort: () => ({ lean: async () => null }) }) } },
    '@/lib/models/AuditLog': { default: basicModel },
    '@/lib/models/Shift': { default: basicModel },
    '@/lib/models/Leave': { default: { findOne: async () => leave } },
    '@/lib/models/Department': { default: basicModel },
    '@/lib/models/RateLimit': { default: basicModel },
    '@/lib/models/RefreshToken': { default: { create: async () => { calls.refreshes++; } } },
    '@/lib/account-environment': { isAccountAllowedInEnvironment: () => true },
    '@/lib/validation': { LoginSchema, validateRequest },
    '@/lib/payroll-cycle': { parseShiftStartTime: () => '10:00' },
    '@/lib/shift-utils': { resolveShiftForDate: async (_user, date) => {
      assert.equal(date, instant.slice(0, 10), 'Shift lookup must use the device date');
      return { startTime: '10:00' };
    } },
    '@/lib/half-day-window': { resolveHalfDaySplitMins, evaluateHalfDayGate },
    '@/lib/jwt': { signToken: () => 'access', signRefreshToken: () => 'refresh',
      fail: (error, status = 400) => ({ error, status }), SESSION_COOKIE_OPTIONS: {} },
    'next/server': { NextResponse: { json: body => ({ body, status: 200, cookies: { set() {} } }) } },
    crypto: { randomUUID: () => 'jti' },
    '@/lib/models/index': { SystemConfig: { findOne: () => ({ lean: async () => ({ value: { timezone: 'Asia/Kolkata' } }) }) } },
  };
  async function load(specifier) {
    const values = adapters[specifier];
    let module;
    if (values) {
      module = new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    } else {
      assert.equal(specifier, '@/lib/timezone');
      module = new vm.SourceTextModule(await readFile(new URL('../src/lib/timezone.js', import.meta.url), 'utf8'), { context });
    }
    await module.link(load);
    await module.evaluate();
    return module;
  }
  const route = new vm.SourceTextModule(await readFile(new URL('../src/app/api/auth/login/route.js', import.meta.url), 'utf8'), {
    context, importModuleDynamically: load,
  });
  await route.link(load);
  await route.evaluate();
  const response = await route.namespace.POST(new Request('https://hrms.example/api/auth/login', {
    method: 'POST', body: JSON.stringify({ email: user.email, password: 'temporary-password', clientTime }),
  }));
  return { response, calls };
}

test('Shakil: device 08:29 IST is blocked; 08:30 and 11:27 are allowed while server is 05:30 IST', async () => {
  const early = await loginAt('2026-11-26T02:59:00Z');
  assert.equal(early.response.status, 403);
  assert.match(early.response.error, /log in from 08:30/);
  assert.equal(early.calls.refreshes, 0);
  for (const instant of ['2026-11-26T03:00:00Z', '2026-11-26T05:57:58Z']) {
    const { response, calls } = await loginAt(instant);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.isFirstLogin, true);
    assert.equal(calls.resets, 1);
    assert.equal(calls.refreshes, 1);
  }
});

test('a later server clock cannot open access before device 08:30', async () => {
  const { response } = await loginAt('2026-11-26T02:59:00Z', { serverInstant: '2026-11-26T12:00:00Z' });
  assert.equal(response.status, 403);
  assert.match(response.error, /log in from 08:30/);
});

test('login and attendance reject missing or invalid device timestamps instead of using server time', async () => {
  for (const clientTime of [undefined, null, '', 'invalid', '2026-11-26T08:30:00']) {
    assert.equal(ClockInOutSchema.safeParse({ action: 'in', clientTime }).success, false);
    assert.equal(ClockInOutSchema.safeParse({ action: 'out', clientTime }).success, false);
    const { response, calls } = await loginAt('2026-11-26T03:00:00Z', { clientTime: clientTime ?? null });
    assert.equal(response.status, 400);
    assert.equal(calls.refreshes, 0);
  }
});

test('login half-day leave gate uses device time', async () => {
  const leave = { halfDay: true, halfDayType: 'first_half', halfDayEndTime: '13:00' };
  assert.equal((await loginAt('2026-11-26T07:29:00Z', { leave })).response.status, 403);
  assert.equal((await loginAt('2026-11-26T07:30:00Z', { leave })).response.status, 200);
});

test('future hires remain blocked; existing employees have no joining-day cutoff', async () => {
  assert.match((await loginAt('2026-11-26T05:57:58Z', { joinDate: '2026-11-27' })).response.error, /not yet active/);
  assert.equal((await loginAt('2026-11-26T02:00:00Z', { joinDate: '2026-11-25' })).response.status, 200);
});

test('inactive, locked, incorrect-password, and approved-leave restrictions remain enforced', async () => {
  for (const [options, expected] of [[{ status: 'inactive' }, 403], [{ locked: true }, 423], [{ passwordValid: false }, 401], [{ leave: {} }, 403]]) {
    const { response, calls } = await loginAt('2026-11-26T05:57:58Z', options);
    assert.equal(response.status, expected);
    assert.equal(calls.refreshes, 0);
  }
});
