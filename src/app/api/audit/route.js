import { connectDB } from '@/lib/db';
import { AuditLog } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Access denied', 403);
    await connectDB();

    const { searchParams } = new URL(req.url);
    const module   = searchParams.get('module');
    const severity = searchParams.get('severity');
    const search   = searchParams.get('search');

    const query = {};
    if (module)   query.module = module;
    if (severity) query.severity = severity;
    if (search)   query.$or = [
      { action:  { $regex: search, $options: 'i' } },
      { details: { $regex: search, $options: 'i' } },
    ];

    const logs = await AuditLog.find(query)
      .populate('userId', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(200);
    return ok({ logs });
  } catch (e) {
    return fail(e.message, 500);
  }
}
