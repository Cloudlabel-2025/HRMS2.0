import { connectDB } from '@/lib/db';
import { Invoice } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const invoices = await Invoice.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    return ok({ invoices });
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
    const invoice = await Invoice.create({ ...body, createdBy: user._id });
    return ok({ invoice }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Invoice number already exists');
    return fail(e.message, 500);
  }
}
