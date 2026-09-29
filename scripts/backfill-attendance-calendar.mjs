/**
 * Backfill the attendance register from the working-day calendar.
 *
 * For every active employee, inserts the missing Attendance rows over a
 * payroll cycle range:
 *   - elapsed working day with no row and no approved leave -> status 'absent'
 *   - holiday / weekly-off date with no row                  -> status 'holiday'
 *   - elapsed working day covered by approved leave          -> status 'leave'|'half_day'
 *
 * Mirrors src/lib/attendance-sync.js semantics (calendar-authoritative).
 * Insert-only: never touches existing rows. Reconciliation of stale rows
 * (deleted holidays etc.) happens in the payroll run / daily sweep.
 *
 * Usage:
 *   node scripts/backfill-attendance-calendar.mjs --month=2026-09        (dry run)
 *   node scripts/backfill-attendance-calendar.mjs --month=2026-09 --apply
 *   node scripts/backfill-attendance-calendar.mjs --from=2026-08-26 --to=2026-09-25 --apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
if (!process.env.MONGODB_URI) dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set (.env.local).');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(=(.*))?$/);
    return m ? [m[1], m[3] ?? true] : [a, true];
  })
);
const APPLY = args.apply === true || args.apply === 'true';
const MONTH = typeof args.month === 'string' ? args.month : null;

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function eachDate(from, to) {
  const out = [];
  for (let c = new Date(`${from}T00:00:00`), e = new Date(`${to}T00:00:00`); c <= e; c.setDate(c.getDate() + 1)) out.push(fmt(c));
  return out;
}
function getPayrollDayNumber(value, def) {
  if (value === null || value === undefined || value === '') return def;
  const num = Number(value);
  if (!Number.isNaN(num) && num >= 1 && num <= 31) return num;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return Number(String(value).split('-')[2]);
  return def;
}
// 1st & 3rd Saturdays counted from the payroll cycle start are off (alternate mode).
function isSaturdayOff(dateStr, startDay) {
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() !== 6) return false;
  const day = d.getDate();
  const cyc = day >= startDay
    ? { y: d.getFullYear(), m: d.getMonth() }
    : (() => { const p = new Date(d.getFullYear(), d.getMonth(), 1); p.setMonth(p.getMonth() - 1); return { y: p.getFullYear(), m: p.getMonth() }; })();
  const cycleStart = new Date(cyc.y, cyc.m, startDay);
  let n = 0;
  for (let dt = new Date(cycleStart); dt <= d; dt.setDate(dt.getDate() + 1)) if (dt.getDay() === 6) n++;
  return n === 1 || n === 3;
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const gc = await db.collection('systemconfigs').findOne({ key: 'global_config' });
  const config = gc?.value || {};
  const startDay = getPayrollDayNumber(config.payrollStartDay, 26);
  const endDay = getPayrollDayNumber(config.payrollEndDay, 25);
  const satMode = String(config.saturdayWorking ?? 'alternate').toLowerCase();

  const now = new Date();
  const todayStr = fmt(now);
  let ranges = [];
  if (args.from && args.to) {
    ranges = [{ fromDate: args.from, toDate: args.to, label: `${args.from}..${args.to}` }];
  } else {
    const base = MONTH || todayStr.slice(0, 7);
    const [by, bm] = base.split('-').map(Number);
    // Current + previous payroll cycle (same coverage as the daily sweep).
    for (const shift of [-1, 0]) {
      const ref = new Date(by, bm - 1 + shift, 1);
      const y = ref.getFullYear(), m = ref.getMonth();
      const prevM = m === 0 ? 11 : m - 1, prevY = m === 0 ? y - 1 : y;
      ranges.push({
        fromDate: `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`,
        toDate: `${y}-${String(m + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
        label: `${y}-${String(m + 1).padStart(2, '0')}`,
      });
    }
  }

  const users = await db.collection('users').find({ status: 'active', role: { $ne: 'super_admin' } }).project({ _id: 1, createdAt: 1 }).toArray();
  console.log(`Employees: ${users.length} | mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} (pass --apply to write)`);

  // Employment-start guard (same rule as src/lib/attendance-sync.js):
  // never materialise rows before the employee existed.
  const fmtUTC = (d) => { const n = new Date(d); return n.getUTCFullYear() + '-' + String(n.getUTCMonth() + 1).padStart(2, '0') + '-' + String(n.getUTCDate()).padStart(2, '0'); };
  const firstClocks = await db.collection('attendances').aggregate([
    { $match: { userId: { $in: users.map(u => u._id) }, clockIn: { $ne: null } } },
    { $group: { _id: '$userId', first: { $min: '$date' } } },
  ]).toArray();
  const firstByUser = new Map(firstClocks.map(r => [String(r._id), r.first]));
  const startByUser = new Map();
  for (const u of users) {
    const cands = [u.createdAt ? fmtUTC(u.createdAt) : null, firstByUser.get(String(u._id)) || null].filter(Boolean);
    if (cands.length) startByUser.set(String(u._id), cands.sort()[0]);
  }

  let totAbsent = 0, totHoliday = 0, totLeave = 0;
  for (const { fromDate, toDate, label } of ranges) {
    const holidays = await db.collection('holidays').find({ date: { $gte: fromDate, $lte: toDate } }).project({ date: 1 }).toArray();
    const holidaySet = new Set(holidays.map(h => h.date));
    const classify = (d) => {
      if (holidaySet.has(d)) return 'holiday';
      const dow = new Date(d + 'T00:00:00').getDay();
      if (dow === 0) return 'weekly_off';
      if (dow === 6) {
        if (satMode === 'none') return 'weekly_off';
        if (satMode === 'alternate' && isSaturdayOff(d, startDay)) return 'weekly_off';
      }
      return 'working';
    };
    const dates = eachDate(fromDate, toDate).filter(d => d <= todayStr);
    const bulk = [];
    let rAbsent = 0, rHoliday = 0, rLeave = 0;

    for (const u of users) {
      const [rows, leaves] = await Promise.all([
        db.collection('attendances').find({ userId: u._id, date: { $gte: fromDate, $lte: toDate } }).project({ date: 1 }).toArray(),
        db.collection('leaves').find({ userId: u._id, status: 'approved', from: { $lte: toDate }, to: { $gte: fromDate } }).project({ from: 1, to: 1, halfDay: 1, _id: 1 }).toArray(),
      ]);
      const have = new Set(rows.map(r => r.date));
      const leaveByDate = new Map();
      for (const l of leaves) {
        const s = l.from < fromDate ? fromDate : l.from;
        const e = l.to > toDate ? toDate : l.to;
        for (const d of eachDate(s, e)) if (!leaveByDate.has(d)) leaveByDate.set(d, l);
      }
      for (const d of dates) {
        if (have.has(d)) continue;
        const startDate = startByUser.get(String(u._id));
        if (startDate && d < startDate) continue; // pre-joining: never materialise
        const kind = classify(d);
        if (kind !== 'working') {
          bulk.push({ updateOne: { filter: { userId: u._id, date: d }, update: { $set: { status: 'holiday', nonWorkingDayType: kind }, $setOnInsert: { userId: u._id, date: d } }, upsert: true } });
          rHoliday++;
        } else if (leaveByDate.has(d)) {
          const lv = leaveByDate.get(d);
          bulk.push({ updateOne: { filter: { userId: u._id, date: d }, update: { $set: { status: lv.halfDay ? 'half_day' : 'leave', relatedLeaveId: lv._id, approvedHalfDayLeave: !!lv.halfDay, nonWorkingDayType: 'none' }, $setOnInsert: { userId: u._id, date: d } }, upsert: true } });
          rLeave++;
        } else {
          bulk.push({ updateOne: { filter: { userId: u._id, date: d }, update: { $set: { status: 'absent', absenceReason: 'No clock-in', nonWorkingDayType: 'none', absentMarkedAt: now, absentSource: 'system' }, $setOnInsert: { userId: u._id, date: d } }, upsert: true } });
          rAbsent++;
        }
      }
    }

    console.log(`Cycle ${label} (${fromDate}..${toDate}): missing absent=${rAbsent} holiday=${rHoliday} leave=${rLeave}`);
    totAbsent += rAbsent; totHoliday += rHoliday; totLeave += rLeave;
    if (APPLY && bulk.length) {
      const res = await db.collection('attendances').bulkWrite(bulk, { ordered: false });
      console.log(`  wrote: upserted=${res.upsertedCount} modified=${res.modifiedCount}`);
    }
  }

  console.log(`TOTAL missing: absent=${totAbsent} holiday=${totHoliday} leave=${totLeave}${APPLY ? ' (written)' : ' (dry run — nothing written)'}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error('Backfill failed:', e?.message || e); process.exit(1); });
