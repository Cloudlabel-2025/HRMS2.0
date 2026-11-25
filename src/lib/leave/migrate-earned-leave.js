import mongoose from 'mongoose';
import { canonicalizePolicy, canonicalizeLeaveRecord, canonicalLeaveCode, mergeEarnedLeaveBalances } from './types.js';

const migrations = [
  ['leavepolicies', ['leaveTypeConfigs', 'draftConfig'], canonicalizePolicy],
  ['leaves', ['typeCode', 'type', 'requestedTypeCode', 'requestedTypeName', 'classificationOptions'], canonicalizeLeaveRecord],
  ['userleavebalances', ['balances'], row => ({ ...row, balances: mergeEarnedLeaveBalances(row.balances) })],
  ['leavebalanceadjustments', ['typeCode'], row => ({ ...row, typeCode: canonicalLeaveCode(row.typeCode) })],
];

// Pure planning makes the exact migration previewable and rerunnable.
export function planEarnedLeaveMigration(collection, documents) {
  const [, fields, convert] = migrations.find(([name]) => name === collection);
  return documents.flatMap(document => {
    const next = convert(document), before = {}, after = {};
    for (const field of fields) {
      if (next[field] !== undefined && JSON.stringify(document[field]) !== JSON.stringify(next[field])) {
        before[field] = document[field] ?? null;
        after[field] = next[field];
      }
    }
    return Object.keys(after).length ? [{ _id: document._id, userId: document.userId, before, after }] : [];
  });
}

export async function migrateEarnedLeave({ apply = false, actor = null, ip = '' } = {}) {
  const db = mongoose.connection.db;
  async function execute(session = null) {
    const counts = {}, employees = new Set();
    for (const [collection] of migrations) {
      const projection = collection === 'leavepolicies' ? { leaveTypeConfigs: 1, draftConfig: 1 }
        : collection === 'leaves' ? { userId: 1, typeCode: 1, type: 1, requestedTypeCode: 1, requestedTypeName: 1, classificationOptions: 1 }
        : collection === 'userleavebalances' ? { userId: 1, balances: 1 } : { userId: 1, typeCode: 1 };
      const documents = await db.collection(collection).find({}, { projection, ...(session ? { session } : {}) }).toArray();
      const changes = planEarnedLeaveMigration(collection, documents);
      counts[collection] = changes.length;
      for (const change of changes) {
        if (change.userId) employees.add(String(change.userId));
        if (!apply) continue;
        const at = new Date();
        await db.collection(collection).updateOne({ _id: change._id }, { $set: { ...change.after, updatedAt: at } }, { session });
        await db.collection('auditlogs').insertOne({
          action: 'Privilege Leave Migrated to Earned Leave', module: 'Leave', severity: 'high',
          userId: actor?._id || null, targetUserId: change.userId || null, ip,
          details: JSON.stringify({ migration: 'privilege-to-earned-v1', collection, recordId: change._id,
            previous: change.before, replacement: change.after }), createdAt: at, updatedAt: at,
        }, { session });
      }
    }
    return { applied: apply, counts, affectedEmployees: employees.size,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
  }
  if (!apply) return execute();
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => execute(session)); }
  finally { await session.endSession(); }
}
