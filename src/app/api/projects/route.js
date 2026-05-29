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
    return ok(projects);
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
    const project = await Project.create({ ...body, createdBy: user._id });
    return ok(project, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
