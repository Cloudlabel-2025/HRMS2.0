// Repair employees wedged by the "Multiple active work rows" bug.
// An open break left running (e.g. lunch open for hours) is ended at
// EXACTLY start + allowance — never at "now", so nobody loses hours to an
// over-long break. Extra open work rows are collapsed (latest kept).
//
// Read-only by default. Pass --apply to write.
//
// Usage:
//   MONGODB_URI="..." node scripts/repair-stuck-breaks.mjs [--apply] [--userId=...] [--date=YYYY-MM-DD]
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
const NOW_OVERRIDE = argVal('--now');
function nowStr() {
  if (NOW_OVERRIDE && /^([01]\d|2[0-3]):[0-5]\d$/.test(NOW_OVERRIDE)) return NOW_OVERRIDE;
  const n = new Date();
  return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}

function toMins(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function fmt(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
function diffMins(s, e) {
  const a = toMins(s), b = toMins(e);
  if (a === null || b === null) return 0;
  return b >= a ? b - a : b + 1440 - a;
}
function rowDuration(r) {
  if (!r?.startTime || !r?.endTime) return null;
  return diffMins(r.startTime, r.endTime);
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const attendance = db.collection('attendances');

  // Shift config for allowance lookup (mirrors getRuleAllowance).
  const globalCfg = await db.collection('systemconfigs').findOne({ key: 'global_config' }).catch(() => null)
    || await db.collection('system_configs').findOne({ key: 'global_config' }).catch(() => null);
  const shifts = await db.collection('shifts').find({}).toArray().catch(() => []);
  const usersById = new Map((await db.collection('users').find({ status: 'active' }).project({ _id: 1, shift: 1, shiftId: 1 }).toArray().catch(() => [])).map(u => [String(u._id), u]));

  function allowanceFor(userId, entry) {
    const u = usersById.get(String(userId));
    const shift = shifts.find(s => (u?.shiftId && String(s._id) === String(u.shiftId)) || (u?.shift && s.name === u.shift));
    const rules = shift?.breaks?.length ? shift.breaks : (globalCfg?.value?.breaks || [{ type: 'break', maxDuration: 30 }, { type: 'lunch', maxDuration: 60 }]);
    let rule = null;
    if (entry?.ruleIdx != null && rules[Number(entry.ruleIdx)]) rule = rules[Number(entry.ruleIdx)];
    if (!rule && entry?.name) rule = rules.find(r => r.type === entry.type && (r.name || '') === entry.name);
    if (!rule) rule = rules.find(r => r.type === entry?.type);
    if (rule) return (Number(rule.maxDuration) || 0) * (Number(rule.maxCount) || 1);
    return entry?.type === 'lunch' ? 60 : 30;
  }

  const q = { clockIn: { $ne: null }, clockOut: null };
  if (ONLY_USER) q.userId = new mongoose.Types.ObjectId(ONLY_USER);
  if (ONLY_DATE) q.date = ONLY_DATE;
  const records = await attendance.find(q).toArray();

  console.log(`Open records scanned: ${records.length}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
  let repairedBreaks = 0, healedRows = 0, updatedRecs = 0;

  for (const rec of records) {
    const wp = Array.isArray(rec.workProgress) ? rec.workProgress.map(r => ({ ...r })) : [];
    const brks = Array.isArray(rec.breaks) ? rec.breaks.map(b => ({ ...b })) : [];
    let changed = false;
    const notes = [];

    // 1. Open breaks exceeding their allowance -> end at EXACTLY start + allowance.
    // "Now" is real wall-clock (overridable via --now=HH:MM); diffMins is
    // overnight-aware. Past-date records always exceed -> always clamped.
    const now = nowStr();
    for (const b of brks) {
      if (!b.start || b.end) continue;
      const allow = allowanceFor(rec.userId, b);
      const overMins = diffMins(b.start, now) - allow;
      // Same-date check: diffMins wraps overnight, so a past-date break
      // always reads as exceeded (correct — its day is over).
      const sameDay = rec.date === new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0');
      if (sameDay && overMins <= 0) continue;
      const clampedEnd = fmt(toMins(b.start) + allow);
      notes.push(`break '${b.type}' ${b.start} still open (${allow}m allowance) -> end ${clampedEnd}`);
      b.end = clampedEnd;
      repairedBreaks++;
      changed = true;
      // Mirror onto the matching open sheet row.
      const wi = wp.findIndex(r => r.type === b.type && r.startTime && !r.endTime);
      if (wi !== -1) {
        wp[wi] = { ...wp[wi], endTime: clampedEnd, status: 'completed', duration: rowDuration({ ...wp[wi], endTime: clampedEnd }) };
      }
    }

    // 2. Collapse multiple open rows (keep the most recently started).
    const openIdx = wp.map((r, i) => (r.startTime && !r.endTime ? i : -1)).filter(i => i >= 0);
    if (openIdx.length > 1) {
      const keep = openIdx.reduce((best, i) => {
        const a = wp[i]?.startTime || '', b = wp[best]?.startTime || '';
        if (a > b) return i;
        if (a === b) return Math.max(best, i);
        return best;
      }, openIdx[0]);
      for (const i of openIdx) {
        if (i === keep) continue;
        const s = wp[i].startTime;
        wp[i] = { ...wp[i], endTime: s, status: wp[i].status === 'work_in_progress' ? 'stopped' : wp[i].status, duration: rowDuration({ ...wp[i], endTime: s }) };
        healedRows++;
        notes.push(`closed extra open row #${i + 1} (${wp[i].type} ${s}) at its own start`);
      }
      changed = true;
    }

    // 3. Recompute deduction + hours from the repaired breaks.
    let deduction = 0;
    for (const b of brks) {
      if (!b.end) continue;
      const allow = allowanceFor(rec.userId, b);
      deduction += Math.max(0, diffMins(b.start, b.end) - allow);
    }

    if (changed) {
      console.log(`\n- user=${rec.userId} date=${rec.date}`);
      for (const n of notes) console.log(`    ${n}`);
      console.log(`    breakDeduction: ${rec.breakDeduction ?? 0} -> ${deduction}`);
      if (APPLY) {
        await attendance.updateOne(
          { _id: rec._id },
          { $set: { breaks: brks, workProgress: wp, breakDeduction: deduction } }
        );
        updatedRecs++;
      }
    }
  }

  // 4. breaks/workProgress desync scan (all open records, informational).
  console.log('\n--- desync scan ---');
  for (const rec of records) {
    const openBreaks = (rec.breaks || []).filter(b => b.start && !b.end);
    const openRows = (rec.workProgress || []).filter(r => r.startTime && !r.endTime);
    for (const b of openBreaks) {
      const hasRow = openRows.some(r => r.type === b.type);
      if (!hasRow) console.log(`  user=${rec.userId} date=${rec.date}: open '${b.type}' break has NO open sheet row`);
    }
    for (const r of openRows) {
      if (r.type === 'task' || r.type === 'permission') continue;
      const hasEntry = openBreaks.some(b => b.type === r.type);
      if (!hasEntry) console.log(`  user=${rec.userId} date=${rec.date}: open '${r.type}' sheet row has NO open break entry`);
    }
  }

  console.log(`\nDone. Breaks clamped: ${repairedBreaks}  rows healed: ${healedRows}  records ${APPLY ? 'updated: ' + updatedRecs : 'that WOULD update (re-run with --apply)'}.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
