import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { currentPassword, newPassword } = await req.json();
    if (!newPassword || newPassword.length < 6) return fail('New password must be at least 6 characters');

    const fullUser = await User.findById(user._id).select('+password');

    // On first login, skip current password check
    if (!fullUser.isFirstLogin) {
      if (!currentPassword) return fail('Current password is required');
      const valid = await fullUser.comparePassword(currentPassword);
      if (!valid) return fail('Current password is incorrect', 401);
    }

    fullUser.password     = newPassword;
    fullUser.isFirstLogin = false;
    await fullUser.save();

    await auditLog('Password Changed', 'Auth', user._id, 'Password changed by user', 'medium', req.headers.get('x-forwarded-for') || '', null, user._id);

    return ok({ message: 'Password updated successfully' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
