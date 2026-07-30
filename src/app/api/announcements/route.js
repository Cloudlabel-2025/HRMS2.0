import { connectDB } from '@/lib/db';
import { Announcement, Notification } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getAccessibleDepartments } from '@/lib/rbac';

async function notifyAnnouncementAudience(announcement, author) {
  const baseFilter = { status: 'active', _id: { $ne: author._id } };
  let recipientFilter;

  if (announcement.audience === 'Company-wide') {
    recipientFilter = baseFilter;
  } else if (announcement.audience === 'My Team') {
    const reportingField = author.role === 'team_lead'
      ? 'teamLeadId'
      : author.role === 'team_admin'
        ? 'teamAdminId'
        : null;
    if (!reportingField) return 0;
    recipientFilter = { ...baseFilter, [reportingField]: author._id };
  } else {
    const departments = [...new Set((announcement.departments || []).filter(Boolean))];
    if (!departments.length) return 0;
    recipientFilter = { ...baseFilter, department: { $in: departments } };
  }

  const recipients = await User.find(recipientFilter).select('_id').lean();
  if (!recipients.length) return 0;

  await Notification.insertMany(recipients.map(recipient => ({
    userId: recipient._id,
    title: `Announcement: ${announcement.title}`,
    message: announcement.body,
    type: 'announcement',
    refId: announcement._id,
    attachment: announcement.attachment,
  })));
  return recipients.length;
}

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
      const accessibleDepts = await getAccessibleDepartments(user);
      query = {
        $or: [
          { audience: 'Company-wide' },
          ...(accessibleDepts ? [{ departments: { $in: accessibleDepts } }] : []),
          ...(accessibleDepts ? [{ audience: { $in: accessibleDepts } }] : []),
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
    if (body.attachment) {
      const { name, url, type, size } = body.attachment;
      if (
        typeof name !== 'string' || name.length < 1 || name.length > 255 ||
        typeof url !== 'string' || !url.startsWith('/uploads/announcement-documents/') ||
        typeof type !== 'string' || typeof size !== 'string'
      ) return fail('Invalid announcement attachment', 400);
    }
    const announcement = await Announcement.create({ ...body, author: user._id });
    const notificationRecipients = await notifyAnnouncementAudience(announcement, user);
    await announcement.populate('author', 'name avatar');
    return ok({ announcement, notificationRecipients }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
