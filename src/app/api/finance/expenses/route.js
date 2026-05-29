import { connectDB } from '@/lib/db';
import { Expense } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const query = ['super_admin','admin_full'].includes(user.role) ? {} : { userId: user._id };
    const expenses = await Expense.find(query)
      .populate('userId', 'name avatar department')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 });
    return ok({ expenses });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const { id, status } = await req.json();
    const expense = await Expense.findByIdAndUpdate(id, { status, approvedBy: user._id }, { new: true });
    return ok({ expense });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const body = await req.json();
    const expense = await Expense.create({ ...body, userId: user._id });
    return ok({ expense }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
