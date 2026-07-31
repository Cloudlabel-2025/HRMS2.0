import { connectDB } from '@/lib/db';
import { Document } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { uploadFile } from '@/lib/cloudinary';
import { CreateDocumentSchema, validateRequest } from '@/lib/validation';

const DOCUMENT_CATEGORIES = new Set(['Policy', 'Employee', 'Contract', 'HR', 'Other']);
const DOCUMENT_ACCESS = new Set(['all', 'admin', 'employee']);
const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'png', 'jpg', 'jpeg']);

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const query = { deletedAt: null };
    if (!isAdmin) {
      query.$or = [
        { access: 'all' },
        { employeeId: user._id },
      ];
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    if (category) query.category = category;

    const documents = await Document.find(query)
      .populate('uploadedBy', 'name')
      .populate('employeeId', 'name')
      .sort({ createdAt: -1 });
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

    const contentType = req.headers.get('content-type') || '';
    const ip = req.headers.get('x-forwarded-for') || '';

    if (contentType.includes('multipart/form-data')) {
      // ── File upload via FormData ──
      const formData = await req.formData();
      const file = formData.get('file');
      const name = formData.get('name') || file?.name || 'Untitled';
      const category = formData.get('category') || 'Other';
      const access = formData.get('access') || 'all';
      const rawEmployeeId = formData.get('employeeId') || undefined;
      const employeeId = rawEmployeeId && rawEmployeeId.match(/^[0-9a-fA-F]{24}$/) ? rawEmployeeId : undefined;
      const expiry = formData.get('expiry') || undefined;

      if (!file) return fail('No file provided', 400);
      if (!DOCUMENT_CATEGORIES.has(category) || !DOCUMENT_ACCESS.has(access)) return fail('Invalid document category or access level', 400);
      if (typeof name !== 'string' || !name.trim() || name.length > 200) return fail('Document name must be between 1 and 200 characters', 400);
      if (access === 'employee' && !employeeId) return fail('Employee access documents require an employee', 400);

      // 10 MB size limit
      if (file.size > 10 * 1024 * 1024) return fail('File exceeds 10 MB limit', 400);
      if (file.size === 0) return fail('File is empty', 400);
      const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) return fail('Unsupported document type', 400);

      let buffer;
      if (typeof file.arrayBuffer === 'function') {
        buffer = Buffer.from(await file.arrayBuffer());
      } else if (typeof file.stream === 'function') {
        const reader = file.stream().getReader();
        const chunks = [];
        while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
        buffer = Buffer.concat(chunks);
      } else {
        buffer = Buffer.from(await file.text(), 'binary');
      }

      const result = await uploadFile(buffer, { fileName: file.name });

      const fileSizeKB = (buffer.length / 1024).toFixed(1);
      const fileSize = fileSizeKB > 1024
        ? `${(buffer.length / 1048576).toFixed(1)} MB`
        : `${fileSizeKB} KB`;

      const doc = await Document.create({
        name: name.trim(),
        category,
        fileUrl: result.url,
        fileSize,
        fileType: result.format,
        mimeType: file.type || result.mimeType,
        access,
        employeeId: employeeId || null,
        expiry: expiry || null,
        cloudinaryPublicId: result.publicId,
        uploadedBy: user._id,
      });

      await auditLog('Document Uploaded', 'Documents', user._id,
        `Uploaded: ${doc.name} (${doc.fileType}), Access: ${doc.access}, Cloudinary: ${result.publicId}`,
        'low', ip, null, doc.employeeId || null);

      return ok({ document: doc }, 201);
    }

    // ── URL-paste upload (existing behavior) ──
    const body = await req.json();
    const validation = validateRequest(CreateDocumentSchema, body);
    if (!validation.valid) {
      auditLog('Document Upload Failed', 'Documents', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail('Validation failed: ' + validation.error, 400);
    }

    const validated = validation.data;
    const doc = await Document.create({ ...validated, uploadedBy: user._id });

    await auditLog('Document Uploaded', 'Documents', user._id,
      `Uploaded: ${doc.name} (${doc.fileType}), Access: ${doc.access}`,
      'low', req.headers.get('x-forwarded-for') || '', null, doc.employeeId || null);

    return ok({ document: doc }, 201);
  } catch (e) {
    console.error('📄 Document upload error:', e);
    return fail(e.message || 'Upload failed', 500);
  }
}
