import { connectDB } from '@/lib/db';
import { Invoice } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess } from '@/lib/rbac';
import { z } from 'zod';

const STATUSES = ['draft', 'sent', 'pending', 'paid', 'overdue'];

const InvoiceUpdateSchema = z.object({
  invoiceNo: z.string().trim().min(1).max(80).optional(),
  client: z.string().trim().min(1).max(200).optional(),
  amount: z.coerce.number().min(0).max(1000000000).optional(),
  issued: z.string().max(10).optional(),
  due: z.string().max(10).optional(),
  status: z.enum(STATUSES).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'No fields to update' });

function guard(user) {
  if (!hasAccess(user.role, 'invoicing')) return fail('Access denied', 403);
  return null;
}

export async function GET(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const denied = guard(user);
    if (denied) return denied;
    await connectDB();
    const { id } = await params;
    const invoice = await Invoice.findById(id).populate('createdBy', 'name');
    if (!invoice) return fail('Invoice not found', 404);
    return ok({ invoice });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const denied = guard(user);
    if (denied) return denied;
    await connectDB();
    const { id } = await params;
    const body = await req.json();
    const parsed = InvoiceUpdateSchema.safeParse(body);
    if (!parsed.success) return fail('Validation failed: ' + parsed.error.issues.map(i => i.message).join(', '), 400);
    const invoice = await Invoice.findByIdAndUpdate(id, parsed.data, { new: true, runValidators: true });
    if (!invoice) return fail('Invoice not found', 404);
    await auditLog('Invoice Updated', 'Finance', user._id, `Updated invoice ${invoice.invoiceNo} (${invoice.status})`, 'medium', req.headers.get('x-forwarded-for') || '', null, null);
    return ok({ invoice });
  } catch (e) {
    if (e.code === 11000) return fail('Invoice number already exists', 409);
    return fail(e.message, 500);
  }
}

export async function DELETE(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const denied = guard(user);
    if (denied) return denied;
    await connectDB();
    const { id } = await params;
    const invoice = await Invoice.findByIdAndDelete(id);
    if (!invoice) return fail('Invoice not found', 404);
    await auditLog('Invoice Deleted', 'Finance', user._id, `Deleted invoice ${invoice.invoiceNo}`, 'medium', req.headers.get('x-forwarded-for') || '', null, null);
    return ok({ deleted: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
