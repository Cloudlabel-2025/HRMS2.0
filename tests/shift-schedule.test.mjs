import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as helpers from '../src/lib/shift-schedule.js';
import { getShiftConfig, determineStatus, calculateHoursWorked } from '../src/lib/attendance-constants.js';
import * as constants from '../src/lib/attendance-constants.js';
import * as breakRules from '../src/lib/attendance-breaks.js';
import * as payrollPeriods from '../src/lib/payroll-periods.js';

async function correctionModule() {
  return load('../src/lib/shift-correction.js', { './attendance-constants': constants,
    './attendance-breaks': breakRules, './shift-schedule': helpers });
}

const normal = { _id: 'normal', name: 'Normal', startTime: '09:00', endTime: '18:00',
  expectedHours: 480, absentThreshold: 240, lateThreshold: 15, halfDayThreshold: 180, breaks: [] };
const night = { ...normal, _id: 'night', name: 'Night', startTime: '22:00', endTime: '06:00' };
const mini = { ...normal, _id: 'mini', name: 'Mini', startTime: '12:00', endTime: '16:00', expectedHours: 240, absentThreshold: 120, halfDayThreshold: 120 };

test('absence uses the scheduled date for overnight shifts and preserves leave', async () => {
  const { deriveAbsenceKind } = await load('../src/lib/absence-status.js', {
    './permission-allowance': { permissionCoversShiftStart: () => false },
    './attendance-date': { getAttendanceDate: () => '2026-11-10' },
    './attendance-stats': { hasImportedPresence: () => false },
  });
  const input = { date: '2026-11-10', shiftDoc: night, now: new Date(2026, 10, 10, 9) };
  assert.equal(deriveAbsenceKind(input).kind, 'not_arrived');
  assert.equal(deriveAbsenceKind({ ...input, now: new Date(2026, 10, 11, 0) }).kind, 'not_arrived');
  assert.equal(deriveAbsenceKind({ ...input, now: new Date(2026, 10, 11, 2) }).kind, 'absent');
  assert.equal(deriveAbsenceKind({ ...input, leave: { type: 'Annual' } }).kind, 'on_leave');
});

async function load(path, mocks) {
  const context = vm.createContext({ Date, Map, Set, console, URL, Promise });
  const modules = new Map();
  const link = async name => {
    if (!modules.has(name)) {
      assert.ok(mocks[name], `Unexpected import ${name}`);
      const module = new vm.SyntheticModule(Object.keys(mocks[name]), function () {
        for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
      }, { context });
      modules.set(name, module);
      await module.link(link); await module.evaluate();
    }
    return modules.get(name);
  };
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context, importModuleDynamically: link });
  await module.link(link); await module.evaluate();
  return module.namespace;
}

test('date validation rejects invalid dates and handles leap years', () => {
  assert.equal(helpers.validScheduleDate('2026-02-30'), false);
  assert.equal(helpers.validScheduleDate('2026-02-29'), false);
  assert.equal(helpers.validScheduleDate('2028-02-29'), true);
  assert.equal(helpers.adjacentDate('2026-12-31', 1), '2027-01-01');
});

test('overnight override retains its start date until its actual end, then normal schedule returns', () => {
  const beforeEnd = helpers.scheduleDayAt(new Date(2026, 10, 11, 5, 59), '2026-11-11', normal, night);
  assert.equal(beforeEnd.date, '2026-11-10');
  assert.equal(beforeEnd.shift, night);
  const afterEnd = helpers.scheduleDayAt(new Date(2026, 10, 11, 6, 0), '2026-11-11', normal, night);
  assert.equal(afterEnd.date, '2026-11-11');
  assert.equal(afterEnd.shift, normal);
  // A new night shift tonight must not invent an overnight shift yesterday.
  assert.equal(helpers.scheduleDayAt(new Date(2026, 10, 10, 1), '2026-11-10', night, normal).date, '2026-11-10');
});

test('overlap guards cover both neighbours and allow touching endpoints', () => {
  assert.equal(helpers.overlapsAdjacent({ ...normal, startTime: '05:00', endTime: '13:00' }, night, normal), true);
  assert.equal(helpers.overlapsAdjacent(night, normal, { ...normal, startTime: '05:00' }), true);
  assert.equal(helpers.overlapsAdjacent(night, normal, { ...normal, startTime: '06:00' }), false);
});

