// Repair open attendance records that have NO open work-progress row.
// Clock-in seeds the day's first task row via $setOnInsert, which is skipped
// whenever the day's row already existed (approved leave upsert, bulk leave,
// holiday/weekly-off row, prior absent row). Such records show an empty Daily
// Work Progress Sheet: no Task Details input and a dead "End Current Task"
// button. This script seeds the missing first task row (empty taskDetails,
// startTime = clockIn — exactly what $setOnInsert would have written).
//
// Read-only by default. Pass --apply to write.
//
// Usage:
//   MONGODB_URI="..." node scripts/repair-missing-first-task.mjs [--apply] [--userId=...] [--date=YYYY-MM-DD]
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

const hasOpenWorkRow = (wp) => (Array.isArray(wp) ? wp : []).some(r => r?.startTime && !r?.endTime);

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const attendance = db.collection('attendances');

  const q = { clockIn: { $ne: null }, clockOut: null };
  if (ONLY_USER) q.userId = new mongoose.Types.ObjectId(ONLY_USER);
  if (ONLY_DATE) q.date = ONLY_DATE;
  const records = await attendance.find(q).toArray();

  console.log(`Open records scanned: ${records.length}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  let seeded = 0, skippedClosed = 0, skippedHealthy = 0;

  for (const rec of records) {
    if (hasOpenWorkRow(rec.workProgress)) {
      skippedHealthy++;
      continue;
    }
    const wp = Array.isArray(rec.workProgress) ? [...rec.workProgress] : [];
    if (wp.length > 0) {
      // Has rows but none open (e.g. every task ended without a next task).
      // Seeding restores the "always one open row while clocked in"
      // invariant the sheet and the PUT handler rely on.
      console.log(`\n- user=${rec.userId} date=${rec.date} clockIn=${rec.clockIn}: ${wp.length} closed row(s), none open -> seed first task row at ${rec.clockIn}`);
    } else {
      console.log(`\n- user=${rec.userId} date=${rec.date} clockIn=${rec.clockIn}: empty workProgress -> seed first task row at ${rec.clockIn}`);
    }
    if (APPLY) {
      wp.push({
        type: 'task',
        taskDetails: '',
        startTime: rec.clockIn,
        endTime: null,
        status: 'work_in_progress',
        remarks: '',
        feedback: '',
        duration: null,
      });
      await attendance.updateOne({ _id: rec._id }, { $set: { workProgress: wp } });
      seeded++;
    } else {
      skippedClosed++;
    }
  }

  console.log(`\nDone. Scanned: ${records.length}  healthy: ${skippedHealthy}  ${APPLY ? 'seeded: ' + seeded : 'that WOULD seed (re-run with --apply): ' + skippedClosed}.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
