// Dry-run by default. Repairs only days with an approved timing request.
// --apply backs up the original BSON documents before guarded updates.
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { setServers } from 'node:dns';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { reconcileAttendanceTimeline } = await import('../src/lib/attendance-timeline.js');
const { diffMins } = await import('../src/lib/attendance-constants.js');

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.MONGODB_URI) dotenv.config({ path: '.env', quiet: true });
if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
if (process.env.MONGODB_DNS_SERVERS) setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(value => value.trim()).filter(Boolean));
const apply = process.argv.includes('--apply');
const inspectName = process.argv.find(value => value.startsWith('--inspect='))?.slice('--inspect='.length)?.toLowerCase();
const fingerprint = rows => JSON.stringify(rows);

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, family: 4 });
  const db = mongoose.connection.db;
  const pairs = await db.collection('attendanceregularizations').aggregate([
    { $match: { status: 'approved' } },
    { $group: { _id: { userId: '$userId', date: '$date' } } },
  ]).toArray();
  if (!pairs.length) {
    console.log('No approved timing-request days found. Nothing to repair.');
  } else {
    const records = await db.collection('attendances').find({ $or: pairs.map(pair => pair._id) }).toArray();
    const users = await db.collection('users').find({ _id: { $in: records.map(record => record.userId) } }).project({ name: 1 }).toArray();
    const names = new Map(users.map(user => [String(user._id), user.name]));
    const plan = [];
    let needsReview = 0;
    for (const before of records) {
      if (!before.workProgress?.length) continue;
      if (inspectName && (names.get(String(before.userId)) || '').toLowerCase().includes(inspectName)) {
        const approvals = await db.collection('attendanceregularizations').find({ userId: before.userId, date: before.date, status: 'approved' }).sort({ reviewedAt: 1 }).project({ requestedIn: 1, requestedOut: 1, requestedBreaks: 1, requestedPermission: 1, reviewedAt: 1 }).toArray();
        console.log(JSON.stringify({ employee: names.get(String(before.userId)), date: before.date, clockIn: before.clockIn, clockOut: before.clockOut, shiftStart: before.shiftStartTime, shiftEnd: before.shiftEndTime, breaks: before.breaks, rows: before.workProgress.map(row => ({ id: row._id, type: row.type, label: row.type === 'task' ? undefined : row.taskDetails, start: row.startTime, end: row.endTime, duration: row.duration })), approvals }));
      }
      const after = { ...before, workProgress: before.workProgress.map(row => ({ ...row })) };
      try {
        reconcileAttendanceTimeline(before, after);
      } catch (error) {
        needsReview++;
        console.log(`Needs review: ${names.get(String(before.userId)) || 'Employee'} ${before.date}: ${error.message}`);
        continue;
      }
      for (const row of after.workProgress) if (!row._id) row._id = new mongoose.Types.ObjectId();
      if (fingerprint(before.workProgress) === fingerprint(after.workProgress)) continue;
      const changes = after.workProgress.filter(row => {
        const old = before.workProgress.find(old => String(old._id) === String(row._id));
        return !old || old.startTime !== row.startTime || old.endTime !== row.endTime || old.duration !== row.duration;
      });
      // This is a conservative backfill-review threshold, not a limit on work
      // hours. Do not guess a task's date when an old daytime record would
      // move timestamps into an overnight span exceeding eighteen hours.
      if (before.clockIn && before.clockOut && before.clockOut < before.clockIn
        && before.shiftStartTime && before.shiftEndTime && before.shiftEndTime > before.shiftStartTime
        && diffMins(before.clockIn, before.clockOut) > 18 * 60
        && changes.some(row => {
          const old = before.workProgress.find(old => String(old._id) === String(row._id));
          return old && (old.startTime !== row.startTime || old.endTime !== row.endTime);
        })) {
        needsReview++;
        console.log(`Needs review: ${names.get(String(before.userId)) || 'Employee'} ${before.date}: clock-out precedes clock-in and correcting task times would imply an overnight span above eighteen hours.`);
        continue;
      }
      plan.push({ before, after });
      console.log(`${apply ? 'Repair' : 'Would repair'}: ${names.get(String(before.userId)) || 'Employee'} ${before.date}, ${changes.length} work row(s)`);
      for (const row of changes) {
        const old = before.workProgress.find(old => String(old._id) === String(row._id));
        if (old && (old.startTime !== row.startTime || old.endTime !== row.endTime)) console.log(`  ${row.type}: ${old.startTime || '-'}–${old.endTime || 'open'} -> ${row.startTime || '-'}–${row.endTime || 'open'}`);
      }
    }
    console.log(`Approved correction days checked: ${records.length}; changes: ${plan.length}; needs review: ${needsReview}.`);
    if (apply && plan.length) {
      const backupDir = path.resolve('backups');
      await mkdir(backupDir, { recursive: true });
      const backupFile = path.join(backupDir, `attendance-timeline-${Date.now()}.bson`);
      await writeFile(backupFile, mongoose.mongo.BSON.serialize({ records: plan.map(item => item.before) }), { flag: 'wx' });
      console.log(`Original records backed up: ${backupFile}`);
      let repaired = 0;
      for (const { before, after } of plan) {
        const filter = { _id: before._id, ...(before.updatedAt ? { updatedAt: before.updatedAt } : {}),
          ...(before.timelineRevision === undefined ? { timelineRevision: { $exists: false } } : { timelineRevision: before.timelineRevision }) };
        const result = await db.collection('attendances').updateOne(filter, {
          $set: { workProgress: after.workProgress, updatedAt: new Date() },
          $inc: { timelineRevision: 1, __v: 1 },
        });
        if (!result.modifiedCount) { console.log(`Skipped concurrent change: ${before.date}`); continue; }
        await db.collection('auditlogs').insertOne({
          action: 'Attendance Timeline Repaired', module: 'Attendance', targetUserId: before.userId,
          details: `Aligned work boundaries to approved attendance timings for ${before.date}; original BSON backup: ${path.basename(backupFile)}`,
          severity: 'medium', createdAt: new Date(), updatedAt: new Date(),
        });
        const saved = await db.collection('attendances').findOne({ _id: before._id });
        if (fingerprint(saved.workProgress) !== fingerprint(after.workProgress)) throw new Error('Repair verification failed');
        repaired++;
      }
      console.log(`Verified repaired attendance days: ${repaired}.`);
    }
  }
} catch (error) {
  console.error(`Attendance timeline ${apply ? 'repair' : 'audit'} failed: ${error.name}. ${error.code || ''}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
