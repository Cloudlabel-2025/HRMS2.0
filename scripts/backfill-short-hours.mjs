// Recompute clock-out shortfall, break excess and short-hours for completed
// attendance records.
//
// Short-hours rule: clock-out before scheduled shift end OR break time taken
// over the allowances. There is no strict 8-hour comparison. Permission days
// keep real hours but never flag short. Statuses and payroll inputs are left
// untouched.
//
// Read-only by default. Pass --apply to write.
//
// Usage:
//   MONGODB_URI="..." node scripts/backfill-short-hours.mjs [--apply] [--userId=...] [--date=YYYY-MM-DD] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--limit=N]
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const argVal = (name) => {
  const p = process.argv.find((a) => a.startsWith(`${name}=`));
  return p ? p.slice(name.length + 1) : null;
};

const ONLY_USER = argVal('--userId');
const ONLY_DATE = argVal('--date');
const FROM_DATE = argVal('--from');
const TO_DATE = argVal('--to');
const LIMIT = Number(argVal('--limit') || 0) || 0;

const { default: mongoose } = await import('mongoose');
const { connectDB } = await import('../src/lib/db.js');
const { default: Attendance } = await import('../src/lib/models/Attendance.js');
const { default: User } = await import('../src/lib/models/User.js');
const { getGlobalConfig } = await import('../src/lib/payroll-cycle.js');
const { calculateBreakDeduction } = await import('../src/lib/attendance-breaks.js');
const { calculateHoursWorked, diffMins, getShiftConfig, toMinutes } = await import('../src/lib/attendance-constants.js');
const { getShiftEndMinutes, resolveShift, resolveShiftForDate } = await import('../src/lib/shift-utils.js');

async function main() {
  await connectDB();
  const globalCfg = await getGlobalConfig();

  const userQuery = {};
  if (ONLY_USER) userQuery._id = new mongoose.Types.ObjectId(ONLY_USER);
  const users = await User.find(userQuery).select('shift shiftId').lean();
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  const query = { clockIn: { $ne: null }, clockOut: { $ne: null } };
  if (ONLY_USER) query.userId = new mongoose.Types.ObjectId(ONLY_USER);
  if (ONLY_DATE) query.date = ONLY_DATE;
  if (FROM_DATE || TO_DATE) {
    query.date = {
      ...(FROM_DATE ? { $gte: FROM_DATE } : {}),
      ...(TO_DATE ? { $lte: TO_DATE } : {}),
    };
  }

  let cursor = Attendance.find(query).sort({ date: 1 }).lean();
  if (LIMIT > 0) cursor = cursor.limit(LIMIT);
  const records = await cursor;

  let scanned = 0;
  let skipped = 0;
  let changed = 0;
  let shortBefore = 0;
  let shortAfter = 0;
  const examples = [];
  const ops = [];

  for (const rec of records) {
    scanned += 1;
    if (rec.shortHours) shortBefore += 1;

    const user = usersById.get(String(rec.userId));
    if (!user) {
      skipped += 1;
      continue;
    }

    let shiftDoc = await resolveShiftForDate(user, rec.date, { asLean: true, fallbackToCurrent: false });
    if (!shiftDoc && rec.shiftStartTime && rec.shiftEndTime) {
      shiftDoc = {
        _id: rec.shiftId || null,
        name: rec.shiftName || '',
        startTime: rec.shiftStartTime,
        endTime: rec.shiftEndTime,
      };
    }
    if (!shiftDoc) shiftDoc = await resolveShift(user, { asLean: true });
    if (!shiftDoc?.startTime || !shiftDoc?.endTime) {
      skipped += 1;
      continue;
    }

    const shiftCfg = getShiftConfig(shiftDoc, globalCfg);
    const elapsed = Math.max(0, diffMins(rec.clockIn, rec.clockOut));
    const deduction = calculateBreakDeduction(rec.breaks, shiftCfg.breaks);
    const shiftEndMins = getShiftEndMinutes(shiftDoc, shiftCfg);
    const result = calculateHoursWorked(elapsed, deduction, shiftCfg, {
      clockOut: rec.clockOut,
      shiftStartMins: toMinutes(shiftDoc.startTime),
      shiftEndMins,
      breakExcessMins: deduction,
    });

    const hasPermission = !!(rec.permission?.requestId || rec.permission?.startTime);
    const next = {
      baseHoursWorked: result.baseHours,
      breakDeduction: deduction,
      hoursWorked: result.hoursWorked,
      payableHours: result.payableHours,
      shortHours: hasPermission ? false : result.shortHours,
      shortfallMins: hasPermission ? 0 : result.shortfallMins,
      breakExcessMins: hasPermission ? 0 : result.breakExcessMins,
    };
    if (next.shortHours) shortAfter += 1;

    const differs = ['baseHoursWorked', 'breakDeduction', 'hoursWorked', 'payableHours', 'shortHours', 'shortfallMins', 'breakExcessMins']
      .some((f) => (rec[f] ?? (f === 'shortHours' ? false : 0)) !== next[f]);
    if (!differs) continue;

    changed += 1;
    if (examples.length < 20) {
      examples.push({
        userId: String(rec.userId),
        date: rec.date,
        shift: `${shiftDoc.startTime}-${shiftDoc.endTime}`,
        clock: `${rec.clockIn}-${rec.clockOut}`,
        before: { shortHours: !!rec.shortHours, shortfallMins: rec.shortfallMins ?? 0, breakExcessMins: rec.breakExcessMins ?? 0 },
        after: { shortHours: next.shortHours, shortfallMins: next.shortfallMins, breakExcessMins: next.breakExcessMins },
      });
    }
    if (APPLY) {
      ops.push({ updateOne: { filter: { _id: rec._id }, update: { $set: next } } });
      if (ops.length >= 500) {
        await Attendance.bulkWrite(ops);
        ops.length = 0;
      }
    }
  }

  if (APPLY && ops.length > 0) await Attendance.bulkWrite(ops);

  console.log(`Records scanned: ${scanned}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  console.log(`Short-hours flags before: ${shortBefore}   after: ${shortAfter}`);
  console.log(`Skipped (missing user/shift): ${skipped}`);
  console.log(`Records ${APPLY ? 'updated' : 'that WOULD update'}: ${changed}`);
  for (const e of examples) console.log(` - ${e.date} user=${e.userId} ${e.clock} shift=${e.shift} ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
