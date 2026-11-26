// node --experimental-vm-modules --test scripts/employment-start.test.mjs
// Exercises real absence, calendar-sync and payroll-start logic without a DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
register(new URL('./hrms-loader.mjs', import.meta.url));
const start = await import('../src/lib/employment-start.js');
const absence = await import('../src/lib/absence-status.js');
const constants = await import('../src/lib/attendance-constants.js');
const stats = await import('../src/lib/attendance-stats.js');
const schedule = await import('../src/lib/shift-schedule.js');
const periods = await import('../src/lib/payroll-periods.js');
const mongoose = await import('mongoose');

const uid = '6b07c779b678b2dc56848fef';
const query = data => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, lean: async () => data });
async function fixture({ joinDate = '2026-11-26', createdAt = '2026-11-01', employeeRow = true } = {}) {
  const user = { _id: uid, name: 'Mohamed Shakil', role: 'employee', status: 'active', joinDate, createdAt, shift: 'Morning Shift' };
  const phantom = { _id: 'old', userId: uid, date: '2026-11-20', status: 'absent', clockIn: null };
  const ops = [];
  const noRows = { find: () => query([]), aggregate: async () => [] };
  const users = { find: () => query([user]), findById: () => query(user) };
  const models = {
    Employee: { find: () => query(employeeRow ? [{ ...user, userId: user }] : []) },
    Absence: { find: () => query([{ ...phantom }]) },
    Leave: noRows, Holiday: noRows, ShiftChange: noRows, SelfServiceRequest: noRows,
    Shift: { find: () => query([{ name: 'Morning Shift', startTime: '10:00', endTime: '19:00' }]) },
  };
  const attendance = {
    find: () => query([{ ...phantom }]), aggregate: async () => [{ _id: uid, first: '2026-11-02' }],
    bulkWrite: async writes => { ops.push(...writes); },
  };
  const context = vm.createContext({ console, URL });
  const adapters = {
    '@/lib/db': { connectDB: async () => {} },
    '@/lib/models/index': models,
    '@/lib/models/User': { default: users },
    '@/lib/models/Attendance': { default: attendance },
    '@/lib/middleware': { requireAuth: async () => ({ user }) },
    '@/lib/jwt': { ok: data => ({ status: 200, data }), fail: (error, status = 400) => ({ status, error }) },
    '@/lib/rbac': { getDepartmentUserIds: async () => [uid], getAccessibleDepartments: async () => null },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({}), isWorkingDay: () => true },
    '@/lib/timezone': { getTzTime: async () => new Date(2026, 10, 26, 14, 0) },
    '@/lib/shift-utils': { loadDayOverrides: async () => new Map() },
    '@/lib/employment-start': start,
    '@/lib/absence-status': absence,
    '@/lib/attendance-constants': constants,
    '@/lib/attendance-stats': stats,
    '@/lib/shift-schedule': schedule,
    '@/lib/payroll-periods': periods,
    mongoose,
  };
  async function moduleFor(file) {
    const module = new vm.SourceTextModule(await readFile(new URL('../' + file, import.meta.url), 'utf8'), { context });
    await module.link(specifier => {
      const key = specifier.startsWith('.') ? '@/lib/' + specifier.slice(2) : specifier;
      const exports = adapters[key];
      assert.ok(exports, `Unexpected dependency ${specifier}`);
      return new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
    });
    await module.evaluate();
    return module.namespace;
  }
  return { moduleFor, ops };
}

test('joining date wins over earlier creation and activity; legacy dates remain available', () => {
  assert.equal(start.employmentStartDay({ joinDate: '2026-11-26', createdAt: '2026-11-01' }, ['2026-10-01']), '2026-11-26');
  assert.equal(start.employmentStartDay({ joinDate: new Date('2026-11-26T00:00:00Z') }), '2026-11-26');
  assert.equal(start.employmentStartDay({ createdAt: '2026-11-01' }, ['2026-10-01']), '2026-10-01');
  assert.equal(start.employmentStartDay({ joinDate: 'invalid', createdAt: '2026-11-01' }), '2026-11-01');
  assert.equal(start.employmentStartDay({}), null);
  assert.equal(start.isBeforeEmployment('2026-11-25', { joinDate: '2026-11-26' }), true);
  assert.equal(start.isBeforeEmployment('2026-11-26', { joinDate: '2026-11-26' }), false);
});

for (const employeeRow of [true, false]) {
  test(`absence report omits derived and legacy pre-joining absences (${employeeRow ? 'Employee roster' : 'User fallback'})`, async () => {
    const fixtureData = await fixture({ employeeRow });
    const route = await fixtureData.moduleFor('src/app/api/absence/route.js');
    const response = await route.GET(new Request('https://hrms.example/api/absence?month=2026-11'));
    assert.equal(response.status, 200, response.error);
    assert.deepEqual(Array.from(response.data.absences, r => r.date), ['2026-11-26']);
    assert.equal(response.data.summary.totalAbsences, 1);
    assert.equal(response.data.absences[0].pattern, 1);
  });
}

test('future joiners have no absences; historical joiners retain legitimate earlier absences', async () => {
  for (const [joinDate, createdAt, count] of [['2026-11-27', '2026-11-01', 0], ['2026-11-01', '2026-11-26', 26]]) {
    const data = await fixture({ joinDate, createdAt });
    const route = await data.moduleFor('src/app/api/absence/route.js');
    const result = await route.GET(new Request('https://hrms.example/api/absence?month=2026-11'));
    assert.equal(result.status, 200, result.error);
    assert.equal(result.data.summary.totalAbsences, count);
  }
});

test('calendar backfill never creates pre-joining rows; payroll uses the same boundary', async () => {
  const data = await fixture();
  const sync = await data.moduleFor('src/lib/attendance-sync.js');
  await sync.syncCalendarRowsForUsers({ userIds: [uid], fromDate: '2026-11-01', toDate: '2026-11-26', todayStr: '2026-11-26', allowTodayAbsent: true });
  assert.deepEqual(data.ops.map(op => op.updateOne.filter.date), ['2026-11-26']);
  const payroll = await data.moduleFor('src/lib/payroll-lop-utils.js');
  assert.equal(await payroll.getEmploymentStartDate(uid), '2026-11-26');
});
