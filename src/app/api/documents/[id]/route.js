import { connectDB } from '@/lib/db';
import { Document } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { deleteFile } from '@/lib/cloudinary';
import { UpdateDocumentSchema, validateRequest } from '@/lib/validation';

export async function PUT(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    const { id } = await params;
    await connectDB();

    const body = await req.json();
    const validation = validateRequest(UpdateDocumentSchema, body);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }

    const doc = await Document.findByIdAndUpdate(id, validation.data, { new: true, runValidators: true });
    if (!doc) return fail('Not found', 404);

    await auditLog('Document Updated', 'Documents', user._id, `Updated: ${doc.name}`, 'low', req.headers.get('x-forwarded-for') || '');
    return ok({ document: doc });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    const { id } = await params;
    await connectDB();

    const doc = await Document.findById(id);
    if (!doc) return fail('Not found', 404);
    if (doc.deletedAt) return fail('Already in trash', 400);

    // Soft delete — set deletedAt timestamp
    doc.deletedAt = new Date();
    await doc.save();

    await auditLog('Document Trashed', 'Documents', user._id, `Moved to trash: ${doc.name}`, 'low', req.headers.get('x-forwarded-for') || '');
    return ok({ trashed: true, document: doc });
  } catch (e) {
    return fail(e.message, 500);
  }
}
