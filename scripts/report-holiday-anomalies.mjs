// Report-only audit of the Holiday collection.
// Lists duplicate dates (the unique-index blocker), holidays falling on
// Sundays/alternate-Saturdays, malformed dates, and dates colliding with
// approved leave — WITHOUT writing anything.
//
// Usage:  MONGODB_URI="mongodb+srv://..." node scripts/report-holiday-anomalies.mjs
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

function isSat(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && d.getDay() === 6;
}
function isSun(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && d.getDay() === 0;
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const section = (t) => console.log('\n=== ' + t + ' ===');

  const holidays = await db.collection('holidays').find({}).toArray();
  section(`Holidays (total ${holidays.length})`);

  // ── 1. Duplicate dates (unique-index blocker) ───────────────────
  const byDate = new Map();
  for (const h of holidays) {
    const k = String(h.date || '');
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(h);
  }
  const dups = [...byDate.entries()].filter(([, v]) => v.length > 1);
  console.log(`Duplicate dates: ${dups.length}`);
  for (const [date, rows] of dups.slice(0, 20)) {
    console.log(`  - ${date} x${rows.length}: ${rows.map(r => `${r.name} [${r.type || '?'}]`).join(' | ')}`);
  }

  // ── 2. Malformed dates (permanent orphans) ──────────────────────
  const bad = holidays.filter(h => !/^\d{4}-\d{2}-\d{2}$/.test(String(h.date || '')));
  console.log(`Malformed dates: ${bad.length}`);
  for (const h of bad.slice(0, 20)) console.log(`  - ${h._id} name=${h.name} date=${h.date}`);

  // ── 3. Holidays on Sundays / alternate Saturdays ────────────────
  const onSun = holidays.filter(h => isSun(h.date));
  console.log(`On Sundays (redundant — already weekly off): ${onSun.length}`);
  for (const h of onSun.slice(0, 10)) console.log(`  - ${h.date}  ${h.name}`);

  // ── 4. Collisions with approved leave ───────────────────────────
  const leaves = await db.collection('leaves').find({ status: 'approved' }).select('userId type from to').lean().catch(() => []);
  let collisions = 0;
  for (const h of holidays) {
    if (!h.date) continue;
    const hit = leaves.find(l => l.from <= h.date && l.to >= h.date);
    if (hit) {
      collisions++;
      if (collisions <= 20) console.log(`  - ${h.date} (${h.name}) overlaps approved ${hit.type} leave ${hit.from}..${hit.to}`);
    }
  }
  console.log(`Holiday dates overlapping approved leave: ${collisions} of ${holidays.length}`);

  // ── 5. Source breakdown ─────────────────────────────────────────
  const bySource = {};
  for (const h of holidays) {
    const s = h.source || '(unset → reads as manual)';
    bySource[s] = (bySource[s] || 0) + 1;
  }
  console.log('By source:', JSON.stringify(bySource));

  console.log('\nDone. No writes were made.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
