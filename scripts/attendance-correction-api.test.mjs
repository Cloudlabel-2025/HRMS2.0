import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
const { default: Attendance } = await import('../src/lib/models/Attendance.js');
const constants = await import('../src/lib/attendance-constants.js');
const breaks = await import('../src/lib/attendance-breaks.js');
const windows = await import('../src/lib/permission-window.js');
const timeline = await import('../src/lib/attendance-timeline.js');
const reviewSource = await readFile(new URL('../src/app/api/attendance/regularize/route.js', import.meta.url), 'utf8');
const attendanceSource = await readFile(new URL('../src/app/api/attendance/route.js', import.meta.url), 'utf8');
const userId = '507f1f77bcf86cd799439011';
const permId = '507f1f77bcf86cd799439012';
const request = data => ({ json: async () => data, headers: { get: () => '' } });

async function setup({ permission = false, conflict = false } = {}) {
  const eventType = permission ? 'permission' : 'break';
  const record = new Attendance({
    userId, date: '2026-10-16', clockIn: '09:00', clockOut: '18:00',
    shiftStartTime: '09:00', shiftEndTime: '18:00',
    breaks: permission ? [] : [{ type: 'break', name: 'Tea', ruleIdx: 0, start: '10:00', end: '10:45' }],
    permission: permission ? { requestId: permId, startTime: '10:00', endTime: '10:30', endedAt: '10:45', endedLate: true, endedLateMins: 15 } : undefined,
    workProgress: [
      { type: 'task', taskDetails: 'Before', startTime: '09:00', endTime: '10:00', status: 'completed' },
      { type: eventType, taskDetails: permission ? 'Permission' : 'Tea', startTime: '10:00', endTime: '10:45', permissionRequestId: permission ? permId : undefined, status: 'completed' },
      { type: 'task', taskDetails: 'After', startTime: '10:45', endTime: '18:00', status: 'completed', remarks: 'Preserved' },
      ...(conflict ? [{ type: 'permission', taskDetails: 'Later fixed event', startTime: '10:30', endTime: '11:00', status: 'completed' }] : []),
    ],
  });
  let saves = 0;
  record.save = async () => { await record.validate(); saves++; };
  const reg = { _id: 'reg', userId, date: record.date, status: 'pending', requestedIn: permission ? null : '08:45', requestedBreaks: permission ? [] : [{ type: 'break', name: 'Tea', ruleIdx: 0, idx: 0, start: '10:00', end: conflict ? '10:45' : '10:15' }], requestedPermission: permission ? { startTime: '10:00', endTime: '10:30', actualEndTime: '10:15', source: 'fetched' } : null };
  const events = [];
  const writeFilters = [];
  const selfRequest = { _id: permId, status: 'approved', payload: { startTime: '10:00', endTime: '10:30' } };
  const attendanceModel = {
    findOne: () => ({ then: resolve => resolve(record), select: () => ({ lean: async () => ({ timelineRevision: record.timelineRevision }) }) }),
    findOneAndUpdate: async (filter, update) => { writeFilters.push(filter); Object.assign(record, update); return record; },
  };
  const adapters = {
    '@/lib/db': { connectDB: async () => {} },
    '@/lib/models/Attendance': { default: attendanceModel },
    '@/lib/models/User': { default: { findById: () => ({ select: () => ({ lean: async () => ({ _id: userId, role: 'employee', profileId: userId, identityId: userId }) }) }) } },
    '@/lib/models/index': {
      AttendanceRegularization: { findById: async () => reg, findOneAndUpdate: async () => { if (reg.status !== 'pending') return null; reg.status = 'approved'; return reg; } },
      Notification: { create: async () => {} }, Holiday: {}, Leave: { findOne: () => ({ lean: async () => null }) },
      SelfServiceRequest: { findOne: () => ({ sort: () => ({ lean: async () => selfRequest }) }), findByIdAndUpdate: () => ({ lean: async () => selfRequest }) },
    },
    '@/lib/middleware': { requireAuth: async () => ({ user: { _id: '507f1f77bcf86cd799439099', role: 'super_admin' } }), auditLog: async () => {} },
    '@/lib/jwt': { ok: (data, status = 200) => ({ data, status }), fail: (error, status) => ({ error, status }) },
    '@/lib/validation': { AttendanceRegularizeSchema: {}, ApproveRegularizationSchema: {}, validateRequest: (_, data) => ({ valid: true, data }) },
    '@/lib/rbac': { canApproveManualPermission: () => true, canApproveRegularization: async () => true, getRegularizationApproverIds: async () => [], getAccessibleDepartments: async () => null },
    '@/lib/payroll-cycle': { getGlobalConfig: async () => ({}), parseShiftStartTime: () => 540, isWorkingDay: () => true },
    '@/lib/attendance-constants': constants,
    '@/lib/attendance-breaks': breaks,
    '@/lib/shift-utils': { resolveShift: async () => null, resolveShiftForDate: async () => null, getShiftEndMinutes: () => 1080 },
    '@/lib/permissions': { isEmployer: () => false },
    '@/lib/permission-allowance': { computePermissionUsage: () => ({ used: 30, refunded: 0, applied: false, isMidDay: true }), permissionDurationMins: (start, end) => constants.diffMins(start, end), getPermissionAllowanceMins: () => 120, getPermissionUsageForCycle: async () => ({ totalUsed: 30 }), getCycleRangeForDate: async () => ({ fromDate: '2026-10-01', toDate: '2026-10-31' }) },
    '@/lib/permission-window': windows,
    '@/lib/attendance-resolver': { resolveDayStatus: () => ({ lateFlag: false }) },
    '@/lib/leave-cover': { isFullDayLeaveCovered: async () => false },
    '@/lib/attendance-timeline': timeline,
    '@/lib/sse': { publishAttendance: event => events.push(event) },
    '@/lib/timezone': { getTzTime: async () => new Date(2026, 9, 17, 12) },
    '@/lib/shift-today': { getShiftAwareToday: async () => record.date },
    '@/lib/attendance-utils': { checkAndApplyAutoLogout: async () => false },
    '@/lib/permission-work': { reconcilePermissionWorkProgress: () => false },
    '@/lib/attendance-stats': { isWorkedDay: () => true },
    '@/lib/attendance-sync': { syncCalendarRowsForUsers: async () => {} },
    '@/lib/notify': { notify: async () => {} },
  };
  const context = vm.createContext({ console });
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
  const review = await load(reviewSource);
  const attendance = await load(attendanceSource);
  return { record, reg, events, writeFilters, saves: () => saves,
    approve: () => review.PUT(request({ id: 'reg', action: 'approved' })),
    saveWork: revision => attendance.PUT(request({ userId, date: record.date, workProgress: record.toObject().workProgress, ...(revision === undefined ? {} : { timelineRevision: revision }) })),
  };
}

