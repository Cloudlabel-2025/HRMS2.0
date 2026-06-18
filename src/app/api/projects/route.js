import { connectDB } from '@/lib/db';
import { Project } from '@/lib/models/Task';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const projects = await Project.find()
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
    if (!['super_admin','admin_full','team_admin','team_lead'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const body = await req.json();
    if (!body.name || !body.description || !body.startDate || !body.endDate) return fail('Name, description, start date, and end date are required', 400);
    if (body.name.length > 30 || !/^[a-zA-Z0-9]+$/.test(body.name)) return fail('Project name must be at most 30 characters and contain only letters and numbers', 400);
    const project = await Project.create({ ...body, createdBy: user._id });
    return ok(project, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