test('short-shift policy is validated, and full short-shift work receives correct credit', () => {
  assert.equal(helpers.overrideValidation(mini), null);
  assert.match(helpers.overrideValidation({ ...mini, expectedHours: 480 }), /fit/);
  assert.match(helpers.overrideValidation({ ...mini, halfDayThreshold: 300 }), /halfDayThreshold/);
  const config = getShiftConfig(mini, {});
  assert.equal(determineStatus(0, config).status, 'present');
  const hours = calculateHoursWorked(240, 0, config, { clockOut: '16:00', shiftEndMins: 960 });
  assert.equal(hours.payableHours, 240);
  assert.equal(hours.shortHours, false);
});

test('absence timing does not mark a late-night override absent before its threshold', () => {
  assert.equal(helpers.elapsedScheduleMinutes(new Date(2026, 10, 10, 10), '2026-11-10', '22:00'), -720);
  assert.equal(helpers.elapsedScheduleMinutes(new Date(2026, 10, 11, 0, 30), '2026-11-10', '22:00'), 150);
});

test('single and batched resolvers apply only the selected date, retain snapshots, and respect cancellation', async () => {
  const user = { _id: 'employee', shiftId: 'normal', shift: 'Normal' };
  let active = true;
  const override = { _id: 'override', userId: 'employee', date: '2026-11-10', shiftId: 'mini', revision: 1, snapshot: helpers.snapshotShift(mini) };
  let batchQueries = 0;
  const query = value => ({ sort() { return this; }, session() { return this; }, lean: async () => value });
  const module = await load('../src/lib/shift-utils.js', {
    mongoose: { default: { Types: { ObjectId: { isValid: () => true } } } },
    './models/index': {
      Shift: { find: () => { batchQueries++; return query([normal, mini]); }, findById: id => query(id === 'normal' ? normal : mini), findOne: () => query(normal) },
      ShiftChange: { find: () => { batchQueries++; return query([]); }, findOne: () => query(null) },
    },
    './models/ShiftDayOverride': { default: {
      findOne: filter => query(active && filter.date === override.date ? override : null),
      find: () => { batchQueries++; return query(active ? [override] : []); },
    } },
    './shift-schedule': helpers,
    './timezone': { getTzTime: async () => new Date(2026, 10, 10), formatDateStr: () => '2026-11-10' },
  });
  assert.equal((await module.resolveShiftForDate(user, '2026-11-10')).startTime, '12:00');
  assert.equal((await module.resolveShiftForDate(user, '2026-11-11')).startTime, '09:00');
  const batch = await module.createAttendanceShiftResolver([user]);
  assert.equal(batchQueries, 4); // one earlier legacy history read + three batch reads
  assert.equal(batch.forDate(user, '2026-11-10').expectedHours, 240);
  assert.equal(batch.forDate(user, '2026-11-11'), null); // caller falls back to current
  assert.equal(batch.current(user), normal);
  const record = { date: '2026-11-10', shiftId: 'mini', scheduleSnapshot: helpers.snapshotShift(mini) };
  mini.startTime = '13:00';
  assert.equal((await module.resolveRecordShift(user, record)).startTime, '12:00');
  assert.equal((await module.resolveShiftForDate(user, '2026-11-10')).startTime, '12:00');
  active = false;
  assert.equal((await module.resolveShiftForDate(user, '2026-11-10')).startTime, '09:00');
  mini.startTime = '12:00';
});

