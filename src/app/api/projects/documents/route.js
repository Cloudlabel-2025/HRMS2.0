import { connectDB } from '@/lib/db';
import ProjectDocument from '@/lib/models/ProjectDocument';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    const query = projectId ? { projectId } : {};
    const docs = await ProjectDocument.find(query)
      .populate('projectId', 'name')
      .populate('uploadedBy', 'name')
      .populate('taskId', 'title')
      .sort({ createdAt: -1 });

    return ok({ documents: docs });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const body = await req.json();
    if (!body.projectId || !body.name || !body.fileUrl) return fail('projectId, name, and fileUrl are required', 400);

    const doc = await ProjectDocument.create({
      projectId: body.projectId,
      name: body.name,
      fileUrl: body.fileUrl,
      fileSize: body.fileSize || '',
      fileType: body.fileType || '',
      uploadedBy: user._id,
      taskId: body.taskId || null,
    });

    await auditLog(
      'Project Document Uploaded',
      'Projects',
      user._id,
      `Uploaded "${doc.name}" to project ${body.projectId}`,
      'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      user._id
    );

    return ok({ document: doc }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
