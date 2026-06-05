import { connectDB } from '@/lib/db';
import { Document } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CreateDocumentSchema, validateRequest } from '@/lib/validation';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const isAdmin = ['super_admin','admin_full'].includes(user.role);
    const query = isAdmin ? {} : { $or: [{ access: 'all' }, { employeeId: user._id }] };

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
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    
    const body = await req.json();
    
    // SECURITY: Validate and prevent mass assignment
    const validation = validateRequest(CreateDocumentSchema, body);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }
    
    const validated = validation.data;
    
    const doc = await Document.create({ 
      ...validated, 
      uploadedBy: user._id 
    });

    // Audit log
    await auditLog(
      'Document Uploaded',
      'Documents',
      user._id,
      `Uploaded: ${doc.name} (${doc.fileType}), Access: ${doc.access}`,
      'low',
      req.headers.get('x-forwarded-for') || ''
    );

    return ok({ document: doc }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