async function dayRouteFixture() {
  const userId = '111111111111111111111111';
  const shiftId = '222222222222222222222222';
  const state = { role: 'admin_full', existing: null, writes: 0, attendance: null,
    leave: null, permission: null, payroll: null, working: true };
  const employee = { _id: userId, status: 'active', identityId: 'identity', shiftId: normal._id };
  const query = value => ({ session() { return this; }, select() { return this; }, sort() { return this; },
    lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });
  const module = await load('../src/app/api/shifts/day/route.js', {
    mongoose: { default: {
      isValidObjectId: id => /^[a-f0-9]{24}$/.test(id || ''),
      Types: { ObjectId: function (id) { return { toString: () => id }; } },
      connection: { transaction: async fn => {
        const before = JSON.parse(JSON.stringify(state));
        try { return await fn({ transaction: true }); }
        catch (error) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, before); throw error; }
      } },
    } },
    'node:crypto': { createHash },
    '@/lib/middleware': { requireAuth: async () => ({ user: { _id: userId, role: state.role } }) },
    '@/lib/jwt': { ok: data => ({ status: 200, data }), fail: (error, status) => ({ status, error }) },
    '@/lib/models/User': { default: { findById: id => query({ ...employee, _id: id, name: `Employee ${id}`, status: state.blockedId === id ? 'inactive' : 'active' }), collection: { updateOne: async () => ({}) } } },
    '@/lib/models/Attendance': { default: { findOne: filter => query(['2026-11-10', '2026-10-20'].includes(filter.date) ? state.attendance : null),
      updateOne: async (filter, update) => { state.attendance = { ...state.attendance, ...update.$set }; return { matchedCount: 1 }; } } },
    '@/lib/models/Shift': { default: { findById: () => query({ ...mini, _id: shiftId }) } },
    '@/lib/models/ShiftDayOverride': { default: {
      init: async () => {},
      findOne: filter => query(filter.date === state.existing?.date ? state.existing : null),
      findOneAndUpdate: async (filter, update) => {
        state.writes++;
        state.existing = { ...filter, ...update.$set, _id: 'override', history: [...(state.existing?.history || []), update.$push.history] };
        return state.existing;
      },
    } },
    '@/lib/models/Leave': { default: { findOne: () => query(state.leave) } },
    '@/lib/models/index': { SelfServiceRequest: { exists: () => query(state.permission) }, Holiday: { find: () => query([]) },
      AttendanceRegularization: { exists: () => query(state.regularization) } },
    '@/lib/models/Payroll': { Payroll: { find: () => query(state.payroll ? [state.payroll] : []) } },
    '@/lib/payroll-run-engine': { runPayrollForMonth: async args => {
      if (state.payrollFailure) throw new Error('Payroll calculation failed');
      state.payrollRuns = [...(state.payrollRuns || []), args];
      return { processed: args.userIds.length, skipped: [] };
    } },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({ timezone: 'Asia/Kolkata' }), isWorkingDay: () => state.working },
    '@/lib/payroll-reopen': { affectedPayrollMonths: () => ['2026-11'] },
    '@/lib/timezone': { getTzDateStr: async () => '2026-10-30', getTzTime: async () => new Date(2026, 9, 30) },
    '@/lib/shift-utils': { resolveShiftForDate: async () => normal, resolveShiftAtTime: async () => ({ date: '2026-10-30', shift: normal }) },
    '@/lib/shift-schedule': helpers,
    '@/lib/shift-correction': await correctionModule(),
  });
  const post = body => module.POST({ json: async () => ({ userId, date: '2026-11-10', shiftId, ...body }) });
  return { state, post, module };
}

test('day-shift API denies employee writes and cross-employee reads', async () => {
  const { state, post, module } = await dayRouteFixture();
  state.role = 'employee';
  assert.equal((await post({ preview: true })).status, 403);
  assert.equal((await module.GET({ url: 'https://test/api/shifts/day?userId=333333333333333333333333&date=2026-11-10' })).status, 403);
  assert.equal(state.writes, 0);
});

test('day-shift API blocks attendance, leave, permissions and non-working days', async () => {
  const { state, post } = await dayRouteFixture();
  for (const field of ['attendance', 'leave', 'permission']) {
    state[field] = { _id: 'existing' };
    assert.equal((await post({ preview: true })).status, 409, field);
    state[field] = null;
  }
  state.working = false;
  assert.equal((await post({ preview: true })).status, 409);
  assert.equal((await post({ preview: true, date: '2026-10-30' })).status, 409);
  assert.equal((await post({ preview: true, date: '2026-02-30' })).status, 400);
  assert.equal(state.writes, 0);
});

