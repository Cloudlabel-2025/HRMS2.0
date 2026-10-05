// Report-only audit: approved full-day leave days whose attendance row is
// NOT labelled leave (late/present/absent with or without a clock-in).
// Catches recurrences of the "worked-on-leave became late + LOP" bug
// WITHOUT writing anything. Review output before repairing (see
// scripts/repair-leave-day-status.mjs) and re-running payroll.
//
// Usage: MONGODB_URI="..." node scripts/report-leave-status-anomalies.mjs [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
// Defaults to the current calendar month. Exit code 1 when mismatches exist.
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; })
);
const now = new Date();
const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const from = args.from || monthStart;
const to = args.to || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

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

  const leaves = await db.collection('leaves').find({
    status: 'approved',
    halfDay: { $ne: true },
    from: { $lte: to },
    to: { $gte: from },
  }).project({ userId: 1, type: 1, typeCode: 1, from: 1, to: 1 }).toArray();

  const coverByUserDate = new Map(); // `${userId}|${date}` -> leave
  for (const l of leaves) {
    const s = l.from < from ? from : l.from;
    const e = l.to > to ? to : l.to;
    for (const d of eachDateStr(s, e)) coverByUserDate.set(`${String(l.userId)}|${d}`, l);
  }

  const rows = await db.collection('attendances').find({
    date: { $gte: from, $lte: to },
  }).project({ userId: 1, date: 1, status: 1, clockIn: 1, clockOut: 1, lateFlag: 1, relatedLeaveId: 1 }).toArray();

  const bad = [];
  for (const r of rows) {
    const cover = coverByUserDate.get(`${String(r.userId)}|${r.date}`);
    if (!cover) continue;
    if (r.status === 'leave') continue;
    bad.push({ userId: r.userId, date: r.date, status: r.status, clockIn: r.clockIn || null, clockOut: r.clockOut || null, lateFlag: !!r.lateFlag, leave: `${cover.typeCode || cover.type || ''} ${cover.from}..${cover.to}` });
  }

  // Orphan check: rows pointing at a leave that no longer covers them.
  const orphans = [];
  for (const r of rows) {
    if (!r.relatedLeaveId) continue;
    if (coverByUserDate.get(`${String(r.userId)}|${r.date}`)) continue;
    orphans.push({ userId: r.userId, date: r.date, status: r.status, relatedLeaveId: String(r.relatedLeaveId) });
  }

  if (!bad.length && !orphans.length) {
    console.log(`No leave-status anomalies in ${from}..${to} (${leaves.length} approved full-day leaves checked).`);
  } else {
    const users = await db.collection('users').find({ _id: { $in: [...new Set([...bad, ...orphans].map(b => b.userId))] } }).project({ name: 1 }).toArray().catch(() => []);
    const nameOf = new Map(users.map(u => [String(u._id), u.name]));
    console.log(`\n=== MISMATCHED LEAVE DAYS (${bad.length}) in ${from}..${to} ===`);
    for (const b of bad) console.log(`- ${b.date} ${nameOf.get(String(b.userId)) || b.userId} status=${b.status} clockIn=${b.clockIn || '—'} late=${b.lateFlag} leave=[${b.leave}]`);
    if (orphans.length) {
      console.log(`\n=== ORPHAN relatedLeaveId ROWS (${orphans.length}) ===`);
      for (const o of orphans) console.log(`- ${o.date} ${nameOf.get(String(o.userId)) || o.userId} status=${o.status} relatedLeaveId=${o.relatedLeaveId}`);
    }
  }

  await mongoose.disconnect();
  process.exit(bad.length || orphans.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
