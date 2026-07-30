import { connectDB } from '@/lib/db';
import { Budget } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess } from '@/lib/rbac';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'finance')) return fail('Access denied', 403);
    await connectDB();
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') || new Date().getFullYear();
    const budgets = await Budget.find({ year: Number(year), department: 'Organisation', month: { $gte: 1, $lte: 12 } }).sort({ month: 1 });
    return ok({ budgets });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'finance')) return fail('Access denied', 403);
    await connectDB();
    const body = await req.json();
    const year = Number(body.year);
    const month = Number(body.month);
    const allocated = Number(body.allocated);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(allocated) || allocated <= 0) {
      return fail('Valid year, month, and positive allocation are required', 400);
    }
    const budget = await Budget.findOneAndUpdate(
      { department: 'Organisation', year, month },
      { $inc: { allocated } },
      { upsert: true, new: true }
    );
    return ok({ budget }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
