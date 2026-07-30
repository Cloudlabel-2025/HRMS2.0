import { connectDB } from '@/lib/db';
import { Client } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess } from '@/lib/rbac';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'invoicing')) return fail('Access denied', 403);
    await connectDB();
    const clients = await Client.find().sort({ name: 1 });
    return ok({ clients });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Only administrators can create clients', 403);
    await connectDB();

    const body = await req.json();
    const name = String(body.name || '').trim();
    if (!name) return fail('Client name is required', 400);
    if (name.length > 200) return fail('Client name must be 200 characters or fewer', 400);

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existing = await Client.findOne({ name: { $regex: `^${escapedName}$`, $options: 'i' } });
    if (existing) return fail('A client with this name already exists', 409);

    const client = await Client.create({
      name,
      contactPerson: String(body.contactPerson || '').trim().slice(0, 120),
      email: String(body.email || '').trim().slice(0, 200),
      phone: String(body.phone || '').trim().slice(0, 40),
      address: String(body.address || '').trim().slice(0, 500),
      gstin: String(body.gstin || '').trim().slice(0, 30),
      createdBy: user._id,
    });
    return ok({ client }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('A client with this name already exists', 409);
    return fail(e.message, 500);
  }
}
