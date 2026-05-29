import { connectDB } from '@/lib/db';
import { Budget } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') || new Date().getFullYear();
    const budgets = await Budget.find({ year: Number(year) }).sort({ department: 1 });
    return ok({ budgets });
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
    const budget = await Budget.findOneAndUpdate(
      { department: body.department, year: body.year },
      body,
      { upsert: true, new: true }
    );
    return ok({ budget }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
