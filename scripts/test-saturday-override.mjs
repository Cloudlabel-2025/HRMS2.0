// Compensated working-Saturday verification.
// Run: node scripts/test-saturday-override.mjs
//
// Rules under test:
//   - A Holiday row flagged workingDayOverride makes its date working
//     (Saturdays only — enforced at the API, trusted by the calendar fns).
//   - Sundays stay non-working no matter what the data says.
//   - Leave always follows the calendar: working Saturdays count even with
//     countWeekends:false; off Saturdays never do.
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const { isWorkingDay, buildCalendarMap, countWorkingDaysInRange } = await import('../src/lib/payroll-cycle.js');
const { isSaturdayOff } = await import('../src/lib/saturday-cycle.js');
const { classifyCalendarDate } = await import('../src/lib/attendance-sync.js');
const { recomputePaidSplit, adjustPeriodUsage, assertSaturdayDate } = await import('../src/lib/leave/reevaluate.js');
const { recordPeriodUsageSplit } = await import('../src/lib/leave/accrual.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};
const section = (t) => console.log(`\n── ${t}`);

// nth Saturday (0-indexed) of month m (1-indexed) — no hardcoded dates.
const satIn = (y, m, n = 0) => {
  const d = new Date(y, m - 1, 1);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isSat = (ds) => new Date(ds + 'T00:00:00').getDay() === 6;

const ALT = { saturdayWorking: 'alternate', saturdayAlternatePattern: 'pattern1' };
// A leave Saturday and a working Saturday under pattern1 (whichever they are).
const SATS = [0, 1, 2, 3].map(n => satIn(2026, 9, n));
const leaveSat = SATS.find(s => isSaturdayOff(s, ALT));
const workSat = SATS.find(s => !isSaturdayOff(s, ALT));
check('test setup: found one leave and one working Saturday', !!(leaveSat && workSat) && SATS.every(isSat),
  `got ${JSON.stringify(SATS)}`);

const sunday = '2026-09-06'; // a Sunday
check('test setup: Sunday anchor is a Sunday', new Date(sunday + 'T00:00:00').getDay() === 0);

const hol = (date, override = false) => ({ date, name: 'Saturday Holiday', type: 'Company', workingDayOverride: override });

// ── 1. isWorkingDay override precedence ─────────────────────────────────────
section('isWorkingDay');

check('leave Saturday + override => working',
  isWorkingDay(leaveSat, ALT, [hol(leaveSat, true)]) === true);
check('leave Saturday, no override => off',
  isWorkingDay(leaveSat, ALT, [hol(leaveSat)]) === false);
check('working Saturday, no override => working',
  isWorkingDay(workSat, ALT, []) === true);
check('override flag on a Sunday => still off',
  isWorkingDay(sunday, ALT, [hol(sunday, true)]) === false);
check('plain holiday (non-Saturday) still off',
  isWorkingDay('2026-10-02', ALT, [{ date: '2026-10-02', name: 'Gandhi Jayanti' }]) === false);
check('string-shape holiday rows still work',
  isWorkingDay(leaveSat, ALT, [leaveSat]) === false);
check('saturdayWorking:all => Saturday working', isWorkingDay(workSat, { saturdayWorking: 'all' }, []) === true);
check('saturdayWorking:none => Saturday off', isWorkingDay(workSat, { saturdayWorking: 'none' }, []) === false);

// ── 2. buildCalendarMap ────────────────────────────────────────────────────
section('buildCalendarMap');

const map = buildCalendarMap(leaveSat, leaveSat, ALT, [hol(leaveSat, true)]);
check('override date classifies as working', map.byDate.get(leaveSat) === 'working',
  `got ${map.byDate.get(leaveSat)}`);
const map2 = buildCalendarMap(leaveSat, leaveSat, ALT, []);
check('same date with no Holiday row classifies as weekly_off', map2.byDate.get(leaveSat) === 'weekly_off',
  `got ${map2.byDate.get(leaveSat)}`);
const map2b = buildCalendarMap(leaveSat, leaveSat, ALT, [hol(leaveSat)]);
check('explicit non-override Holiday row still classifies as holiday', map2b.byDate.get(leaveSat) === 'holiday',
  `got ${map2b.byDate.get(leaveSat)}`);
const map3 = buildCalendarMap('2026-10-02', '2026-10-02', ALT, [{ date: '2026-10-02' }]);
check('plain holiday still classifies as holiday', map3.byDate.get('2026-10-02') === 'holiday',
  `got ${map3.byDate.get('2026-10-02')}`);

// ── 3. Leave counts working Saturdays ──────────────────────────────────────
section('countWorkingDaysInRange');

check('working Saturday alone, countWeekends:false => 1',
  countWorkingDaysInRange(workSat, workSat, ALT, [], { countWeekends: false, countHolidays: false }) === 1);
check('off Saturday alone, countWeekends:false => 0',
  countWorkingDaysInRange(leaveSat, leaveSat, ALT, [hol(leaveSat)], { countWeekends: false, countHolidays: false }) === 0);
check('overridden Saturday alone, countWeekends:false => 1',
  countWorkingDaysInRange(leaveSat, leaveSat, ALT, [hol(leaveSat, true)], { countWeekends: false, countHolidays: false }) === 1);
check('off Saturday alone, countWeekends:true => 0 (calendar governs, Sundays-only switch)',
  countWorkingDaysInRange(leaveSat, leaveSat, ALT, [], { countWeekends: true, countHolidays: false }) === 0);

const friOf = (sat) => { const d = new Date(sat + 'T00:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const monOf = (sat) => { const d = new Date(sat + 'T00:00:00'); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); };
check('Fri→Mon with working Saturday => 3',
  countWorkingDaysInRange(friOf(workSat), monOf(workSat), ALT, [], { countWeekends: false, countHolidays: false }) === 3);
check('Fri→Mon with off Saturday => 2',
  countWorkingDaysInRange(friOf(leaveSat), monOf(leaveSat), ALT, [hol(leaveSat)], { countWeekends: false, countHolidays: false }) === 2);
check('Fri→Mon with overridden Saturday => 3',
  countWorkingDaysInRange(friOf(leaveSat), monOf(leaveSat), ALT, [hol(leaveSat, true)], { countWeekends: false, countHolidays: false }) === 3);
check('override counts even when countHolidays:false',
  countWorkingDaysInRange(leaveSat, leaveSat, ALT, [hol(leaveSat, true)], { countWeekends: false, countHolidays: false }) === 1);

// ── 4. classifyCalendarDate ────────────────────────────────────────────────
section('classifyCalendarDate');

const hs = new Set([leaveSat]);
const os = new Set([leaveSat]);
check('override set => working', classifyCalendarDate(leaveSat, ALT, hs, os) === 'working');
check('holiday set, no override => holiday', classifyCalendarDate(leaveSat, ALT, hs, new Set()) === 'holiday');
check('Sunday + override => weekly_off', classifyCalendarDate(sunday, ALT, new Set([sunday]), new Set([sunday])) === 'weekly_off');

// ── 5. Paid split with restored availability ───────────────────────────────
section('recomputePaidSplit');

const paidCfg = { isPaid: true, maxUsagePerPeriod: 0, usagePeriod: 'annual' };
const bal = { cycleStart: new Date(2026, 0, 1) };
const r1 = recomputePaidSplit(paidCfg, { allocated: 10, carriedForward: 0, used: 0, pending: 0 }, bal, 3, '2026-09-04', 0);
check('ample balance => fully paid', r1.paidDays === 3 && r1.unpaidDays === 0, `got ${JSON.stringify(r1)}`);
const r2 = recomputePaidSplit(paidCfg, { allocated: 10, carriedForward: 0, used: 8, pending: 0 }, bal, 5, '2026-09-04', 0);
check('capped balance => split paid/unpaid', r2.paidDays === 2 && r2.unpaidDays === 3, `got ${JSON.stringify(r2)}`);
const r3 = recomputePaidSplit(paidCfg, { allocated: 5, carriedForward: 0, used: 4, pending: 0 }, bal, 3, '2026-09-04', 2);
check('own prior usage restored (5-4+2=3 => fully paid)', r3.paidDays === 3 && r3.unpaidDays === 0, `got ${JSON.stringify(r3)}`);
const r4 = recomputePaidSplit({ isPaid: false }, { allocated: 0, carriedForward: 0, used: 0, pending: 0 }, bal, 3, '2026-09-04', 0);
check('unpaid type => 0 paid, all unpaid', r4.paidDays === 0 && r4.unpaidDays === 3, `got ${JSON.stringify(r4)}`);

// ── 6. Period-usage delta ──────────────────────────────────────────────────
section('adjustPeriodUsage');

const mkEntry = () => ({ allocated: 10, used: 0, pending: 0, periodUsage: [] });
const e1 = mkEntry();
adjustPeriodUsage(e1, 'monthly', new Date(2026, 0, 1), '2026-08-31', '2026-09-01', 2);
const m7 = e1.periodUsage.find(p => p.period === 'M7');
const m8 = e1.periodUsage.find(p => p.period === 'M8');
check('cross-month +2 splits 1/1', m7?.used === 1 && m8?.used === 1, `got ${JSON.stringify(e1.periodUsage)}`);
adjustPeriodUsage(e1, 'monthly', new Date(2026, 0, 1), '2026-08-31', '2026-09-01', -2);
check('symmetric -2 returns to zero', (m7?.used ?? -1) === 0 && (m8?.used ?? -1) === 0,
  `got ${JSON.stringify(e1.periodUsage)}`);
adjustPeriodUsage(e1, 'monthly', new Date(2026, 0, 1), '2026-08-31', '2026-09-01', -5);
check('over-removal clamps at 0, never negative',
  e1.periodUsage.every(p => p.used >= 0), `got ${JSON.stringify(e1.periodUsage)}`);
const e2 = mkEntry();
const skippedOut = adjustPeriodUsage(e2, 'monthly', new Date(2026, 0, 1), '2026-09-04', '2026-09-05', -2);
check('negative delta with no existing row invents nothing',
  e2.periodUsage.length === 0 && skippedOut.every(o => o.skipped), `got ${JSON.stringify(e2.periodUsage)}`);
// Parity with the live recording path for positive deltas.
const e3 = mkEntry();
const e4 = mkEntry();
adjustPeriodUsage(e3, 'monthly', new Date(2026, 0, 1), '2026-08-31', '2026-09-01', 3);
recordPeriodUsageSplit(e4, 'monthly', new Date(2026, 0, 1), '2026-08-31', '2026-09-01', 3, {});
check('matches recordPeriodUsageSplit distribution',
  JSON.stringify(e3.periodUsage) === JSON.stringify(e4.periodUsage),
  `got ${JSON.stringify(e3.periodUsage)} vs ${JSON.stringify(e4.periodUsage)}`);

// ── 7. Saturday gate ───────────────────────────────────────────────────────
section('assertSaturdayDate');

let threw = false;
try { assertSaturdayDate(leaveSat); } catch { threw = true; }
check('real Saturday passes', threw === false);
const badDates = [sunday, '2026-09-04', 'not-a-date', '', null];
let allThrow = true;
for (const d of badDates) { try { assertSaturdayDate(d); allThrow = false; } catch (e) { if (e?.statusCode !== 400) allThrow = false; } }
check('Sunday/weekday/malformed all throw 400', allThrow === true);

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(52)}`);
console.log(`Passed: ${pass}   Failed: ${fail}   Total: ${pass + fail}`);
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
