/**
 * Reconcile legacy approved leaves that were silently converted to unpaid.
 *
 * BEFORE this fix, leave creation clamped payable days to whatever balance was
 * left (`src/app/api/leave/route.js`) and dumped the remainder into
 * `unpaidDays` — so a PAID leave type (Sick / Casual / Earned) could be
 * approved with `unpaidDays > 0`, which payroll then paid as LOP.
 *
 * This script finds every approved leave whose type is paid but which carries
 * unpaid days, restores them to fully paid, and mirrors the correction in the
 * leave balance ledger (`used` is decremented, `pending` left alone) so the
 * balance and the payroll register agree again.
 *
 * Usage:
 *   node scripts/reconcile-paid-leave.mjs            # dry run (default)
 *   node scripts/reconcile-paid-leave.mjs --apply    # write changes
 *
 * Idempotent: re-running finds nothing to do once balances are corrected.
 */
import mongoose from 'mongoose';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');

function loadUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  for (const f of ['.env.local', '.env']) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^MONGODB_URI=(.*)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* try next */ }
  }
  throw new Error('MONGODB_URI not found (set it, or add to .env.local)');
}

// A leave is genuinely unpaid only when its type is Loss of Pay.
const isUnpaidType = (l) => l.typeCode === 'LOP' || l.type === 'Loss of Pay';

function paidTypeCodes(policies) {
  const map = new Map();
  for (const p of policies) {
    for (const c of p.leaveTypeConfigs || []) {
      if (c.code) map.set(c.code, { isPaid: c.isPaid !== false, name: c.name || c.code });
    }
  }
  return map;
}

async function main() {
  await mongoose.connect(loadUri());
  const db = mongoose.connection.db;

  const policies = await db.collection('leavepolicies').find({}).toArray();
  const types = paidTypeCodes(policies);

  // Approved leaves with unpaid days that should not have unpaid days.
  const leaves = await db.collection('leaves')
    .find({ status: 'approved', unpaidDays: { $gt: 0 } })
    .toArray();

  const actionable = [];
  for (const l of leaves) {
    if (isUnpaidType(l)) continue;
    const t = types.get(l.typeCode);
    // Unknown type code: skip rather than guess, and report it.
    if (!t) continue;
    if (!t.isPaid) continue;
    actionable.push({ leave: l, typeName: t.name });
  }

  const skippedUnknown = leaves.filter(l => !isUnpaidType(l) && !types.get(l.typeCode));

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Approved leaves with unpaidDays > 0 : ${leaves.length}`);
  console.log(`  -> paid leave types (will repair)  : ${actionable.length}`);
  console.log(`  -> genuinely unpaid (LOP) types    : ${leaves.length - actionable.length - skippedUnknown.length}`);
  console.log(`  -> unknown type code (skipped)    : ${skippedUnknown.length}`);
  if (skippedUnknown.length) {
    console.log('     codes:', [...new Set(skippedUnknown.map(l => l.typeCode))].join(', '));
  }

  if (!actionable.length) {
    console.log('\nNothing to repair.');
    await mongoose.disconnect();
    return;
  }

  console.log('');
  for (const { leave, typeName } of actionable) {
    const user = await db.collection('users').findOne({ _id: leave.userId }, { projection: { name: 1 } });
    const unpaid = Number(leave.unpaidDays || 0);
    console.log(
      `  ${leave._id}  ${user?.name || '(unknown)'}  ${leave.type} [${typeName}]  ${leave.from}..${leave.to}  ` +
      `days=${leave.days} paid=${leave.paidDays} unpaid=${unpaid}${leave.halfDay ? ' [half-day]' : ''} -> paid=${leave.days} unpaid=0`
    );
  }

  if (!APPLY) {
    console.log('\nDry run — no changes written. Re-run with --apply to commit.');
    await mongoose.disconnect();
    return;
  }

  let applied = 0;
  for (const { leave } of actionable) {
    await db.collection('leaves').updateOne(
      { _id: leave._id },
      { $set: { paidDays: leave.days, unpaidDays: 0, isPaid: true } }
    );

    // Mirror in the leave-year balance ledger. The unpaid tail was never
    // deducted from `used` (only paidDays was), so nothing to decrement —
    // but if an approval path clamped `used`, release the shortfall so the
    // balance reflects the now-fully-paid leave.
    const year = new Date(leave.from).getFullYear();
    const balance = await db.collection('userleavebalances').findOne({
      userId: leave.userId,
      cycleStart: new Date(year, 0, 1),
    });
    if (balance) {
      const idx = (balance.balances || []).findIndex(b => b.typeCode === leave.typeCode);
      if (idx >= 0) {
        const entry = balance.balances[idx];
        const shortfall = Math.max(0, Number(leave.days || 0) - Number(entry.used || 0));
        if (shortfall > 0 && entry.status === 'active') {
          balance.balances[idx].used = Number((Number(entry.used || 0) + shortfall).toFixed(2));
          await db.collection('userleavebalances').updateOne(
            { _id: balance._id },
            { $set: { balances: balance.balances } }
          );
        }
      }
    }
    applied++;
  }

  console.log(`\nApplied to ${applied} leave(s).`);
  console.log('Re-run the affected payroll month(s) to refresh payslips:');
  const months = new Set(actionable.map(({ leave }) => {
    const d = new Date(`${leave.from}T00:00:00`);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }));
  console.log('  POST /api/payroll/run  { "month": "YYYY-MM" }  for:', [...months].join(', '));

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});