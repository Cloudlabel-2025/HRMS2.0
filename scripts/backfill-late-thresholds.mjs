/**
 * Recompute `status`, `lateFlag` and `halfDayThresholdExceeded` on historical
 * attendance rows from the frozen per-day shift snapshot.
 *
 * WHY: seed/demo data set `halfDayThresholdExceeded: true` on EVERY late row
 * and nothing corrected it. Since late arrival is now money-bearing (past the
 * half-day threshold = a FULL day's LOP), a stale flag would deduct a whole
 * day of pay for someone who was, say, 38 minutes late.
 *
 * The payroll run already recomputes these values before using them, so this
 * script is belt-and-braces for anything reading the database directly
 * (exports, reports, ad-hoc queries).
 *
 * Usage:
 *   node scripts/backfill-late-thresholds.mjs                # dry run (default)
 *   node scripts/backfill-late-thresholds.mjs --apply
 *   node scripts/backfill-late-thresholds.mjs --apply --from 2026-01-01 --to 2026-12-31
 *
 * Idempotent: re-running reports 0 changes once converged.
 */
import mongoose from 'mongoose';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  for (const f of ['.env.local', '.env']) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^MONGODB_URI=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* try next */ }
  }
  throw new Error('MONGODB_URI not found');
}

const toMins = (t) => {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const LATE_THRESHOLD_DEFAULT = 15;
const HALF_DAY_THRESHOLD_DEFAULT = 180;

/** 'HH:MM' → minutes, wrap-aware across midnight/overnight shifts. */
function minutesLate(clockIn, shiftStart) {
  const c = toMins(clockIn);
  const s = toMins(shiftStart);
  if (c === null || s === null) return null;
  let diff = c - s;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

async function main() {
  await mongoose.connect(loadUri());
  const db = mongoose.connection.db;
  const coll = db.collection('attendances');

  const from = argOf('--from', '1970-01-01');
  const to = argOf('--to', '2999-12-31');
  const filter = { date: { $gte: from, $lte: to } };

  const total = await coll.countDocuments(filter);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Range: ${from} .. ${to}   rows scanned: ${total}\n`);

  const cursor = coll.find(filter);
  let checked = 0;
  let changed = 0;
  let skipped = 0;
  const samples = [];

  for await (const a of cursor) {
    checked++;
    // Only working-day rows are judged; holiday/leave rows carry no shift.
    if (a.status === 'holiday' || a.status === 'leave' || a.status === 'half_day') continue;
    if (!a.clockIn) continue;

    const late = minutesLate(a.clockIn, a.shiftStartTime);
    if (late === null) { skipped++; continue; }

    const lateThreshold = Number.isFinite(a.shiftLateThreshold) ? a.shiftLateThreshold : LATE_THRESHOLD_DEFAULT;
    const halfDayThreshold = HALF_DAY_THRESHOLD_DEFAULT;

    const isLate = late > lateThreshold;
    const past = isLate && late >= halfDayThreshold;
    const nextStatus = isLate ? 'late' : 'present';

    const flagDiffers = !!a.halfDayThresholdExceeded !== past
      || !!a.lateFlag !== isLate
      || a.status !== nextStatus;

    if (!flagDiffers) continue;
    changed++;
    if (samples.length < 25) {
      samples.push(`  ${a.date} ci=${a.clockIn} shiftStart=${a.shiftStartTime} late=${late}min  ${a.status}/${!!a.lateFlag}/${!!a.halfDayThresholdExceeded} -> ${nextStatus}/${isLate}/${past}`);
    }
    if (APPLY) {
      await coll.updateOne(
        { _id: a._id },
        { $set: { status: nextStatus, lateFlag: isLate, halfDayThresholdExceeded: past } }
      );
    }
  }

  console.log(`Rows judged        : ${checked}`);
  console.log(`Changed            : ${changed}`);
  console.log(`Skipped (no shift) : ${skipped}`);
  if (samples.length) {
    console.log('\nSample changes:');
    samples.forEach(s => console.log(s));
    if (changed > samples.length) console.log(`  ... and ${changed - samples.length} more`);
  }
  if (!APPLY) {
    console.log('\nDry run - no writes. Re-run with --apply to commit.');
  } else {
    console.log(`\nApplied. Re-run the affected payroll months to refresh payslips.`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});