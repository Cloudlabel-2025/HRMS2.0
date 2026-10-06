// Regularization + permission verification suite.
// Run: node scripts/test-reg-permission.mjs
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const { AttendanceRegularizeSchema } = await import('../src/lib/validation.js');
const { resolveDayStatus } = await import('../src/lib/attendance-resolver.js');
const {
  computePermissionUsage,
  permissionDurationMins,
  permissionCoversShiftStart,
} = await import('../src/lib/permission-allowance.js');
const { closeExtraActiveRows, calculateHoursWorked, diffMins, getShiftConfig } = await import('../src/lib/attendance-constants.js');
const { permissionOverrunMins, isTimeWithinShift, isWindowWithinShift, shiftDayLength, validatePermissionWindow, isPastFiling } = await import('../src/lib/permission-window.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (t) => console.log(`\n── ${t}`);

const BASE = { date: '2026-09-15', reason: 'Missed clock entry while on approved site visit work.' };

// ── 1. Schema ───────────────────────────────────────────────────────────────
section('Schema: AttendanceRegularizeSchema');

const parse = (o) => AttendanceRegularizeSchema.safeParse(o);

check('permission-only request accepted',
  parse({ ...BASE, requestedPermission: { startTime: '09:00', endTime: '11:00', actualEndTime: '11:00', source: 'fetched' } }).success);

check('requestedPermission: null + clock field accepted',
  parse({ ...BASE, requestedIn: '09:00', requestedPermission: null }).success);

check('requestedPermission: null alone rejected (nothing requested)',
  !parse({ ...BASE, requestedPermission: null }).success);

check('permission key omitted + clock field accepted',
  parse({ ...BASE, requestedIn: '09:00' }).success);

check('clock fields alone still accepted (regression)',
  parse({ ...BASE, requestedIn: '09:00', requestedOut: '18:00' }).success);

check('no fields at all rejected',
  !parse(BASE).success);

check('unknown key rejected (strict schema)',
  !parse({ ...BASE, requestedIn: '09:00', bogus: 1 }).success);

check('duration > 120 rejected',
  !parse({ ...BASE, requestedPermission: { startTime: '09:00', endTime: '11:01', actualEndTime: '11:01' } }).success);

check('zero-length permission rejected',
  !parse({ ...BASE, requestedPermission: { startTime: '09:00', endTime: '09:00', actualEndTime: '09:00' } }).success);

check('overnight 23:00-01:00 (=120m) accepted',
  parse({ ...BASE, requestedPermission: { startTime: '23:00', endTime: '01:00', actualEndTime: '01:00' } }).success);

check('overnight 22:00-01:00 (=180m) rejected',
  !parse({ ...BASE, requestedPermission: { startTime: '22:00', endTime: '01:00', actualEndTime: '01:00' } }).success);

check('missing permission start/end rejected',
  !parse({ ...BASE, requestedPermission: { actualEndTime: '11:00' } }).success);

check('actualEnd before start rejected',
  !parse({ ...BASE, requestedPermission: { startTime: '09:00', endTime: '10:00', actualEndTime: '08:30' } }).success);

check('overnight: actualEnd 01:00 after 23:00 start accepted',
  parse({ ...BASE, requestedPermission: { startTime: '23:00', endTime: '01:00', actualEndTime: '01:00' } }).success);

check('overnight: actualEnd 23:30 within window accepted',
  parse({ ...BASE, requestedPermission: { startTime: '23:00', endTime: '01:00', actualEndTime: '23:30' } }).success);

check('actualEnd equal to start accepted',
  parse({ ...BASE, requestedPermission: { startTime: '09:00', endTime: '10:00', actualEndTime: '09:00' } }).success);

check('malformed time rejected',
  !parse({ ...BASE, requestedPermission: { startTime: '9am', endTime: '10:00', actualEndTime: '10:00' } }).success);

// ── 2. Permission duration maths ───────────────────────────────────────────
section('permissionDurationMins');
check('normal 09:00-11:00 = 120', permissionDurationMins('09:00', '11:00') === 120);
check('normal 14:30-15:00 = 30', permissionDurationMins('14:30', '15:00') === 30);
check('overnight 23:00-01:00 = 120', permissionDurationMins('23:00', '01:00') === 120);
check('overnight 22:00-01:30 = 210', permissionDurationMins('22:00', '01:30') === 210);
check('equal = 0', permissionDurationMins('09:00', '09:00') === 0);
check('null input = 0', permissionDurationMins(null, null) === 0);

section('permissionCoversShiftStart');
check('permission starting at shift start covers', permissionCoversShiftStart('09:00', 540, 15) === true);
check('permission starting 10m before shift start covers', permissionCoversShiftStart('08:50', 540, 15) === true);
check('mid-day permission (14:00) does not cover 09:00 shift', permissionCoversShiftStart('14:00', 540, 15) === false);

// ── 3. resolveDayStatus — permission must suppress Late (R3) ───────────────
section('resolveDayStatus: permission consulted (R3)');
const cfg = { lateThreshold: 15, halfDayThreshold: 180, breaks: [] };
const SH = 540; // 09:00

const lateCase = (clockIn, permission, extra = {}) => resolveDayStatus({
  clockIn, permission, approvedHalfDayLeave: false, nonWorkingDayType: 'none',
  leaveOverrideStatus: 'none', minutesSinceShiftStart: extra.mins, shiftStartMins: SH, cfg,
});

const r1 = lateCase('09:40', { startTime: '09:00', endTime: '11:00' }, { mins: 40 });
check('permission covering late arrival => present, not late',
  r1.status === 'present' && r1.lateFlag === false,
  `got status=${r1.status} lateFlag=${r1.lateFlag}`);

const r2 = lateCase('09:40', null, { mins: 40 });
check('no permission + 40m late => late (unchanged)',
  r2.status === 'late' && r2.lateFlag === true,
  `got status=${r2.status} lateFlag=${r2.lateFlag}`);

const r3 = lateCase('09:40', { startTime: '14:00', endTime: '16:00' }, { mins: 40 });
check('mid-day permission does NOT excuse lateness',
  r3.lateFlag === true && r3.isMidDayPermission === true,
  `got lateFlag=${r3.lateFlag} isMidDay=${r3.isMidDayPermission}`);

const r4 = lateCase('11:30', { startTime: '09:00', endTime: '11:00' }, { mins: 150 });
check('arrived after permission window => late again',
  r4.lateFlag === true && r4.permissionApplied === false,
  `got lateFlag=${r4.lateFlag} applied=${r4.permissionApplied}`);

const r5 = lateCase('08:55', { startTime: '09:00', endTime: '11:00' }, { mins: -5 });
check('early arrival with permission => present, not late',
  r5.lateFlag === false, `got lateFlag=${r5.lateFlag}`);

const r6 = lateCase('09:40', { startTime: '09:00', endTime: '11:00' }, { mins: 40 });
check('permissionApplied flag set when covered',
  r6.permissionApplied === true, `got permissionApplied=${r6.permissionApplied}`);

// ── 4. computePermissionUsage ──────────────────────────────────────────────
section('computePermissionUsage');
const u1 = computePermissionUsage({ actualClockIn: '09:40', permStart: '09:00', permEnd: '11:00', grantedDuration: 120, shiftStartMins: SH, lateThreshold: 15 });
check('arrival 09:40 inside window => used 40, refunded 80',
  u1.used === 40 && u1.refunded === 80 && u1.applied === true,
  `got used=${u1.used} refunded=${u1.refunded} applied=${u1.applied}`);

const u2 = computePermissionUsage({ actualClockIn: '09:00', permStart: '09:00', permEnd: '11:00', grantedDuration: 120, shiftStartMins: SH, lateThreshold: 15 });
check('on-time arrival => used 0, fully refunded',
  u2.used === 0 && u2.refunded === 120 && u2.applied === false,
  `got used=${u2.used} refunded=${u2.refunded}`);

const u3 = computePermissionUsage({ actualClockIn: '11:30', permStart: '09:00', permEnd: '11:00', grantedDuration: 120, shiftStartMins: SH, lateThreshold: 15 });
check('arrival after window => full grant consumed, no refund',
  u3.used === 120 && u3.refunded === 0 && u3.applied === false,
  `got used=${u3.used} refunded=${u3.refunded}`);

const u4 = computePermissionUsage({ actualClockIn: '14:30', permStart: '14:00', permEnd: '16:00', grantedDuration: 120, shiftStartMins: SH, lateThreshold: 15 });
check('mid-day permission consumes full grant, not applied',
  u4.used === 120 && u4.applied === false && u4.isMidDay === true,
  `got used=${u4.used} applied=${u4.applied} mid=${u4.isMidDay}`);

const u5 = computePermissionUsage({ actualClockIn: null, permStart: '09:00', permEnd: '11:00', grantedDuration: 120, shiftStartMins: SH, lateThreshold: 15 });
check('no clock-in yet => full grant counted',
  u5.used === 120 && u5.applied === false, `got used=${u5.used}`);

section('permissionOverrunMins: wrap-aware overrun');
check('on-time return = 0 overrun', permissionOverrunMins('09:00', '11:00', '11:00') === 0);
check('early return = 0 overrun (never negative)', permissionOverrunMins('09:00', '11:00', '10:30') === 0);
check('late return 11:30 = +30m', permissionOverrunMins('09:00', '11:00', '11:30') === 30, `got ${permissionOverrunMins('09:00', '11:00', '11:30')}`);
check('late return 18:00 = +420m', permissionOverrunMins('09:00', '11:00', '18:00') === 420, `got ${permissionOverrunMins('09:00', '11:00', '18:00')}`);
check('overnight in-window 23:30 (23:00-01:00) = 0, NOT +1350',
  permissionOverrunMins('23:00', '01:00', '23:30') === 0,
  `got ${permissionOverrunMins('23:00', '01:00', '23:30')}`);
check('overnight on-time 01:00 = 0', permissionOverrunMins('23:00', '01:00', '01:00') === 0);
check('overnight late 01:30 = +30m', permissionOverrunMins('23:00', '01:00', '01:30') === 30, `got ${permissionOverrunMins('23:00', '01:00', '01:30')}`);
check('missing actual end = 0', permissionOverrunMins('09:00', '11:00', null) === 0);
check('malformed input = 0', permissionOverrunMins('09:00', '11:00', 'noon') === 0);

// ── 5. Single-active-row invariant (R1) ────────────────────────────────────
section('closeExtraActiveRows: single-active-row invariant (R1)');
const twoOpen = [
  { type: 'task', taskDetails: 'A', startTime: '09:00', endTime: null, status: 'work_in_progress' },
  { type: 'task', taskDetails: 'B', startTime: '10:00', endTime: null, status: 'work_in_progress' },
];
const healed = closeExtraActiveRows(twoOpen, '11:00');
const openAfter = healed.rows.filter(r => r.startTime && !r.endTime);
check('two open rows heal to one', openAfter.length === 1, `got ${openAfter.length}`);
check('most recently started row stays open', openAfter[0].taskDetails === 'B', `got ${openAfter[0]?.taskDetails}`);
check('earlier row closed at nowTime', healed.rows[0].endTime === '11:00', `got ${healed.rows[0].endTime}`);
check('healed count reported', healed.healed === 1, `got ${healed.healed}`);

const clamped = closeExtraActiveRows([
  { type: 'task', startTime: '10:30', endTime: null },
  { type: 'task', startTime: '11:00', endTime: null },
], '09:00');
check('never closes a row before its own start (no negative duration)',
  clamped.rows[0].endTime === '10:30', `got ${clamped.rows[0].endTime}`);

const oneOpen = closeExtraActiveRows([{ type: 'task', startTime: '09:00', endTime: null }], '11:00');
check('single open row left untouched', oneOpen.healed === 0 && oneOpen.rows[0].endTime === null);

// Permission row pushed by the approval path is already completed, so it can
// never itself become a second active row.
const withPerm = [
  { type: 'task', taskDetails: '', startTime: '09:40', endTime: null, status: 'work_in_progress' },
  { type: 'permission', startTime: '09:00', endTime: '11:00', status: 'completed' },
];
const healedPerm = closeExtraActiveRows(withPerm, '11:00');
check('completed permission row adds no active row',
  healedPerm.rows.filter(r => r.startTime && !r.endTime).length === 1);

// ── 6. Hours semantics (decision 1: permission NOT deducted) ───────────────
section('Hours semantics: permission does not change worked hours');
const cfgH = getShiftConfig({ startTime: '09:00', endTime: '18:00', lateThreshold: 15 }, { breaks: [], standardWorkMins: 480 });
const base = Math.max(0, diffMins('09:40', '18:00'));
const h1 = calculateHoursWorked(base, 0, cfgH);
check('day with permission still credits a full 8h',
  h1.payableHours === 480 && h1.shortHours === false,
  `got payable=${h1.payableHours} short=${h1.shortHours}`);

check('hoursWorked is raw elapsed minus breaks (permission never deducted)',
  h1.hoursWorked === base,
  `got hoursWorked=${h1.hoursWorked} expected=${base}`);

const shortDay = calculateHoursWorked(Math.max(0, diffMins('09:00', '13:00')), 0, cfgH, { clockOut: '13:00', shiftEndMins: 18 * 60 });
check('early clock-out still flagged shortHours (permission only suppresses it upstream)',
  shortDay.shortHours === true && shortDay.hoursWorked === 240 && shortDay.shortfallMins === 300,
  `got short=${shortDay.shortHours} worked=${shortDay.hoursWorked} shortfall=${shortDay.shortfallMins}`);

check('payableHours capped at expected (never over-credits)',
  calculateHoursWorked(600, 0, cfgH).payableHours <= 480,
  `got ${calculateHoursWorked(600, 0, cfgH).payableHours}`);

check('clockIn/clockOut missing => no hours (guarded recompute)',
  calculateHoursWorked(0, 0, cfgH).hoursWorked === 0);

// ── 7. Shift-window containment (past-date regularization) ─────────────
section('Shift-window containment');
check('day shift length 10:00-18:00 = 480', shiftDayLength('10:00', '18:00') === 480);
check('overnight shift length 22:00-06:00 = 480', shiftDayLength('22:00', '06:00') === 480);
check('10:00 and 18:00 inside 10:00-18:00 (inclusive ends)',
  isTimeWithinShift('10:00', '10:00', '18:00') && isTimeWithinShift('18:00', '10:00', '18:00'));
check('09:59 and 18:01 outside 10:00-18:00',
  !isTimeWithinShift('09:59', '10:00', '18:00') && !isTimeWithinShift('18:01', '10:00', '18:00'));
check('02:00 inside overnight 22:00-06:00', isTimeWithinShift('02:00', '22:00', '06:00'));
check('21:59 outside overnight 22:00-06:00', !isTimeWithinShift('21:59', '22:00', '06:00'));
check('window 10:00-10:30 inside 10:00-18:00', isWindowWithinShift('10:00', '10:30', '10:00', '18:00'));
check('window 17:30-18:30 outside 10:00-18:00', !isWindowWithinShift('17:30', '18:30', '10:00', '18:00'));
check('window 09:00-10:00 outside 10:00-18:00', !isWindowWithinShift('09:00', '10:00', '10:00', '18:00'));
check('overnight window 23:30-00:30 inside 22:00-06:00', isWindowWithinShift('23:30', '00:30', '22:00', '06:00'));
check('malformed input never passes', !isTimeWithinShift(null, '10:00', '18:00') && !isWindowWithinShift('10:00', null, '10:00', '18:00'));

// ── 8. Past date/time permissions allowed + past-filing detection ─────
section('Past permission filing');
const pastDateCheck = validatePermissionWindow({
  date: '2020-01-15', startTime: '10:00', endTime: '10:30',
  now: new Date(), minDate: '2026-10-06', maxDate: '2026-11-05',
});
check('past date accepted', pastDateCheck.valid === true, pastDateCheck.error || '');
const pastTimeCheck = validatePermissionWindow({
  date: '2026-10-06', startTime: '00:00', endTime: '00:30',
  now: new Date('2026-10-06T23:00:00'), minDate: '2026-10-06', maxDate: '2026-11-05',
});
check('past time today accepted', pastTimeCheck.valid === true, pastTimeCheck.error || '');
const overAdvance = validatePermissionWindow({
  date: '2027-06-01', startTime: '10:00', endTime: '10:30',
  now: new Date(), maxDate: '2026-11-05',
});
check('advance cap still enforced', overAdvance.valid === false, JSON.stringify(overAdvance));
const overDur = validatePermissionWindow({ date: '2026-10-06', startTime: '10:00', endTime: '13:00', now: new Date() });
check('duration cap still enforced', overDur.valid === false, JSON.stringify(overDur));
check('past date is past filing',
  isPastFiling('2026-09-28', '10:00', new Date(2026, 8, 30, 10, 0, 0)) === true);
check('past time today is past filing',
  isPastFiling('2026-09-30', '09:00', new Date(2026, 8, 30, 10, 0, 0)) === true);
check('future window today is not past filing',
  isPastFiling('2026-09-30', '15:00', new Date(2026, 8, 30, 10, 0, 0)) === false);
check('future date is not past filing',
  isPastFiling('2026-10-05', '10:00', new Date(2026, 8, 30, 10, 0, 0)) === false);
check('overnight window filed next morning is past filing',
  isPastFiling('2026-09-30', '23:00', new Date(2026, 9, 1, 2, 0, 0)) === true);
check('malformed filing input never flags', isPastFiling(null, '10:00', new Date(2026, 8, 30, 10, 0, 0)) === false);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(52)}`);
console.log(`Passed: ${pass}   Failed: ${fail}   Total: ${pass + fail}`);
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
