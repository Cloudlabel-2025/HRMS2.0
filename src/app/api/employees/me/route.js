import { connectDB } from '@/lib/db';
import { Employee } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const employee = await Employee.findOne({ userId: user._id }).select('_id').lean();
    return ok({ employeeId: employee?._id || null });
  } catch (error) {
    return fail(error.message, 500);
  }
}
