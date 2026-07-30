import { connectDB } from '@/lib/db';
import { Expense } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'];

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
    if (!id || !EXPENSE_STATUSES.includes(status)) return fail('A valid expense id and status are required', 400);
    const current = await Expense.findById(id);
    if (!current) return fail('Expense not found', 404);
    if (current.status !== 'pending') return fail('Only pending expenses can be reviewed', 409);
    const expense = await Expense.findByIdAndUpdate(id, { status, approvedBy: user._id }, { new: true }).populate('userId', 'department');
    
    if (status === 'approved') {
      const year = new Date(expense.date || Date.now()).getFullYear();
      const { Budget } = await import('@/lib/models/index');
      await Budget.findOneAndUpdate(
        { department: 'Organisation', year },
        { $inc: { spent: expense.amount } },
        { upsert: true } // Create the organisation budget record if it does not exist
      );
    }

    return ok({ expense });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Only administrators can add expenses', 403);
    await connectDB();
    const body = await req.json();
    const amount = Number(body.amount);
    if (!body.category?.trim() || !Number.isFinite(amount) || amount <= 0 || !body.date || !body.description?.trim()) {
      return fail('Category, a positive amount, date, and description are required', 400);
    }
    const date = String(body.date).slice(0, 10);
    const [year, month] = date.split('-').map(Number);
    const { Budget } = await import('@/lib/models/index');
    const budget = await Budget.findOneAndUpdate(
      { department: 'Organisation', year, month, $expr: { $gte: [{ $subtract: ['$allocated', '$spent'] }, amount] } },
      { $inc: { spent: amount } },
      { new: true }
    );
    if (!budget) return fail('This expense exceeds the available allocation for the selected month', 400);
    let expense;
    try {
      expense = await Expense.create({ userId: user._id, category: body.category.trim().slice(0, 100), amount, date, description: body.description.trim().slice(0, 1000), status: 'approved', approvedBy: user._id });
    } catch (createError) {
      await Budget.findByIdAndUpdate(budget._id, { $inc: { spent: -amount } });
      throw createError;
    }
    return ok({ expense }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
