import { connectDB } from '@/lib/db';
import { Announcement } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { action } = await req.json(); // 'like'
    const ann = await Announcement.findById(id);
    if (!ann) return fail('Not found', 404);

    if (action === 'like') {
      const idx = ann.likes.indexOf(user._id);
      if (idx === -1) ann.likes.push(user._id);
      else ann.likes.splice(idx, 1);
      await ann.save();
    }
    return ok({ likes: ann.likes.length });
  } catch (e) {
    return fail(e.message, 500);
  }
}
