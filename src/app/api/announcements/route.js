import { connectDB } from '@/lib/db';
import { Announcement } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const announcements = await Announcement.find()
      .populate('author', 'name avatar')
      .sort({ pinned: -1, createdAt: -1 });
    return ok({ announcements });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full','team_admin','team_lead'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const body = await req.json();
    const announcement = await Announcement.create({ ...body, author: user._id });
    await announcement.populate('author', 'name avatar');
    return ok({ announcement }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
