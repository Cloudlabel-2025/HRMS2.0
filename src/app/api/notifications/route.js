import { connectDB } from '@/lib/db';
import { Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const filter = { userId: user._id };
    if (req.headers.get('x-impersonate')) {
      filter.type = { $ne: 'viewing' };
    }
    const notes = await Notification.find(filter).sort({ createdAt: -1 }).limit(50);
    return ok(notes);
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
