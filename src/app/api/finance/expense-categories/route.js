import { connectDB } from '@/lib/db';
import { ExpenseCategory } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    return ok({ categories: await ExpenseCategory.find().sort({ name: 1 }) });
  } catch (e) { return fail(e.message, 500); }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Only administrators can create expense categories', 403);
    await connectDB();
    const name = String((await req.json()).name || '').trim();
    if (!name || name.length > 80) return fail('Category name is required and must be 80 characters or fewer', 400);
    const category = await ExpenseCategory.create({ name, createdBy: user._id });
    return ok({ category }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('This expense category already exists', 409);
    return fail(e.message, 500);
  }
}
