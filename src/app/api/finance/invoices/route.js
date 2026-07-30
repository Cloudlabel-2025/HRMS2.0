import { connectDB } from '@/lib/db';
import { Invoice } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess } from '@/lib/rbac';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'invoicing')) return fail('Access denied', 403);
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
    if (!hasAccess(user.role, 'invoicing')) return fail('Access denied', 403);
    await connectDB();
    const body = await req.json();
    const amount = Number(body.amount);
    const allowedStatuses = ['draft', 'sent', 'pending', 'paid', 'overdue'];
    if (!body.invoiceNo?.trim() || !body.client?.trim() || !Number.isFinite(amount) || amount < 0) {
      return fail('Invoice number, client, and non-negative amount are required', 400);
    }
    if (body.status && !allowedStatuses.includes(body.status)) return fail('Invalid invoice status', 400);
    const invoice = await Invoice.create({
      invoiceNo: body.invoiceNo.trim().slice(0, 80),
      client: body.client.trim().slice(0, 200),
      amount,
      issued: body.issued ? String(body.issued).slice(0, 10) : '',
      due: body.due ? String(body.due).slice(0, 10) : '',
      status: body.status || 'draft',
      createdBy: user._id,
    });
    return ok({ invoice }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Invoice number already exists');
    return fail(e.message, 500);
  }
}
