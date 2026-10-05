// Leave-wins regression guard (pure functions, no DB).
// Run: node scripts/verify-leave-clock-guard.mjs
// Fails (exit 1) if any approved-leave protection regresses.
//
// Rules under test:
//   - resolveDayStatus with onApprovedLeave => 'leave', lateFlag false,
//     even for a clock-in far past the late threshold.
//   - Without cover, the same clock-in is still 'late' (control).
//   - A worked half of a half-day leave is judged by the actual clock-in
//     (present/late like any worked day) — resolver does NOT force half_day.
//   - classifyDayPay for a leave+clockIn row => presence 0, LOP 0.
//   - classifyDayPay for late (default half mode) => 0.5 / 0.5 (control).
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const { resolveDayStatus, classifyDayPay } = await import('../src/lib/attendance-resolver.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};

const cfg = { lateThreshold: 15 };

// 1. Late clock-in on an approved full-day leave day stays leave.
const r1 = resolveDayStatus({
  clockIn: '11:30',
  permission: null,
  approvedHalfDayLeave: false,
  onApprovedLeave: true,
  nonWorkingDayType: 'none',
  leaveOverrideStatus: 'none',
  minutesSinceShiftStart: 150,
  shiftStartMins: 540,
  cfg,
});
check('leave-day late clock-in stays leave', r1.status === 'leave' && r1.lateFlag === false, JSON.stringify(r1));

// 2. Control: same clock-in with no cover is still late.
const r2 = resolveDayStatus({
  clockIn: '11:30',
  permission: null,
  approvedHalfDayLeave: false,
  onApprovedLeave: false,
  nonWorkingDayType: 'none',
  leaveOverrideStatus: 'none',
  minutesSinceShiftStart: 150,
  shiftStartMins: 540,
  cfg,
});
check('no-cover late clock-in still late (control)', r2.status === 'late' && r2.lateFlag === true, JSON.stringify(r2));

// 3. Worked half of a half-day leave is judged by the clock-in (150 min
// late => late), NOT forced to half_day by the resolver.
const r3 = resolveDayStatus({
  clockIn: '11:30',
  permission: null,
  approvedHalfDayLeave: true,
  onApprovedLeave: false,
  nonWorkingDayType: 'none',
  leaveOverrideStatus: 'none',
  minutesSinceShiftStart: 150,
  shiftStartMins: 540,
  cfg,
});
check('half-day worked half judged by clock-in', r3.status === 'late' && r3.lateFlag === true, JSON.stringify(r3));

// 4. Payroll money for a clocked-in leave row: 0 presence, 0 LOP.
const p1 = classifyDayPay({ status: 'leave', clockIn: '09:05', approvedHalfDayLeave: false }, { lateLopMode: 'half' }, 5);
check('leave+clockIn earns 0 presence / 0 LOP', p1.presence === 0 && p1.lopDays === 0, JSON.stringify(p1));

// 5. Control: late money unchanged.
const p2 = classifyDayPay({ status: 'late', clockIn: '09:45', halfDayThresholdExceeded: false }, { lateLopMode: 'half' }, 45);
check('late money still 0.5 / 0.5 (control)', p2.presence === 0.5 && p2.lopDays === 0.5, JSON.stringify(p2));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
