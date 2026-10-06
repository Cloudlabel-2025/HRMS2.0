/**
 * Clear bogus `endedLate` overruns on APPLIED arrival-cover permissions.
 *
 * An applied permission already fulfilled its purpose at clock-in (arrival
 * inside the window). Closing it later in the day (e.g. at clock-out) was
 * recorded as a +N minute overrun, which forces every surface (Team report,
 * monthly table, monitoring) to show the day as Late even though
 * status=present / lateFlag=false.
 *
 * Usage:
 *   node scripts/fix-applied-permission-overrun.mjs           # dry run
 *   node scripts/fix-applied-permission-overrun.mjs --apply
 */
import mongoose from 'mongoose';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const m = fs.readFileSync('.env.local', 'utf8').match(/^MONGODB_URI=(.*)$/m);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

await mongoose.connect(loadUri());
const db = mongoose.connection.db;
const coll = db.collection('attendances');

const rows = await coll.find({ 'permission.applied': true, 'permission.endedLate': true }).toArray();
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}   applied+endedLate rows: ${rows.length}`);

let fixed = 0;
for (const r of rows) {
  const name = await db.collection('users').findOne({ _id: r.userId }, { projection: { name: 1 } });
  console.log(`  ${r.date} ${name?.name || r.userId} clockIn=${r.clockIn} perm=${r.permission?.startTime}-${r.permission?.endTime} endedAt=${r.permission?.endedAt} overrun=${r.permission?.endedLateMins}m status=${r.status}`);
  if (!APPLY) continue;
  const wp = Array.isArray(r.workProgress) ? r.workProgress.map((w) => {
    if (w?.type === 'permission' && String(w.permissionRequestId || '') === String(r.permission?.requestId || '')) {
      const next = { ...w, endedLate: false, overrunMins: null };
      if (typeof next.taskDetails === 'string') {
        next.taskDetails = next.taskDetails.replace(/ · ended .* \(\+\d+m over\)/, '');
      }
      return next;
    }
    return w;
  }) : r.workProgress;
  await coll.updateOne(
    { _id: r._id },
    { $set: { 'permission.endedLate': false, 'permission.endedLateMins': 0, workProgress: wp } },
  );
  fixed++;
}

console.log(APPLY ? `Fixed: ${fixed}` : 'Dry run - no writes. Re-run with --apply to commit.');
await mongoose.disconnect();
