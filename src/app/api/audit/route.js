import { connectDB } from '@/lib/db';
import { AuditLog } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const module   = searchParams.get('module');
    const severity = searchParams.get('severity');
    const search   = searchParams.get('search');
    const userId   = searchParams.get('userId');
    const scope    = searchParams.get('scope');
    const date     = searchParams.get('date');

    const query = {};

    if (scope === 'my') {
      query.$or = [{ userId: user._id }, { targetUserId: user._id }];
    } else if (userId) {
      if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
      query.userId = userId;
    } else if (!['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied', 403);
    }

    if (module)   query.module   = module;
    if (severity) query.severity = severity;
    if (search) {
      const searchOr = [
        { action:  { $regex: search, $options: 'i' } },
        { details: { $regex: search, $options: 'i' } },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }
    if (date) {
      const start = new Date(date + 'T00:00:00.000Z');
      const end   = new Date(date + 'T23:59:59.999Z');
      query.createdAt = { $gte: start, $lte: end };
    }

    const logs = await AuditLog.find(query)
      .populate('userId', 'name avatar email')
      .populate('targetUserId', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(500);
    return ok({ logs });
  } catch (e) {
    return fail(e.message, 500);
  }
}
