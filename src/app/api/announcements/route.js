import { connectDB } from '@/lib/db';
import { Announcement } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    let query = {};
    if (user.role !== 'super_admin') {
      const teamIds = [];
      if (user.role === 'team_lead' || user.role === 'team_admin') {
        const filter = user.role === 'team_lead' ? { teamLeadId: user._id } : { teamAdminId: user._id };
        const members = await User.find(filter).select('_id');
        teamIds.push(...members.map(m => m._id), user._id);
      }
      if (user.teamLeadId) teamIds.push(user.teamLeadId);
      if (user.teamAdminId) teamIds.push(user.teamAdminId);
      query = {
        $or: [
          { audience: 'Company-wide' },
          ...(user.department ? [{ departments: user.department }] : []),
          ...(user.department ? [{ audience: user.department }] : []),
          ...(teamIds.length > 0 ? [{ audience: 'My Team', author: { $in: teamIds } }] : []),
        ],
      };
    }

    const announcements = await Announcement.find(query)
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
    if (user.role === 'team_lead') { body.audience = 'My Team'; body.departments = []; }
    const announcement = await Announcement.create({ ...body, author: user._id });
    await announcement.populate('author', 'name avatar');
    return ok({ announcement }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
