// Recompute baseHoursWorked / hoursWorked / payableHours for historical
// attendance rows from each row's frozen shift snapshot — the same formula
// the live clock-out paths use since the 8-hour rule was removed:
//
//   gross   = shift window (shiftStartTime -> shiftEndTime), wrap-aware
//   permM   = approved permission minutes before clockIn (else 0)
//   base    = max(0, clockOut - clockIn + permM)
//   hours   = max(0, base - breakDeduction)
//   payable = min(gross, hours)
//
// Skips rows that must never be touched:
//  - no clockIn/clockOut (nothing to recompute from);
//  - no frozen shiftStartTime/shiftEndTime (no window to judge by);
//  - an approved AttendanceRegularization exists for the user+date
//    (an admin correction — recomputing would overwrite manual work).
//
// Read-only by default. Pass --apply to write.
//
// Usage:
//   MONGODB_URI="..." node scripts/backfill-attendance-hours.mjs [--apply] [--userId=...] [--date=YYYY-MM-DD] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const argVal = (name) => {
  const p = process.argv.find(a => a.startsWith(name + '='));
  return p ? p.slice(name.length + 1) : null;
};
const ONLY_USER = argVal('--userId');
const ONLY_DATE = argVal('--date');
const FROM = argVal('--from');
const TO = argVal('--to');

function toMins(t) {
  if (typeof t !== 'string') return null;
  const m = t.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function diffMins(start, end) {
  const s = toMins(start), e = toMins(end);
  if (s === null || e === null) return null;
  let d = e - s;
  if (d <= 0) d += 1440;
  return d;
}

function preClockInPermissionMins(perm, clockIn) {
  const s = toMins(perm?.startTime);
  const e = toMins(perm?.endTime);
  const c = toMins(clockIn);
  if (s === null || e === null || c === null) return 0;
  if (e > s) return Math.max(0, Math.min(c, e) - s);
  if (c > e && c < s) return 0;
  const cc = c < s ? c + 1440 : c;
  return Math.max(0, Math.min(cc - s, (e + 1440) - s));
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const attendance = db.collection('attendances');

  const q = { clockIn: { $ne: null }, clockOut: { $ne: null } };
  if (ONLY_USER) q.userId = new mongoose.Types.ObjectId(ONLY_USER);
  if (ONLY_DATE) q.date = ONLY_DATE;
  else {
    if (FROM) q.date = { ...(q.date || {}), $gte: FROM };
    if (TO) q.date = { ...(q.date || {}), $lte: TO };
  }
  const records = await attendance.find(q).toArray();

  // Approved regularizations (separate collection) — never overwrite those.
  const regs = await db.collection('attendanceregularizations')
    .find({ status: 'approved' }, { projection: { userId: 1, date: 1 } }).toArray()
    .catch(() => []);
  const regSet = new Set(regs.map(r => `${r.userId}|${r.date}`));

  console.log(`Closed records scanned: ${records.length}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  let updated = 0, skippedReg = 0, skippedNoShift = 0, unchanged = 0;

  for (const rec of records) {
    if (regSet.has(`${rec.userId}|${rec.date}`)) { skippedReg++; continue; }
    const gross = diffMins(rec.shiftStartTime, rec.shiftEndTime);
    if (gross === null || gross <= 0) { skippedNoShift++; continue; }
    const clockSpan = diffMins(rec.clockIn, rec.clockOut);
    if (clockSpan === null) { skippedNoShift++; continue; }
    const permM = preClockInPermissionMins(rec.permission, rec.clockIn);
    const base = Math.max(0, clockSpan + permM);
    const hours = Math.max(0, base - (Number(rec.breakDeduction) || 0));
    const payable = Math.min(gross, hours);
    if (rec.baseHoursWorked === base && rec.hoursWorked === hours && rec.payableHours === payable) {
      unchanged++;
      continue;
    }
    console.log(`\n- user=${rec.userId} date=${rec.date} clockIn=${rec.clockIn} clockOut=${rec.clockOut} shift=${rec.shiftStartTime}-${rec.shiftEndTime}`);
    console.log(`    base: ${rec.baseHoursWorked ?? 0} -> ${base}   hours: ${rec.hoursWorked ?? 0} -> ${hours}   payable: ${rec.payableHours ?? 0} -> ${payable}${permM > 0 ? `   (incl. ${permM}m pre-clock-in permission)` : ''}`);
    if (APPLY) {
      await attendance.updateOne(
        { _id: rec._id },
        { $set: { baseHoursWorked: base, hoursWorked: hours, payableHours: payable } }
      );
      updated++;
    }
  }

  console.log(`\nDone. Scanned: ${records.length}  ${APPLY ? 'updated: ' + updated : 'that WOULD update (re-run with --apply)'}  unchanged: ${unchanged}  skipped (approved regularization): ${skippedReg}  skipped (no shift snapshot): ${skippedNoShift}.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
