/**
 * Repair past attendance status/lateFlag using the shift effective ON each
 * attendance date (per-day rule), and backfill the frozen shift snapshot.
 *
 * Usage:
 *   node scripts/repair-attendance-shift.mjs --dry --from=2026-09-01 --to=2026-09-25
 *   node scripts/repair-attendance-shift.mjs --apply --from=2026-09-01 --to=2026-09-25
 *
 * Cutover mode (generic — works for ANY shift change, no names hardcoded):
 *   node scripts/repair-attendance-shift.mjs --dry --cutover=2026-09-25 --beforeShift="Evening"
 *   node scripts/repair-attendance-shift.mjs --dry --cutover=2026-09-25 --beforeStart=14:00 --beforeEnd=22:00
 *   node scripts/repair-attendance-shift.mjs --dry --changeId=<id> --beforeShiftId=<shiftId>
 *   node scripts/repair-attendance-shift.mjs --apply --changeId=<id> --beforeShiftId=<shiftId>
 * Rows with date < --cutover that have no snapshot/lineage are judged by the
 * before-shift (resolved by name, or synthetic from --beforeStart/--beforeEnd).
 *
 * Default is --dry (no writes). --apply performs bulkWrite.
 * Rows where the historical shift cannot be determined confidently
 * (no snapshot, no ShiftChange lineage, outside cutover rule) are reported
 * as needs-review and are NEVER overwritten.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
if (!process.env.MONGODB_URI) dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI missing (.env.local or .env)');
  process.exit(1);
}

function argVal(name) {
  const p = process.argv.find((a) => a.startsWith(name + '='));
  return p ? p.slice(name.length + 1) : null;
}
const APPLY = process.argv.includes('--apply');
const FROM = argVal('--from') || '1970-01-01';
const TO = argVal('--to') || '2999-12-31';
const LIMIT = Number(argVal('--limit') || '0') || 0;
const USER_ID = argVal('--userId') || null;
// Cutover mode: --cutover=YYYY-MM-DD (first day of the NEW shift) plus
// --beforeShift="Name" (resolved from shifts collection) or
// --beforeStart=HH:MM [--beforeEnd=HH:MM] (synthetic, no doc needed).
const CHANGE_ID = argVal('--changeId') || null;
const BEFORE_SHIFT_ID = argVal('--beforeShiftId') || null;
let CUTOVER = argVal('--cutover') || null;
const BEFORE_SHIFT = argVal('--beforeShift') || null;
const BEFORE_START = argVal('--beforeStart') || null;
const BEFORE_END = argVal('--beforeEnd') || null;
if (CUTOVER && !/^\d{4}-\d{2}-\d{2}$/.test(CUTOVER)) {
  console.error('--cutover must be YYYY-MM-DD');
  process.exit(1);
}

// Mirror of determineStatus in src/lib/attendance-constants.js
function determineStatus(minsSinceStart, lateThreshold, halfDayThreshold) {
  if (minsSinceStart > lateThreshold) {
    return { status: 'late', lateFlag: true, halfDayThresholdExceeded: Number.isFinite(halfDayThreshold) && minsSinceStart >= halfDayThreshold };
  }
  return { status: 'present', lateFlag: false, halfDayThresholdExceeded: false };
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const attendances = db.collection('attendances');
  const users = db.collection('users');
  const shifts = db.collection('shifts');
  const changes = db.collection('shiftchanges');

  let targetChange = null;
  if (CHANGE_ID) {
    if (!mongoose.Types.ObjectId.isValid(CHANGE_ID)) throw new Error('--changeId must be a valid MongoDB ObjectId');
    targetChange = await changes.findOne({ _id: new mongoose.Types.ObjectId(CHANGE_ID), status: 'applied' });
    if (!targetChange) throw new Error('Applied shift change not found');
    CUTOVER = targetChange.effectiveDate;
  }

  const query = { clockIn: { $ne: null }, date: { $gte: FROM, $lte: TO } };
  if (targetChange) {
    query.userId = { $in: targetChange.userIds || [] };
    query.date.$lt = CUTOVER;
  }
  if (USER_ID) {
    if (!mongoose.Types.ObjectId.isValid(USER_ID)) throw new Error('--userId must be a valid MongoDB ObjectId');
    const uid = new mongoose.Types.ObjectId(USER_ID);
    query.userId = targetChange
      ? { $in: (targetChange.userIds || []).filter((id) => String(id) === String(uid)) }
      : uid;
  }
  let cursor = attendances.find(query).sort({ date: 1 });
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const recs = await cursor.toArray();
  console.log(`Scanning ${recs.length} clocked records [${FROM}..${TO}] mode=${APPLY ? 'APPLY' : 'DRY'}`);

  const shiftById = new Map();
  const allShifts = await shifts.find({}).toArray();
  for (const s of allShifts) shiftById.set(String(s._id), s);
  const shiftByName = new Map(allShifts.map((s) => [s.name, s]));

  // Cutover before-shift (generic): named doc wins, else synthetic times.
  let cutoverShift = null;
  if (CUTOVER && (BEFORE_SHIFT || BEFORE_START)) {
    if (BEFORE_SHIFT && shiftByName.has(BEFORE_SHIFT)) {
      cutoverShift = shiftByName.get(BEFORE_SHIFT);
      console.log(`Cutover rule: date < ${CUTOVER} -> "${cutoverShift.name}" (${cutoverShift.startTime}-${cutoverShift.endTime})`);
    } else if (BEFORE_START) {
      cutoverShift = { _id: null, name: BEFORE_SHIFT || `before-${BEFORE_START}`, startTime: BEFORE_START, endTime: BEFORE_END || '', lateThreshold: 15 };
      console.log(`Cutover rule: date < ${CUTOVER} -> synthetic ${cutoverShift.name} (${cutoverShift.startTime}-${cutoverShift.endTime || '?'})`);
    } else {
      console.log(`Cutover rule IGNORED: "${BEFORE_SHIFT}" not found in shifts collection — use --beforeStart=HH:MM instead.`);
    }
  }
  if (CUTOVER && BEFORE_SHIFT_ID) {
    if (!mongoose.Types.ObjectId.isValid(BEFORE_SHIFT_ID)) throw new Error('--beforeShiftId must be a valid MongoDB ObjectId');
    const prior = shiftById.get(BEFORE_SHIFT_ID);
    if (!prior) throw new Error('Previous shift not found');
    cutoverShift = prior;
    console.log(`Cutover rule: date < ${CUTOVER} -> "${prior.name}" (${prior.startTime}-${prior.endTime})`);
  }
  if (targetChange && !cutoverShift) throw new Error('A previous shift is required with --changeId (use --beforeShiftId)');

  // Applied shift changes ordered for reverse-walk per user
  const hist = await changes.find({ status: 'applied' }).sort({ effectiveDate: -1 }).toArray();

  let fix = 0, snap = 0, skip = 0, review = 0;
  const ops = [];
  const reviewRows = [];

  for (const rec of recs) {
    if (['leave', 'holiday'].includes(rec.status)) { skip++; continue; }
    if (rec.leaveOverride?.status === 'rejected') { skip++; continue; }
    if (rec.permission?.requestId || rec.permission?.startTime) { skip++; continue; }
    if (rec.approvedHalfDayLeave) { skip++; continue; }

    const user = await users.findOne({ _id: rec.userId }, { projection: { shift: 1, shiftId: 1 } });
    let shiftDoc = null;
    let confident = false;
    let source = '';

    if (targetChange && rec.date < CUTOVER) {
      // The operator identified the old shift for this specific applied
      // change; it supersedes any snapshot frozen from the new shift.
      shiftDoc = cutoverShift;
      confident = true;
      source = `cutover:${cutoverShift.name}`;
    } else if (rec.shiftStartTime) {
      shiftDoc = {
        _id: rec.shiftId || null,
        name: rec.shiftName || user?.shift || '',
        startTime: rec.shiftStartTime,
        endTime: rec.shiftEndTime || '',
        lateThreshold: rec.shiftLateThreshold ?? 15,
      };
      confident = true;
      source = 'snapshot';
    } else {
      // Reverse-walk applied changes effective AFTER rec.date
      const uid = String(rec.userId);
      const relevant = hist.filter(
        (c) => c.effectiveDate > rec.date && (c.userIds || []).map(String).includes(uid)
      );
      let curId = user?.shiftId ? String(user.shiftId) : null;
      let curName = user?.shift || null;
      let walked = false;
      for (const ch of relevant) {
        const target = ch.targetShiftId ? String(ch.targetShiftId) : null;
        const matches = (curId && target && curId === target) || (!curId && curName && ch.targetShiftName === curName);
        if (!matches) continue;
        if (ch.fromShiftId) {
          curId = String(ch.fromShiftId);
          const fs = shiftById.get(curId);
          if (fs) curName = fs.name;
          walked = true;
        } else {
          curId = null; // lineage break
          walked = false;
          break;
        }
      }
      if (curId && shiftById.has(curId)) {
        const s = shiftById.get(curId);
        shiftDoc = s;
        confident = walked || relevant.length === 0;
        source = walked ? 'lineage' : (relevant.length === 0 ? 'current-no-later-change' : 'current-uncertain');
      } else if (!curId && curName && shiftByName.has(curName)) {
        shiftDoc = shiftByName.get(curName);
        confident = relevant.length === 0;
        source = relevant.length === 0 ? 'current-no-later-change' : 'name-uncertain';
      } else if (user?.shiftId && shiftById.has(String(user.shiftId))) {
        shiftDoc = shiftById.get(String(user.shiftId));
        confident = relevant.length === 0;
        source = relevant.length === 0 ? 'current-no-later-change' : 'current-uncertain';
      }
    }

    // Cutover fallback (generic, any shift change): pre-cutover rows with no
    // snapshot/lineage are judged by the declared before-shift.
    if (!confident && cutoverShift && CUTOVER && rec.date < CUTOVER) {
      shiftDoc = cutoverShift;
      confident = true;
      source = `cutover:${cutoverShift.name}`;
    }

    if (!shiftDoc?.startTime) { skip++; continue; }
    if (!confident) {
      review++;
      if (reviewRows.length < 50) reviewRows.push({ date: rec.date, userId: String(rec.userId), clockIn: rec.clockIn, status: rec.status, source });
      continue;
    }

    const [sh, sm] = String(shiftDoc.startTime).split(':').map(Number);
    const [h, m] = String(rec.clockIn).split(':').map(Number);
    let mins = (h - sh) * 60 + (m - sm);
    if (mins < -720) mins += 1440;
    if (mins > 720) mins -= 1440;
    const lateThreshold = Number(shiftDoc.lateThreshold ?? rec.shiftLateThreshold ?? 15);
    const halfDayThreshold = 180;
    const r = determineStatus(mins, lateThreshold, halfDayThreshold);

    const needsFix = rec.status !== r.status || !!rec.lateFlag !== r.lateFlag;
    const needsSnap = !rec.shiftStartTime ||
      String(rec.shiftId || '') !== String(shiftDoc._id || '') ||
      rec.shiftName !== (shiftDoc.name || user?.shift || null) ||
      rec.shiftStartTime !== (shiftDoc.startTime || null) ||
      rec.shiftEndTime !== (shiftDoc.endTime || null) ||
      Number(rec.shiftLateThreshold ?? 15) !== lateThreshold;
    if (!needsFix && !needsSnap) { skip++; continue; }

    if (needsFix) fix++;
    if (needsSnap) snap++;
    if (APPLY) {
      const set = {};
      if (needsFix) {
        set.status = r.status;
        set.lateFlag = r.lateFlag;
        set.halfDayThresholdExceeded = !!r.halfDayThresholdExceeded;
      }
      if (needsSnap) {
        const sid = shiftDoc._id && mongoose.Types.ObjectId.isValid(String(shiftDoc._id)) ? shiftDoc._id : null;
        set.shiftId = sid;
        set.shiftName = shiftDoc.name || user?.shift || null;
        set.shiftStartTime = shiftDoc.startTime || null;
        set.shiftEndTime = shiftDoc.endTime || null;
        set.shiftLateThreshold = lateThreshold;
      }
      ops.push({ updateOne: { filter: { _id: rec._id }, update: { $set: set } } });
    } else if (fix + snap <= 20) {
      console.log(` would fix ${rec.date} user=${String(rec.userId)} clock=${rec.clockIn} ${rec.status}${rec.lateFlag ? '(late)' : ''} -> ${r.status} via ${source}(${shiftDoc.name} ${shiftDoc.startTime}) snap=${needsSnap}`);
    }
  }

  console.log(`Result: toFix=${fix} toSnap=${snap} skipped=${skip} needsReview=${review}`);
  for (const r of reviewRows) console.log(' review:', JSON.stringify(r));

  if (APPLY && ops.length) {
    const res = await attendances.bulkWrite(ops, { ordered: false });
    console.log(`Applied: matched=${res.matchedCount} modified=${res.modifiedCount}`);
  } else if (APPLY) {
    console.log('Nothing to apply.');
  } else {
    console.log('Dry run — no writes. Re-run with --apply to write.');
  }
  if (APPLY && targetChange && BEFORE_SHIFT_ID) {
    await changes.updateOne({ _id: targetChange._id }, { $set: { fromShiftId: new mongoose.Types.ObjectId(BEFORE_SHIFT_ID) } });
    console.log('Backfilled prior shift on the applied shift-change record.');
  }
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
