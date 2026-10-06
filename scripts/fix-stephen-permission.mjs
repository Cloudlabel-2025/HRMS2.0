/**
 * One-off: revert Stephen Praveen A's unused approved permission of
 * 2026-09-28 (10:00-12:00, 120m). He never clocked in that day (absent), so
 * the 120 minutes stayed consumed from his monthly allowance for nothing.
 * Cancels the request (allowance auto-refunds: usage counts only
 * approved/pending), drops the unworked attendance mirror, and notifies him
 * plus every active super_admin / admin_full.
 *
 * Usage:
 *   node scripts/fix-stephen-permission.mjs           # dry run
 *   node scripts/fix-stephen-permission.mjs --apply
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

const DATE = '2026-09-28';
let req = await db.collection('self_service_requests').findOne({
  requestType: 'permission',
  status: { $in: ['approved', 'pending'] },
  'payload.date': DATE,
  profileId: new mongoose.Types.ObjectId('6a4d941ee24a8defc8412f96'),
});
let notifyOnly = false;
if (!req) {
  // Already cancelled by an earlier run that died before notifying — pick up
  // the cancelled request so recipients still get told.
  req = await db.collection('self_service_requests').findOne({
    requestType: 'permission',
    status: 'cancelled',
    'payload.date': DATE,
    profileId: new mongoose.Types.ObjectId('6a4d941ee24a8defc8412f96'),
  });
  if (!req) {
    console.log('No approved/pending permission for Stephen on 2026-09-28. Nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }
  notifyOnly = true;
}

const granted = Number(req.payload?.duration || 0) || 0;
const used = req.payload?.usedDuration;
const refunded = req.status === 'approved' ? (used === null || used === undefined ? granted : Number(used) || 0) : granted;
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`  request ${req._id} status=${req.status} window=${req.payload?.startTime}-${req.payload?.endTime} granted=${granted}m -> refund ${refunded}m`);

const att = await db.collection('attendances').findOne({
  userId: new mongoose.Types.ObjectId('6a4d941ce24a8defc8412f93'),
  date: DATE,
});
console.log(`  attendance: ${att ? `status=${att.status} clockIn=${att.clockIn || '-'} permSubdoc=${!!(att.permission?.requestId || att.permission?.startTime)}` : 'no row'}`);

if (!APPLY) {
  console.log('\nDry run - no writes. Re-run with --apply to commit.');
  await mongoose.disconnect();
  process.exit(0);
}

if (!notifyOnly) {
  await db.collection('self_service_requests').updateOne(
    { _id: req._id, status: { $in: ['approved', 'pending'] } },
    {
      $set: {
        status: 'cancelled',
        reviewNote: `Auto-cancelled: unused approved permission — no clock-in on ${DATE} (day marked absent). ${refunded} min(s) returned to your permission allowance.`,
        reviewedAt: new Date(),
        cancelledAt: new Date(),
      },
    },
  );
  if (att && !att.clockIn && (att.permission?.requestId || att.permission?.startTime)) {
    await db.collection('attendances').updateOne({ _id: att._id }, { $unset: { permission: 1 } });
    console.log('  attendance mirror permission subdoc cleared (day was never worked).');
  }
} else {
  console.log('  request already cancelled by earlier run — sending the missed notifications now.');
}

const admins = await db.collection('users').find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).project({ _id: 1 }).toArray();
const targets = [...new Set(['6a4d941ce24a8defc8412f93', ...admins.map((a) => String(a._id))])];
// Direct insert (same document shape as notify()): the notifier module's
// extensionless imports only resolve inside the Next runtime, not plain node.
await db.collection('notifications').insertMany(
  targets.map((userId) => ({
    userId: new mongoose.Types.ObjectId(userId),
    title: 'Permission auto-cancelled — unused on leave/absent day',
    message: `Stephen Praveen A's approved permission for ${DATE} (${req.payload?.startTime}-${req.payload?.endTime}, ${granted} min) was automatically cancelled: no clock-in was recorded that day. ${refunded} min(s) has been returned to the permission allowance.`,
    type: 'self_service',
    refId: req._id,
  })),
);
console.log(`  notified ${targets.length} recipient(s).`);
console.log('\nApplied.');
await mongoose.disconnect();
