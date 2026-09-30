// Report-only audit of the Saturday alternation module.
// Lists 5-Saturday cycles hit by the old L W L W W bug, stale auto-generated
// Saturday Holiday rows, and the active pattern — WITHOUT writing anything.
// Review the output before running the in-app cleanup.
//
// Usage:  MONGODB_URI="mongodb+srv://..." node scripts/report-saturday-anomalies.mjs
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

const EPOCH = Date.UTC(1970, 0, 3);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function gidx(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / WEEK_MS);
}
function satList(a, b) {
  const o = [];
  for (let d = new Date(a + 'T00:00:00'); d <= new Date(b + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 6) o.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }
  return o;
}
function isSat(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && d.getDay() === 6;
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const section = (t) => console.log('\n=== ' + t + ' ===');

  // ── 1. Active config ────────────────────────────────────────────
  const cfgDoc = await db.collection('systemconfigs').findOne({ key: 'global_config' }).catch(() => null)
    || await db.collection('system_configs').findOne({ key: 'global_config' }).catch(() => null);
  const cfg = cfgDoc?.value || {};
  const pattern = String(cfg.saturdayAlternatePattern || 'pattern1').toLowerCase();
  const mode = String(cfg.saturdayWorking || 'alternate').toLowerCase();
  section('Active Saturday config');
  console.log(`saturdayWorking:          ${mode}`);
  console.log(`saturdayAlternatePattern: ${pattern}${pattern === 'legacy' ? '  (DEPRECATED temporary mode)' : ''}`);
  console.log(`payrollStartDay:          ${cfg.payrollStartDay ?? '(default 26)'}`);

  // ── 2. 5-Saturday cycles (current year ±1) ──────────────────────
  section('Payroll cycles with 5 Saturdays (L W L W W under the old rule)');
  const nowY = new Date().getFullYear();
  let affected = 0;
  for (let y = nowY - 1; y <= nowY + 1; y++) {
    for (let m = 0; m < 12; m++) {
      const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y;
      const from = `${py}-${String(pm + 1).padStart(2, '0')}-26`;
      const to = `${y}-${String(m + 1).padStart(2, '0')}-25`;
      const sats = satList(from, to);
      if (sats.length !== 5) continue;
      affected++;
      const p1 = sats.map(s => (gidx(s) % 2 === 0 ? 'L' : 'W')).join(' ');
      console.log(`  ${from} -> ${to}   old: L W L W W (3 working)   pattern1/2: ${p1} (2 working)`);
    }
  }
  console.log(`Cycles affected: ${affected}  (+1 working Saturday each under the old rule)`);

  // ── 3. Stale auto-generated Saturday Holiday rows ───────────────
  section('Holiday rows the cleanup would match');
  const holidays = await db.collection('holidays').find({}).toArray();
  const re = /^(First|Second|Third|Fourth|Fifth) Saturday$/i;
  const matched = holidays.filter(h => isSat(h.date) && (h.source === 'saturday_alternate' || re.test(String(h.name || '').trim())));
  console.log(`Total holidays: ${holidays.length}   matched: ${matched.length}`);
  for (const h of matched.slice(0, 40)) {
    console.log(`  - ${h.date}  ${h.name}  [${h.type || '?'}]  source=${h.source || 'legacy-name'}`);
  }
  if (matched.length > 40) console.log(`  ...and ${matched.length - 40} more`);
  const manualSat = holidays.filter(h => isSat(h.date) && h.source !== 'saturday_alternate' && !re.test(String(h.name || '').trim()));
  console.log(`Manual Saturday holidays (never touched by cleanup): ${manualSat.length}`);

  console.log('\nDone. No writes were made.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
