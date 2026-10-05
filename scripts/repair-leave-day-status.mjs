// Targeted repair: restore approved full-day leave days whose attendance
// row was flipped to late/present/absent (e.g. by clocking in on the leave).
// Dry-run by default — pass --apply to write. After repairing, re-run the
// payroll cycle for the affected month so LOP is recomputed.
//
// Usage:
//   MONGODB_URI="..." node scripts/repair-leave-day-status.mjs --email=jeya@example.com --date=2026-08-26 [--apply]
//   MONGODB_URI="..." node scripts/repair-leave-day-status.mjs --userId=<id> --from=2026-08-01 --to=2026-08-31 [--apply]
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; })
);
const apply = args.apply === true || args.apply === 'true';

function eachDateStr(a, b) {
  const out = [];
  for (let d = new Date(a + 'T00:00:00'); d <= new Date(b + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return out;
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  let userId = args.userId || null;
  if (!userId && args.email) {
    const u = await db.collection('users').findOne({ email: args.email });
    if (!u) { console.error(`No user with email ${args.email}`); process.exit(1); }
    userId = u._id;
  }
  if (!userId) { console.error('Provide --userId or --email.'); process.exit(1); }
  const from = args.date || args.from;
  const to = args.date || args.to || args.from;
  if (!from || !to) { console.error('Provide --date or --from/--to (YYYY-MM-DD).'); process.exit(1); }

  const userOid = new mongoose.Types.ObjectId(userId);
  const leaves = await db.collection('leaves').find({
    userId: userOid, status: 'approved', halfDay: { $ne: true },
    from: { $lte: to }, to: { $gte: from },
  }).toArray();
  if (!leaves.length) { console.log('No approved full-day leave covering that range. Nothing to do.'); await mongoose.disconnect(); return; }

  const coverDates = new Set();
  const coverByDate = new Map();
  for (const l of leaves) {
    const s = l.from < from ? from : l.from;
    const e = l.to > to ? to : l.to;
    for (const d of eachDateStr(s, e)) { coverDates.add(d); coverByDate.set(d, l); }
  }

  const rows = await db.collection('attendances').find({ userId: userOid, date: { $in: [...coverDates] } }).toArray();
  let fixed = 0;
  for (const r of rows) {
    const cover = coverByDate.get(r.date);
    if (!cover || r.status === 'leave') continue;
    // Admin-approved overrides (genuinely worked) are respected, never healed.
    if (r.leaveOverride?.status === 'approved') {
      console.log(`- ${r.date}: skipped (admin-approved override to ${r.status})`);
      continue;
    }
    console.log(`- ${r.date}: ${r.status}${r.clockIn ? ` (clockIn ${r.clockIn})` : ''} late=${!!r.lateFlag} -> leave [${cover.typeCode || cover.type}]`);
    if (apply) {
      await db.collection('attendances').updateOne(
        { _id: r._id },
        { $set: { status: 'leave', lateFlag: false, halfDayThresholdExceeded: false, relatedLeaveId: cover._id, approvedHalfDayLeave: false } }
      );
      fixed++;
    }
  }

  if (!apply) {
    console.log('\nDry-run: no writes. Re-run with --apply to repair, then re-run payroll for the affected month.');
  } else {
    console.log(`\nRepaired ${fixed} row(s). Next: re-run payroll for the affected month (reopen + force re-run) so LOP is recomputed.`);
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(2); });