test('approved break and clock-in corrections persist the task timeline with Mongoose subdocuments', async () => {
  const state = await setup();
  const rowId = String(state.record.workProgress[2]._id);
  const result = await state.approve();
  assert.equal(result.status, 200, result.error);
  assert.equal(state.record.workProgress[0].startTime, '08:45');
  assert.equal(state.record.breaks[0].start, '10:00');
  assert.equal(state.record.breaks[0].end, '10:15');
  assert.equal(state.record.workProgress[2].startTime, '10:15');
  assert.equal(state.record.workProgress[2].duration, 465);
  assert.equal(String(state.record.workProgress[2]._id), rowId);
  assert.equal(state.record.workProgress[2].remarks, 'Preserved');
  assert.equal(state.record.timelineRevision, 1);
  assert.equal(state.events[0].type, 'timing_corrected');
  assert.equal(state.saves(), 1);
});

test('permission correction updates the resumed task and clears the old overrun', async () => {
  const state = await setup({ permission: true });
  const result = await state.approve();
  assert.equal(result.status, 200, result.error);
  assert.equal(state.record.permission.endedAt, '10:15');
  assert.equal(state.record.permission.endedLate, false);
  assert.equal(state.record.permission.endedLateMins, 0);
  assert.equal(state.record.workProgress[2].startTime, '10:15');
  assert.equal(state.record.workProgress.filter(row => row.type === 'permission').length, 1);
});

test('an invalid corrected timeline leaves the request pending', async () => {
  const state = await setup({ conflict: true });
  const result = await state.approve();
  assert.equal(result.status, 400, result.error);
  assert.match(result.error, /overlaps/);
  assert.equal(state.reg.status, 'pending');
  assert.equal(state.saves(), 0);
});

test('stale work saves cannot overwrite approved timing corrections', async () => {
  const state = await setup();
  assert.equal((await state.approve()).status, 200);
  assert.equal((await state.saveWork(0)).status, 409);
  assert.equal((await state.saveWork(undefined)).status, 409);
  assert.equal(state.writeFilters.length, 0);
  assert.equal((await state.saveWork(1)).status, 200);
  assert.equal(state.writeFilters[0].timelineRevision, 1);
});