test('day-shift save requires fresh preview, rejects duplicate submission, and audits cancellation', async () => {
  const { state, post } = await dayRouteFixture();
  const preview = await post({ preview: true });
  assert.equal(preview.status, 200);
  assert.equal(state.writes, 0);
  const body = { reason: 'Coverage required', revision: preview.data.revision, previewToken: preview.data.previewToken };
  assert.equal((await post({ ...body, previewToken: 'stale' })).status, 409);
  assert.equal((await post(body)).status, 200);
  assert.equal(state.existing.snapshot.startTime, '12:00');
  assert.equal(state.existing.revision, 1);
  assert.equal((await post(body)).status, 409);
  assert.equal(state.writes, 1);
  const cancellation = await post({ preview: true, action: 'cancel' });
  assert.equal(cancellation.data.schedule.startTime, '09:00');
  assert.equal((await post({ action: 'cancel', reason: 'Coverage no longer required', revision: cancellation.data.revision, previewToken: cancellation.data.previewToken })).status, 200);
  assert.equal(state.existing.status, 'cancelled');
  assert.equal(state.existing.history.length, 2);
  assert.equal(state.existing.history[1].action, 'cancel');
});

test('historical correction recalculates credit, late status and breaks without changing punches', async () => {
  const { correctedAttendance } = await correctionModule();
  const record = { clockIn: '12:00', clockOut: '16:00', status: 'late', breaks: [] };
  const result = correctedAttendance(record, mini, {});
  assert.equal(result.status, 'present');
  assert.equal(result.payableHours, 240);
  assert.equal(result.shortHours, false);
  assert.equal(result.clockIn, undefined);
  assert.equal(record.status, 'late');
  const midnight = correctedAttendance({ ...record, clockIn: '20:00', clockOut: '00:00' }, { ...mini, startTime: '20:00', endTime: '00:00' }, {});
  assert.equal(midnight.hoursWorked, 240);
  assert.equal(midnight.shortfallMins, 0);
  const leave = correctedAttendance(record, mini, {}, { status: 'approved' });
  assert.equal(leave.status, 'leave');
  assert.equal(leave.lateFlag, false);
  assert.equal(correctedAttendance(record, mini, {}, { halfDay: true }).status, 'half_day');
  assert.equal(correctedAttendance({ importedPresence: { source: 'bulk_upload' } }, mini, {}).status, 'present');
  assert.equal(correctedAttendance({}, mini, {}).status, 'absent');
  const excess = correctedAttendance({ ...record, breaks: [{ type: 'break', start: '13:00', end: '13:45', ruleIdx: 9 }] },
    { ...mini, breaks: [{ type: 'break', maxDuration: 15, maxCount: 1 }] }, {});
  assert.equal(excess.breakDeduction, 30);
  assert.equal(excess.payableHours, 210);
});

test('historical preview detects attendance changes and saves an audited recalculation', async () => {
  const { state, post } = await dayRouteFixture();
  const date = '2026-10-20';
  state.attendance = { _id: 'attendance', clockIn: '12:00', clockOut: '16:00', status: 'late', breaks: [] };
  const first = await post({ date, preview: true });
  assert.equal(first.status, 200);
  assert.equal(first.data.attendance.after.status, 'present');
  state.attendance.clockIn = '12:30';
  assert.equal((await post({ date, reason: 'Correct historical roster', ...first.data })).status, 409);
  const fresh = await post({ date, preview: true });
  const save = await post({ date, reason: 'Correct historical roster', revision: fresh.data.revision, previewToken: fresh.data.previewToken });
  assert.equal(save.status, 200);
  assert.equal(state.attendance.clockIn, '12:30');
  assert.equal(state.attendance.payableHours, 210);
  assert.equal(state.existing.history[0].attendanceBefore.clockIn, '12:30');
  assert.equal(state.existing.history[0].attendanceAfter.scheduleSnapshot.startTime, '12:00');
  const cancel = await post({ date, action: 'cancel', preview: true });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.attendance.after.scheduleSnapshot.startTime, '09:00');
});

