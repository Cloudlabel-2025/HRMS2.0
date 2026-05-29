import { connectDB } from '@/lib/db';
import { Document } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

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
    const doc = await Document.create({ ...body, uploadedBy: user._id });
    return ok({ document: doc }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
