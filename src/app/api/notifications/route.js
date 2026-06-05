import { connectDB } from '@/lib/db';
import { Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const notes = await Notification.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50);
    return ok(notes);
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