test('historical edits block open records, permissions and pending corrections', async () => {
  const { state, post } = await dayRouteFixture();
  const body = { date: '2026-10-20', preview: true };
  state.attendance = { clockIn: '12:00' };
  assert.equal((await post(body)).status, 409);
  state.attendance = null;
  for (const field of ['permission', 'regularization']) {
    state[field] = { _id: 'existing' };
    assert.equal((await post(body)).status, 409);
    state[field] = null;
  }
  state.leave = { status: 'approved' };
  assert.equal((await post(body)).status, 200);
  state.leave.status = 'pending';
  assert.equal((await post(body)).status, 409);
});

test('bulk shift previews identify blocked employees and apply the validated group', async () => {
  const { state, post } = await dayRouteFixture();
  const userIds = ['111111111111111111111111', '333333333333333333333333'];
  state.blockedId = userIds[1];
  const blocked = await post({ userIds, preview: true });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.data.canApply, false);
  assert.equal(blocked.data.results[0].schedule.startTime, '12:00');
  assert.match(blocked.data.results[1].error, /Active employee/);
  assert.equal(state.writes, 0);
  state.blockedId = null;
  const preview = await post({ userIds, preview: true });
  assert.equal(preview.data.canApply, true);
  const result = await post({ userIds, previews: preview.data.results, reason: 'Shared coverage change' });
  assert.equal(result.status, 200);
  assert.equal(result.data.updated, 2);
  assert.deepEqual(Array.from(result.data.results, row => row.userId), userIds);
  assert.equal(state.writes, 2);
});

test('bulk shift rejects stale second preview before writing the first employee', async () => {
  const { state, post } = await dayRouteFixture();
  const userIds = ['111111111111111111111111', '333333333333333333333333'];
  const preview = await post({ userIds, preview: true });
  preview.data.results[1].previewToken = 'stale';
  assert.equal((await post({ userIds, previews: preview.data.results, reason: 'Shared coverage change' })).status, 409);
  assert.equal(state.writes, 0);
});

test('bulk shift validates selection, complete proofs and admin permissions', async () => {
  const { state, post } = await dayRouteFixture();
  const id = '111111111111111111111111';
  for (const userIds of [[], [id, id], ['bad-id'], 'bad', Array.from({ length: 51 }, (_, i) => String(i).padStart(24, '0'))]) {
    assert.equal((await post({ userIds, preview: true })).status, 400);
  }
  assert.equal((await post({ userIds: [id], previews: [], reason: 'Coverage change' })).status, 400);
  state.role = 'employee';
  assert.equal((await post({ userIds: [id], preview: true })).status, 403);
  assert.equal(state.writes, 0);
});

