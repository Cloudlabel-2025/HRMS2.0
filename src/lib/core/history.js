import dbConnect from '@/lib/db';
import EmpLifecycleHistory from '@/lib/models/LifecycleHistory';

export async function recordLifecycleHistory(entry) {
  await dbConnect();
  return EmpLifecycleHistory.create({
    entityType: entry.entityType,
    entityId: entry.entityId,
    identityId: entry.identityId || null,
    profileId: entry.profileId || null,
    eventType: entry.eventType,
    action: entry.action,
    fromState: entry.fromState || '',
    toState: entry.toState || '',
    changes: Array.isArray(entry.changes) ? entry.changes : [],
    reason: entry.reason || '',
    metadata: entry.metadata || {},
    actorUserId: entry.actorUserId || null,
    actorRole: entry.actorRole || '',
    ip: entry.ip || '',
    userAgent: entry.userAgent || '',
    requestId: entry.requestId || '',
    isSystemGenerated: !!entry.isSystemGenerated,
  });
}