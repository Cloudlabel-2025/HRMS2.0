import { connectDB } from '@/lib/db';
import { SME } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'sme') return fail('Only SME users can access this endpoint', 403);
    await connectDB();
    const sme = await SME.findOne({ email: user.email }).populate('userId', 'name email role status');
    if (!sme) return fail('SME record not found', 404);
    return ok({ sme });
  } catch (e) {
    return fail(e.message, 500);
  }
}
