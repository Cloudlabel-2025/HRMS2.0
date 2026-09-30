// Short-hours rule verification.
// Run: node scripts/test-short-hours.mjs
//
// Rule under test (locked with the product owner):
//   shortHours = shortfallMins > 0 || breakExcessMins > 0
//   - shortfall  = clock-out before the scheduled shift end
//   - breakExcess= break time over the allowances
//   - NO strict 8-hour comparison; expectedHours only caps payableHours
//   - Late arrival is a separate judgement and never implies short hours
//   - Permission days never flag short
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const { calculateHoursWorked, getShiftConfig, diffMins } = await import('../src/lib/attendance-constants.js');
const { calculateBreakExcess, calculateBreakDeduction } = await import('../src/lib/attendance-breaks.js');
const { getShiftEndMinutes } = await import('../src/lib/shift-utils.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (t) => console.log(`\n── ${t}`);

const cfg = (start, end, expectedHours = 480, breaks = [
  { type: 'break', name: 'Break', maxDuration: 30, maxCount: 1 },
  { type: 'lunch', name: 'Lunch', maxDuration: 60, maxCount: 1 },
]) => getShiftConfig({ startTime: start, endTime: end, expectedHours, breaks }, { breaks: [], standardWorkMins: expectedHours });

/** End-to-end: clock-in/out on a shift, returns the short-hours verdict. */
const day = ({ shift, clockIn, clockOut, breaks = [], breaksCfg = null, ctx = {} }) => {
  const c = cfg(shift[0], shift[1]);
  const rules = breaksCfg || c.breaks;
  const elapsed = Math.max(0, diffMins(clockIn, clockOut));
  const deduction = calculateBreakDeduction(breaks, rules);
  const excess = calculateBreakExcess(breaks, rules).excessMins;
  const shiftEndMins = getShiftEndMinutes({ startTime: shift[0], endTime: shift[1] }, c);
  return calculateHoursWorked(elapsed, deduction, c, {
    clockOut, shiftEndMins, breakExcessMins: excess, ...ctx,
  });
};

// ── 1. Shift-duration driven (no strict 8-hour rule) ───────────────────────
section('No strict 8-hour rule');

const threeHr = day({ shift: ['09:00', '12:00'], clockIn: '09:00', clockOut: '12:00' });
check('3h shift, on-time in/out => NOT short', threeHr.shortHours === false,
  `got ${JSON.stringify(threeHr)}`);
check('3h shift records 180m worked', threeHr.hoursWorked === 180, `got ${threeHr.hoursWorked}`);
check('3h shift payable capped at 180 not 480', threeHr.payableHours === 180, `got ${threeHr.payableHours}`);
check('3h shift shortfall 0', threeHr.shortfallMins === 0, `got ${threeHr.shortfallMins}`);

const threeHrEarly = day({ shift: ['09:00', '12:00'], clockIn: '09:00', clockOut: '11:30' });
check('3h shift, out 30m early => short 30m', threeHrEarly.shortHours === true && threeHrEarly.shortfallMins === 30,
  `got short=${threeHrEarly.shortHours} shortfall=${threeHrEarly.shortfallMins}`);

const eightHrFull = day({ shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '18:00' });
check('8h shift full day => NOT short', eightHrFull.shortHours === false, `got ${JSON.stringify(eightHrFull)}`);

// ── 2. Clock-out shortfall ─────────────────────────────────────────────────
section('Clock-out shortfall');

const earlyOut = day({ shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '17:00' });
check('out at 17:00 on 09:00-18:00 => short 60m', earlyOut.shortHours === true && earlyOut.shortfallMins === 60,
  `got short=${earlyOut.shortHours} shortfall=${earlyOut.shortfallMins}`);

const lateInOnTimeOut = day({ shift: ['09:00', '18:00'], clockIn: '09:40', clockOut: '18:00' });
check('late in but on-time out => NOT short (Late is separate)', lateInOnTimeOut.shortHours === false,
  `got short=${lateInOnTimeOut.shortHours} shortfall=${lateInOnTimeOut.shortfallMins}`);
check('late-in day still computes 500m worked', lateInOnTimeOut.hoursWorked === 500, `got ${lateInOnTimeOut.hoursWorked}`);

const overStay = day({ shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '18:30' });
check('staying past shift end => NOT short', overStay.shortHours === false && overStay.shortfallMins === 0,
  `got ${JSON.stringify(overStay)}`);

// ── 3. Overnight shifts ────────────────────────────────────────────────────
section('Overnight shifts');

const nightCfg = cfg('22:00', '06:00');
const nightEnd = getShiftEndMinutes({ startTime: '22:00', endTime: '06:00' }, nightCfg);
check('overnight shift end resolves past midnight (06:00 => 1800)', nightEnd === 1800, `got ${nightEnd}`);

const nightFull = day({ shift: ['22:00', '06:00'], clockIn: '22:00', clockOut: '06:00' });
check('overnight full night => NOT short', nightFull.shortHours === false,
  `got short=${nightFull.shortHours} shortfall=${nightFull.shortfallMins}`);

const nightOutEarly = day({ shift: ['22:00', '06:00'], clockIn: '22:00', clockOut: '05:00' });
check('overnight, out 05:00 => short 60m', nightOutEarly.shortHours === true && nightOutEarly.shortfallMins === 60,
  `got short=${nightOutEarly.shortHours} shortfall=${nightOutEarly.shortfallMins}`);

// ── 4. Break excess — the three locked answers ─────────────────────────────
section('Break excess');

const lunchRule = [{ type: 'lunch', name: 'Lunch', maxDuration: 60, maxCount: 1 }];
const underAllowance = calculateBreakExcess([{ type: 'lunch', start: '13:00', end: '13:45' }], lunchRule);
check('45m of a 60m allowance => 0 excess (normal, not short)', underAllowance.excessMins === 0,
  `got ${underAllowance.excessMins}`);

const overCap = calculateBreakExcess([{ type: 'break', start: '11:00', end: '11:40' }],
  [{ type: 'break', name: 'Break', maxDuration: 30, maxCount: 1 }]);
check('30m break that took 40m => 10m exceeded', overCap.excessMins === 10, `got ${overCap.excessMins}`);

const pooled = calculateBreakExcess(
  [{ type: 'lunch', start: '12:00', end: '12:40' }, { type: 'lunch', start: '16:00', end: '16:40' }],
  [{ type: 'lunch', name: 'Lunch', maxDuration: 60, maxCount: 1 }]);
check('two 40m breaks in a 60m pool => 20m exceeded', pooled.excessMins === 20, `got ${pooled.excessMins}`);

const exactlyAtCap = calculateBreakExcess([{ type: 'break', start: '11:00', end: '11:30' }],
  [{ type: 'break', name: 'Break', maxDuration: 30, maxCount: 1 }]);
check('break exactly at its cap => 0 excess', exactlyAtCap.excessMins === 0, `got ${exactlyAtCap.excessMins}`);

const twoUnderCap = calculateBreakExcess(
  [{ type: 'break', start: '11:00', end: '11:20' }, { type: 'break', start: '15:00', end: '15:20' }],
  [{ type: 'break', name: 'Break', maxDuration: 30, maxCount: 2 }]);
check('two 20m breaks within a 30x2 pool => 0 excess', twoUnderCap.excessMins === 0, `got ${twoUnderCap.excessMins}`);

const openBreak = calculateBreakExcess([{ type: 'break', start: '11:00', end: null }], lunchRule);
check('unfinished break contributes no excess yet', openBreak.excessMins === 0, `got ${openBreak.excessMins}`);

check('calculateBreakDeduction matches calculateBreakExcess',
  calculateBreakDeduction([{ type: 'break', start: '11:00', end: '11:40' }],
    [{ type: 'break', name: 'Break', maxDuration: 30, maxCount: 1 }]) === calculateBreakExcess(
    [{ type: 'break', start: '11:00', end: '11:40' }],
    [{ type: 'break', name: 'Break', maxDuration: 30, maxCount: 1 }]).excessMins);

// ── 5. Break excess drives short hours even when the day is long ───────────
section('Break excess => short hours');

const longDayWithExcess = day({
  shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '18:00',
  breaks: [{ type: 'break', start: '11:00', end: '11:40' }],
  breaksCfg: [{ type: 'break', name: 'Break', maxDuration: 30, maxCount: 1 }],
});
check('full day + 10m break excess => short hours', longDayWithExcess.shortHours === true,
  `got ${JSON.stringify(longDayWithExcess)}`);
check('  excess recorded as 10m', longDayWithExcess.breakExcessMins === 10, `got ${longDayWithExcess.breakExcessMins}`);
check('  shortfall stays 0 (clock-out on time)', longDayWithExcess.shortfallMins === 0, `got ${longDayWithExcess.shortfallMins}`);

const longDayCleanBreaks = day({
  shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '18:00',
  breaks: [{ type: 'lunch', start: '13:00', end: '13:45' }],
});
check('full day + 45m/60m lunch => NOT short', longDayCleanBreaks.shortHours === false,
  `got ${JSON.stringify(longDayCleanBreaks)}`);

// ── 6. Cases that must never be short ──────────────────────────────────────
section('Never short');

const noCtx = calculateHoursWorked(480, 0, cfg('09:00', '18:00'));
check('no ctx (legacy 3-arg call) => not short', noCtx.shortHours === false, `got ${noCtx.shortHours}`);

const noClockOut = calculateHoursWorked(300, 0, cfg('09:00', '18:00'), { shiftEndMins: 1080 });
check('no clock-out yet => not short', noClockOut.shortHours === false, `got ${noClockOut.shortHours}`);

const permDay = calculateHoursWorked(300, 0, cfg('09:00', '18:00'), { shiftEndMins: 1080, breakExcessMins: 0 });
check('permission day context (excess/shortfall zeroed) => not short', permDay.shortHours === false);

const autoLoggedOut = day({ shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '24:00' });
check('auto-logout past shift end => not short', autoLoggedOut.shortHours === false && autoLoggedOut.shortfallMins === 0,
  `got short=${autoLoggedOut.shortHours} shortfall=${autoLoggedOut.shortfallMins}`);

// ── 7. Regression: payableHours still capped, hoursWorked untouched ────────
section('Regression');

const sixHrOnEight = day({ shift: ['09:00', '18:00'], clockIn: '09:00', clockOut: '15:00' });
check('payableHours capped at expectedHours', sixHrOnEight.payableHours === 360, `got ${sixHrOnEight.payableHours}`);
check('hoursWorked is raw elapsed minus break deduction', sixHrOnEight.hoursWorked === 360, `got ${sixHrOnEight.hoursWorked}`);
check('  and the day is short by 180m', sixHrOnEight.shortHours === true && sixHrOnEight.shortfallMins === 180,
  `got short=${sixHrOnEight.shortHours} shortfall=${sixHrOnEight.shortfallMins}`);

const zeroElapsed = calculateHoursWorked(0, 0, cfg('09:00', '18:00'));
check('zero elapsed => zero hours, not short', zeroElapsed.hoursWorked === 0 && zeroElapsed.shortHours === false);

const negativeElapsed = calculateHoursWorked(-60, 0, cfg('09:00', '18:00'));
check('negative elapsed clamps to 0', negativeElapsed.hoursWorked === 0 && negativeElapsed.baseHours === 0);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(52)}`);
console.log(`Passed: ${pass}   Failed: ${fail}   Total: ${pass + fail}`);
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