test('shift change reruns existing finalized payroll for the selected group in the same transaction', async () => {
  const { state, post } = await dayRouteFixture();
  const userIds = ['111111111111111111111111', '333333333333333333333333'];
  state.payroll = { _id: 'payroll', month: '2026-11', status: 'finalized', netPay: 20000 };
  const preview = await post({ userIds, preview: true });
  assert.equal(preview.data.canApply, true);
  assert.equal(preview.data.results[0].payrolls[0].status, 'finalized');
  const saved = await post({ userIds, previews: preview.data.results, reason: 'Correct mini shift' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.payrollsUpdated, 2);
  assert.equal(state.payrollRuns.length, 1);
  assert.deepEqual(Array.from(state.payrollRuns[0].userIds), userIds);
  assert.equal(state.payrollRuns[0].month, '2026-11');
  assert.equal(state.payrollRuns[0].force, true);
  assert.equal(state.payrollRuns[0].session.transaction, true);
  assert.equal(state.existing.history[0].payrollBefore[0].netPay, 20000);
});

test('payroll changes invalidate previews and payroll failure aborts shift save', async () => {
  const { state, post } = await dayRouteFixture();
  state.payroll = { _id: 'payroll', month: '2026-11', status: 'draft', netPay: 20000 };
  const preview = await post({ preview: true });
  state.payroll.netPay = 21000;
  assert.equal((await post({ ...preview.data, reason: 'Correct mini shift' })).status, 409);
  assert.equal(state.writes, 0);
  const fresh = await post({ preview: true });
  state.payrollFailure = true;
  assert.equal((await post({ ...fresh.data, reason: 'Correct mini shift' })).status, 500);
  assert.equal(state.writes, 0);
  assert.equal(state.existing, null);
});

test('transactional payroll reads corrected attendance, preserves prior adjustments and clears approval', async () => {
  const session = { transaction: true };
  let written, calculation;
  const query = value => ({ session(valueSession) { assert.equal(valueSession, session); return this; },
    lean: async () => value, then: (resolve, reject) => Promise.resolve(value).then(resolve, reject) });
  const prior = { _id: 'payroll', status: 'finalized', retroLopDays: 2, bonuses: [{ code: 'BONUS', amount: 500 }] };
  const module = await load('../src/lib/payroll-run-engine.js', {
    '@/lib/payroll-periods': payrollPeriods,
    '@/lib/leave/reconcile-entitlements': { reconcileEntitlements: async () => ({}) },
    mongoose: { default: { Types: { ObjectId: function (id) { return { toString: () => id || 'run' }; } } } },
    '@/lib/models/Payroll': { Payroll: {
      findOne: () => query(prior),
      findOneAndUpdate: async (filter, update, options) => { assert.equal(options.session, session); written = update; return { ...update, _id: 'payroll', userId: 'employee' }; },
      deleteMany: () => { throw new Error('Must not delete payroll in caller transaction'); },
    }, SalaryStructure: { findOne: () => query({ grossLPA: 120000, overrides: [{ type: 'bonus', value: 500 }] }) } },
    '@/lib/models/PayrollRule': { default: { findOne: () => query(null) } },
    '@/lib/models/User': { default: { find: () => query([{ _id: 'employee', name: 'Employee', role: 'employee' }]) } },
    '@/lib/models/Leave': { default: { find: () => query([]) } },
    '@/lib/models/Attendance': { default: { find: () => query([{ date: '2026-11-10', clockIn: '12:00', clockOut: '16:00', status: 'late', scheduleSnapshot: mini }]) } },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({}), getPayrollDay: (v, fallback) => fallback,
      getCycleRange: () => ({ fromDate: '2026-11-10', toDate: '2026-11-10' }),
      getWorkingDayCalendar: async () => ({ workingDays: 1, holidays: [] }), getCycleLabel: () => 'November',
      getCycleCalendarStats: () => ({ totalDays: 1 }), buildWorkingDateSet: () => new Set(['2026-11-10']),
      buildCalendarMap: () => ({ holidays: new Set(), weeklyOff: new Set() }) },
    '@/lib/payroll-calculator': { calculatePayroll: args => { calculation = args; return { legacy: {}, netPay: 1000 }; } },
    '@/lib/attendance-resolver': { classifyDayPay: record => ({ presence: record.status === 'present' ? 1 : 0.5, lopDays: record.status === 'present' ? 0 : 0.5 }) },
    '@/lib/attendance-stats': { isWorkedDay: record => !!record?.clockIn },
    '@/lib/attendance-sync': { syncEmployeeCalendarRows: () => { throw new Error('Out-of-transaction sync'); } },
    '@/lib/middleware': { auditLog: () => { throw new Error('Out-of-transaction audit'); } },
    '@/lib/notify': { notify: () => {} }, '@/lib/permissions': { isEmployer: () => false },
    '@/lib/shift-utils': { resolveRecordShift: async (employee, record) => record.scheduleSnapshot,
      loadDayOverrides: async (ids, valueSession) => { assert.equal(valueSession, session); return new Map(); } },
    '@/lib/shift-schedule': helpers,
    '@/lib/timezone': { getTzTime: async () => new Date(2026, 10, 11), formatDateStr: () => '2026-11-11' },
    '@/lib/attendance-constants': constants,
    '@/lib/payroll-lop-utils': { getEmploymentStartDate: async () => null, countUnpaidWorkingDays: () => 0 },
  });
  const result = await module.runPayrollForMonth({ month: '2026-11', userIds: ['employee'], force: true, session });
  assert.equal(result.processed, 1);
  assert.equal(calculation.lopDays, 0);
  assert.equal(calculation.retroLopDays, 2);
  assert.equal(calculation.adhocBonuses[0].amount, 500);
  assert.equal(calculation.overrides.length, 0);
  assert.equal(written.status, 'draft');
  assert.equal(written.presentDays, 1);
  assert.equal(written.approvedAt, null);
  assert.equal(written.finalizedAt, null);
});
