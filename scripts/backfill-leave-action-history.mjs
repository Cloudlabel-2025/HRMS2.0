import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';
const dryRun = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const leaves = await db.collection('leaves').find({ $or: [{ actionHistory: { $exists: false } }, { actionHistory: { $size: 0 } }] }).toArray();
  console.log(`Found ${leaves.length} leaves without actionHistory${dryRun ? ' (dry-run)' : ''}`);

  let updated = 0;
  for (const l of leaves) {
    const history = [];
    // Applied entry from applicant + createdAt
    if (l.userId && l.createdAt) {
      history.push({ action: 'applied', actor: l.userId, at: l.createdAt, step: null, label: 'Applied', reason: '' });
    }
    // Dynamic workflow steps with actors
    for (const s of l.workflowApprovals || []) {
      if (s.approvedBy && s.action && s.action !== 'pending') {
        history.push({ action: s.action, actor: s.approvedBy, at: s.approvedAt || l.updatedAt || l.createdAt, step: s.step ?? null, label: s.label || '', reason: s.holdReason || '' });
      }
    }
    // Legacy step actors (only where actioned)
    const legacy = [
      { v: l.adminApproval, by: l.adminApprovedBy, at: l.adminApprovedAt, label: 'Admin', reason: l.adminHoldReason },
      { v: l.teamAdminApproval, by: l.teamAdminApprovedBy, at: l.teamAdminApprovedAt, label: 'Team Admin', reason: l.teamAdminHoldReason },
      { v: l.tlApproval, by: l.tlApprovedBy, at: l.tlApprovedAt, label: 'Team Lead', reason: l.tlHoldReason },
    ];
    for (const e of legacy) {
      if (e.by && e.v && e.v !== 'pending') {
        history.push({ action: e.v, actor: e.by, at: e.at || l.updatedAt || l.createdAt, step: null, label: e.label, reason: e.reason || '' });
      }
    }
    history.sort((a, b) => new Date(a.at) - new Date(b.at));

    const last = history.length ? history[history.length - 1] : null;
    const set = {
      actionHistory: history,
      lastAction: last ? last.action : 'applied',
      lastActionBy: last ? last.actor : (l.userId || null),
      lastActionAt: last ? last.at : (l.createdAt || new Date()),
      lastActionReason: last ? (last.reason || '') : '',
    };
    if (dryRun) {
      console.log(`${l._id}: ${history.length} entries, last=${set.lastAction}`);
    } else {
      await db.collection('leaves').updateOne({ _id: l._id }, { $set: set });
      updated++;
    }
  }
  console.log(dryRun ? 'Dry-run complete.' : `Backfilled ${updated} leaves.`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
