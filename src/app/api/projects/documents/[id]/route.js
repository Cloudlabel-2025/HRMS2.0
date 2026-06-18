import { connectDB } from '@/lib/db';
import ProjectDocument from '@/lib/models/ProjectDocument';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function DELETE(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { id } = await params;
    const doc = await ProjectDocument.findById(id);
    if (!doc) return fail('Document not found', 404);

    await auditLog(
      'Project Document Deleted',
      'Projects',
      user._id,
      `Deleted "${doc.name}" from project ${doc.projectId}`,
      'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      user._id
    );

    await ProjectDocument.findByIdAndDelete(id);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
