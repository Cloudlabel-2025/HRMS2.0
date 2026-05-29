import { connectDB } from '@/lib/db';
import { Absence } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    const query = {};
    if (month) query.date = { $regex: `^${month}` };
    if (!['super_admin','admin_full','team_admin','team_lead'].includes(user.role)) query.userId = user._id;

    const absences = await Absence.find(query)
      .populate('userId', 'name avatar department')
      .sort({ date: -1 });

    // Attach pattern count per user
    const withPattern = await Promise.all(absences.map(async (a) => {
      const count = await Absence.countDocuments({ userId: a.userId._id });
      return { ...a.toObject(), pattern: count };
    }));

    return ok({ absences: withPattern });
  } catch (e) {
    return fail(e.message, 500);
  }
}
