import { connectDB } from '@/lib/db';
import { SME } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req, { params }) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { id } = await params;
    const sme = await SME.findById(id).populate('userId', 'name email role status');
    if (!sme) return fail('SME not found', 404);
    const isOwner = user.role === 'sme' && sme.userId?._id?.toString() === user._id?.toString();
    if (user.role !== 'super_admin' && !isOwner) return fail('Access denied', 403);
    return ok({ sme });
  } catch (e) {
    return fail(e.message, 500);
  }
}
