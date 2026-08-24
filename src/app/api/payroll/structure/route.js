import { connectDB } from '@/lib/db';
import { SalaryStructure } from '@/lib/models/Payroll';
import PayrollRule from '@/lib/models/PayrollRule';
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
        .populate('userId', 'name avatar department designation')
        .populate({ path: 'ruleId', select: 'name isDefault', strictPopulate: false });
      return ok(all);
    }

    const targetUserId = userId && ['super_admin', 'admin_full'].includes(user.role) ? userId : user._id;
    const structure = await SalaryStructure.findOne({ userId: targetUserId })
      .populate('userId', 'name avatar department designation')
      .populate({ path: 'ruleId', select: 'name isDefault', strictPopulate: false });
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
      {
        userId:    body.userId,
        grossLPA:  body.grossLPA,
        ruleId:    body.ruleId || null,
        overrides: body.overrides || [],
      },
      { upsert: true, new: true, runValidators: true }
    );
    return ok(structure, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
