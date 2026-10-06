/**
 * Report-only detector: approved/pending FULL-DAY or HALF-DAY leaves whose
 * date range contains an approved/pending permission request for the same
 * employee. No writes.
 *
 * Usage:
 *   node scripts/report-leave-permission-overlaps.mjs
 *   node scripts/report-leave-permission-overlaps.mjs --name stephen
 */
import mongoose from 'mongoose';
import fs from 'node:fs';

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const m = fs.readFileSync('.env.local', 'utf8').match(/^MONGODB_URI=(.*)$/m);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const NAME = (argOf('--name') || '').toLowerCase();

await mongoose.connect(loadUri());
const db = mongoose.connection.db;

const users = await db.collection('users').find(NAME ? { name: new RegExp(NAME, 'i') } : {}).toArray();
console.log(`Users scanned: ${users.length}`);
const byProfile = new Map();
const byIdentity = new Map();
const byAuth = new Map();
for (const u of users) {
  if (u.profileId) byProfile.set(String(u.profileId), u);
  if (u.identityId) byIdentity.set(String(u.identityId), u);
  byAuth.set(String(u._id), u);
}
const ownerOf = (r) => {
  if (r.profileId && byProfile.has(String(r.profileId))) return byProfile.get(String(r.profileId));
  if (r.identityId && byIdentity.has(String(r.identityId))) return byIdentity.get(String(r.identityId));
  return null;
};

const leaves = await db.collection('leaves').find({ status: { $in: ['approved', 'pending'] } }).toArray();
const perms = await db.collection('self_service_requests').find({ requestType: 'permission', status: { $in: ['approved', 'pending'] } }).toArray();

let hits = 0;
for (const lv of leaves) {
  const owner = byAuth.get(String(lv.userId));
  if (!owner) continue;
  if (NAME && !owner.name.toLowerCase().includes(NAME)) continue;
  for (const p of perms) {
    const pOwner = ownerOf(p);
    if (!pOwner || String(pOwner._id) !== String(owner._id)) continue;
    const d = p.payload?.date;
    if (!d || d < lv.from || d > lv.to) continue;
    hits++;
    const att = await db.collection('attendances').findOne(
      { userId: owner._id, date: d },
      { projection: { clockIn: 1, clockOut: 1, status: 1, lateFlag: 1, permission: 1 } },
    );
    console.log([
      `HIT ${owner.name} date=${d}`,
      `leave=${lv.status}${lv.halfDay ? '(half)' : '(full)'} ${lv.from}..${lv.to} type=${lv.typeCode || lv.type}`,
      `perm=${p.status} ${p.payload?.startTime}-${p.payload?.endTime} granted=${p.payload?.duration}m used=${p.payload?.usedDuration ?? '-'}`,
      `att=${att ? `${att.status} in=${att.clockIn || '-'} out=${att.clockOut || '-'} permApplied=${att.permission?.applied ?? '-'}` : 'no-row'}`,
    ].join(' | '));
  }
}
console.log(`\nOverlaps found: ${hits}. No writes were made.`);
await mongoose.disconnect();
