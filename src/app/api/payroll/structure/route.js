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

    // Admin with no userId param → return all structures
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
    const data = {
      userId: body.userId,
      da:      +body.da || 0,
      hra:     +body.hra || 0,
      ca:      +body.ca || 0,
      medical: +body.medical || 0,
      bonus:   +body.bonus || 0,
      epfo:            +body.epfo || 0,
      esi:             +body.esi || 0,
      professionalTax: +body.professionalTax || 0,
      lop:             +body.lop || 0,
      loan:            +body.loan || 0,
    };
    const structure = await SalaryStructure.findOneAndUpdate(
      { userId: body.userId },
      data,
      { upsert: true, new: true, runValidators: true }
    );
    return ok(structure, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
