import { connectDB } from '@/lib/db';
import { Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ADMIN_ROLES } from '@/lib/permissions';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope');
    const type = searchParams.get('type');
    const module = searchParams.get('module');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const pageParam = searchParams.get('page');
    const limit = parseInt(searchParams.get('limit') || '20', 10) || 20;

    const filter = {};
    if (scope === 'all') {
      if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);
    } else {
      filter.userId = user._id;
    }
    if (type) filter.type = type;
    if (module) filter.type = module;
    if (!type && !module && req.headers.get('x-impersonate')) filter.type = { $ne: 'viewing' };
    if (from) filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(from + 'T00:00:00.000Z') };
    if (to) filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(to + 'T23:59:59.999Z') };

    if (!pageParam) {
      const notes = await Notification.find(filter)
        .populate('userId', 'name email department role')
        .sort({ createdAt: -1 })
        .limit(scope === 'all' ? 100 : 50);
      return ok(notes);
    }

    const page = parseInt(pageParam, 10) || 1;
    const [total, notes] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.find(filter)
        .populate('userId', 'name email department role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);
    return ok({ notifications: notes, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const { userId, title, message, type } = await req.json();
    if (!userId || !title) return fail('userId and title are required', 400);
    if (userId !== user._id && user.role !== 'super_admin') return fail('Forbidden', 403);
    await connectDB();
    const note = await Notification.create({ userId, title, message, type: type || 'general' });
    return ok(note);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PATCH(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { id } = await req.json();
    if (id) {
      await Notification.findOneAndUpdate({ _id: id, userId: user._id }, { read: true });
    } else {
      await Notification.updateMany({ userId: user._id, read: false }, { read: true });
    }
    return ok({ success: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { id } = await req.json();
    if (!id) return fail('id is required', 400);
    const deleted = await Notification.findOneAndDelete({ _id: id, userId: user._id });
    if (!deleted) return fail('Notification not found', 404);
    return ok({ success: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
