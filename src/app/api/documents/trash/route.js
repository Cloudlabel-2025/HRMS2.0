import { connectDB } from '@/lib/db';
import { Document } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { deleteFile } from '@/lib/cloudinary';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const documents = await Document.find({ deletedAt: { $ne: null } })
      .populate('uploadedBy', 'name')
      .sort({ deletedAt: -1 });
    return ok({ documents });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { action, id } = await req.json();
    if (!id) return fail('Document id is required', 400);
    if (!['restore', 'permanent-delete'].includes(action)) return fail('Invalid action', 400);

    const doc = await Document.findById(id);
    if (!doc) return fail('Not found', 404);

    if (action === 'restore') {
      doc.deletedAt = null;
      await doc.save();
      await auditLog('Document Restored', 'Documents', user._id, `Restored from trash: ${doc.name}`, 'low', req.headers.get('x-forwarded-for') || '');
      return ok({ restored: true, document: doc });
    }

    if (action === 'permanent-delete') {
      // Delete from Cloudinary if it was uploaded there
      if (doc.cloudinaryPublicId) {
        try {
          await deleteFile(doc.cloudinaryPublicId);
        } catch (cloudErr) {
          // non-fatal — file may already be gone
        }
      }
      await Document.findByIdAndDelete(id);
      await auditLog('Document Permanently Deleted', 'Documents', user._id, `Permanently deleted: ${doc.name}`, 'high', req.headers.get('x-forwarded-for') || '');
      return ok({ deleted: true });
    }

    return fail('Invalid action', 400);
  } catch (e) {
    return fail(e.message, 500);
  }
}
