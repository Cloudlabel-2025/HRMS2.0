import { connectDB } from '@/lib/db';
import { SME } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);
    await connectDB();
    const smes = await SME.find().sort({ createdAt: -1 });
    return ok({ smes });
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
    const sme = await SME.create(body);
    return ok({ sme }, 201);
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
    const { id, ...body } = await req.json();
    const sme = await SME.findByIdAndUpdate(id, body, { new: true });
    if (!sme) return fail('SME not found', 404);
    return ok({ sme });
  } catch (e) {
    return fail(e.message, 500);
  }
}
