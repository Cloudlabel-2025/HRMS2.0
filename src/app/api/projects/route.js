import { connectDB } from '@/lib/db';
import { Project } from '@/lib/models/Task';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess, getManagedUserIds, canManageUser } from '@/lib/rbac';
import { Notification } from '@/lib/models/index';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'projects')) return fail('Access denied', 403);
    await connectDB();
    const managedIds = await getManagedUserIds(user);
    const query = managedIds === null ? {} : { team: { $in: managedIds } };
    const projects = await Project.find(query)
      .populate('team', 'name avatar')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    const result = projects.map(p => {
      const obj = p.toJSON();
      if (!obj.departments) obj.departments = [];
      if (!obj.startDate) obj.startDate = '';
      if (!obj.endDate) obj.endDate = '';
      return obj;
    });

    return ok(result);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const body = await req.json();
    if (!body.name || !body.description || !body.startDate || !body.endDate || !body.responsibleTo) return fail('Name, description, responsible person, start date, and end date are required', 400);
    if (body.name.length > 30 || !body.name.trim()) return fail('Project name must be between 1 and 30 characters', 400);
    let team = Array.isArray(body.team) ? body.team.filter(Boolean) : [];
    // Legacy project form selects departments rather than individual team members.
    // Derive a scoped team so existing project creation remains functional.
    if (!team.length && Array.isArray(body.departments) && body.departments.length) {
      const managedIds = await getManagedUserIds(user);
      const memberQuery = { status: 'active', department: { $in: body.departments } };
      if (managedIds !== null) memberQuery._id = { $in: managedIds };
      team = (await User.find(memberQuery).select('_id').lean()).map(member => member._id);
    }
    if (!team.length) return fail('At least one permitted project team member is required', 400);
    for (const memberId of team) {
      if (!await canManageUser(user, memberId)) return fail('You can only create projects for your team', 403);
    }
    if (!await canManageUser(user, body.responsibleTo)) return fail('You can only assign responsibility to your team', 403);
    const project = await Project.create({
      name: body.name,
      description: body.description,
      team,
      responsibleTo: body.responsibleTo,
      departments: Array.isArray(body.departments) ? body.departments : [],
      startDate: body.startDate,
      endDate: body.endDate,
      progress: Number(body.progress) || 0,
      status: body.status || 'active',
      createdBy: user._id,
    });
    const memberIds = [...new Set([...team.map(memberId => memberId.toString()), body.responsibleTo.toString()])].filter(memberId => memberId !== user._id.toString());
    if (memberIds.length) await Notification.insertMany(memberIds.map(userId => ({ userId, title: 'New Project Assignment', message: `You have been added to the project: ${project.name}.`, type: 'general', refId: project._id })));
    return ok(project, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
