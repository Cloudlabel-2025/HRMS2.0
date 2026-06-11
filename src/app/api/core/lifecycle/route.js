import dbConnect from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CORE_HR_ADMIN_ROLES } from '@/lib/core/constants';
import { recordLifecycleHistory } from '@/lib/core/history';
import { CreateLifecycleHistorySchema, validateRequest } from '@/lib/validation';
import { EmpLifecycleHistory } from '@/lib/models/index';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const identityId = searchParams.get('identityId');
    const profileId = searchParams.get('profileId');
    const entityType = searchParams.get('entityType');
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 25)));

    const query = {};
    if (identityId) query.identityId = identityId;
    if (profileId) query.profileId = profileId;
    if (entityType) query.entityType = entityType;

    const [items, total] = await Promise.all([
      EmpLifecycleHistory.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      EmpLifecycleHistory.countDocuments(query),
    ]);

    return ok({
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const body = await req.json();
    const validation = validateRequest(CreateLifecycleHistorySchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const requestId = req.headers.get('x-request-id') || '';
    const ip = req.headers.get('x-forwarded-for') || '';

    const entry = await recordLifecycleHistory({
      ...validation.data,
      actorUserId: user._id,
      actorRole: user.role,
      ip,
      requestId,
      isSystemGenerated: false,
    });

    await auditLog('Lifecycle Event Logged', 'EmploymentLifecycle', user._id, `Logged lifecycle event ${validation.data.eventType} for ${validation.data.entityType}`, 'low', ip);

    return ok({ history: entry }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}