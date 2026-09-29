/**
 * Remove phantom attendance rows dated before the employee joined.
 *
 * Early backfill runs wrote absent/holiday rows for dates before each user's
 * employment start (account creation / first clock-in). Those rows pollute
 * the team report and must go. Only touches non-clocked absent/holiday rows;
 * real clock-ins and leave-linked rows are never deleted.
 *
 * Usage:
 *   node scripts/clean-prejoining-rows.mjs            (dry run)
 *   node scripts/clean-prejoining-rows.mjs --apply
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

const APPLY = process.argv.includes('--apply');
const fmtUTC = (d) => { const n = new Date(d); return n.getUTCFullYear() + '-' + String(n.getUTCMonth() + 1).padStart(2, '0') + '-' + String(n.getUTCDate()).padStart(2, '0'); };

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({ status: 'active', role: { $ne: 'super_admin' } }).project({ name: 1, createdAt: 1 }).toArray();
  const firstClocks = await db.collection('attendances').aggregate([
    { $match: { userId: { $in: users.map(u => u._id) }, clockIn: { $ne: null } } },
    { $group: { _id: '$userId', first: { $min: '$date' } } },
  ]).toArray();
  const firstByUser = new Map(firstClocks.map(r => [String(r._id), r.first]));

  console.log(`Employees: ${users.length} | mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} (pass --apply to delete)`);
  let total = 0;
  for (const u of users) {
    const cands = [u.createdAt ? fmtUTC(u.createdAt) : null, firstByUser.get(String(u._id)) || null].filter(Boolean);
    if (!cands.length) { console.log(`- ${u.name}: no start date resolvable, skipped`); continue; }
    const start = cands.sort()[0];
    const bad = await db.collection('attendances').find({
      userId: u._id,
      date: { $lt: start },
      status: { $in: ['absent', 'holiday'] },
      clockIn: null,
      relatedLeaveId: null,
      approvedHalfDayLeave: { $ne: true },
    }).project({ date: 1, status: 1 }).sort({ date: 1 }).toArray();
    if (!bad.length) continue;
    const dates = bad.map(r => r.date);
    console.log(`- ${u.name} (start ${start}): ${bad.length} phantom rows [${dates[0]}..${dates[dates.length - 1]}]`);
    total += bad.length;
    if (APPLY) {
      const res = await db.collection('attendances').deleteMany({ _id: { $in: bad.map(r => r._id) } });
      console.log(`  deleted: ${res.deletedCount}`);
    }
  }
  console.log(`TOTAL phantom rows: ${total}${APPLY ? ' (deleted)' : ' (dry run — nothing deleted)'}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error('Cleanup failed:', e?.message || e); process.exit(1); });
