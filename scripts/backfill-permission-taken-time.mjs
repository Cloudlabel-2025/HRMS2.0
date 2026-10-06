/**
 * Rewrite CLOSED work-progress permission rows of APPLIED arrival-cover
 * permissions to record TAKEN time (window-start -> actual clock-in) instead
 * of window-start -> close-time (e.g. 10:00-19:17 = 557m for 15m taken).
 *
 * Also clears stale row-level endedLate/overrunMins on applied rows — closing
 * an applied cover late in the day is never an overrun.
 *
 * Only completed rows (endTime set) are touched; open rows are left for the
 * live flow. Idempotent: re-running reports 0 changes once converged.
 *
 * Usage:
 *   node scripts/backfill-permission-taken-time.mjs           # dry run
 *   node scripts/backfill-permission-taken-time.mjs --apply
 */
import mongoose from 'mongoose';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const m = fs.readFileSync('.env.local', 'utf8').match(/^MONGODB_URI=(.*)$/m);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const toMins = (t) => {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const diffMins = (s, e) => {
  const a = toMins(s), b = toMins(e);
  if (a === null || b === null) return null;
  if (b >= a) return b - a;
  return b + 1440 - a;
};

await mongoose.connect(loadUri());
const db = mongoose.connection.db;
const coll = db.collection('attendances');
const users = db.collection('users');

const rows = await coll.find({ 'permission.applied': true }).toArray();
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}   applied-permission rows scanned: ${rows.length}`);

let changed = 0;
let skippedOpen = 0;
const samples = [];

for (const r of rows) {
  const perm = r.permission || {};
  const wp = Array.isArray(r.workProgress) ? r.workProgress : [];
  const reqId = perm.requestId ? String(perm.requestId) : null;
  let idx = reqId ? wp.findIndex((w) => w?.type === 'permission' && String(w.permissionRequestId || '') === reqId) : -1;
  if (idx === -1) idx = wp.findIndex((w) => w?.type === 'permission');
  if (idx === -1) continue;
  const row = wp[idx];
  if (!row.endTime) { skippedOpen++; continue; } // live flow owns open rows

  const s = toMins(perm.startTime);
  const a = toMins(perm.actualClockIn);
  const rowEnd = (a !== null && s !== null && a >= s) ? perm.actualClockIn : perm.endTime;
  const dur = diffMins(perm.startTime, rowEnd);
  const label = dur !== null ? `Permission (${perm.startTime}-${perm.endTime}) · taken ${dur}m` : null;

  const needsFix = row.endTime !== rowEnd
    || row.duration !== dur
    || row.endedLate === true
    || (row.overrunMins !== null && row.overrunMins !== undefined)
    || (label && row.taskDetails !== label);
  if (!needsFix) continue;

  changed++;
  if (samples.length < 25) {
    const u = await users.findOne({ _id: r.userId }, { projection: { name: 1 } });
    samples.push(`  ${r.date} ${u?.name || r.userId} row ${row.startTime}->${row.endTime} (${row.duration}m) -> ${perm.startTime}->${rowEnd} (${dur}m)`);
  }
  if (!APPLY) continue;

  const next = [...wp];
  next[idx] = {
    ...row,
    endTime: rowEnd,
    status: 'completed',
    duration: dur,
    taskDetails: label || row.taskDetails,
    endedLate: false,
    overrunMins: null,
  };
  const set = { workProgress: next };
  if (perm.endedLate === true) {
    set['permission.endedLate'] = false;
    set['permission.endedLateMins'] = 0;
  }
  await coll.updateOne({ _id: r._id }, { $set: set });
}

console.log(`Changed: ${changed}   skipped (row still open): ${skippedOpen}`);
if (samples.length) {
  console.log('\nSample changes:');
  samples.forEach((s) => console.log(s));
  if (changed > samples.length) console.log(`  ... and ${changed - samples.length} more`);
}
console.log(APPLY ? '\nApplied.' : '\nDry run - no writes. Re-run with --apply to commit.');
await mongoose.disconnect();
