import { connectDB } from '@/lib/db';
import { SalaryStructure } from '@/lib/models/Payroll';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId && ['super_admin', 'admin_full'].includes(user.role)) {
      const all = await SalaryStructure.find()
        .populate('userId', 'name avatar department designation');
      return ok(all);
    }

    const structure = await SalaryStructure.findOne({ userId: userId || user._id })
      .populate('userId', 'name avatar department designation');
    if (!structure) return fail('Salary structure not found', 404);
    return ok(structure);
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
    if (!body.grossLPA || body.grossLPA <= 0) return fail('grossLPA is required and must be positive', 400);

    const structure = await SalaryStructure.findOneAndUpdate(
      { userId: body.userId },
      { userId: body.userId, grossLPA: body.grossLPA },
      { upsert: true, new: true, runValidators: true }
    );
    return ok(structure, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
