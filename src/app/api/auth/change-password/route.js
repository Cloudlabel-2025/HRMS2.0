import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { AuditLog } from '@/lib/models/index';

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

    await AuditLog.create({
      action: 'Password Changed', module: 'Auth', userId: user._id,
      details: fullUser.isFirstLogin ? 'First-login password reset' : 'Password changed',
      severity: 'medium',
    });

    return ok({ message: 'Password updated successfully' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
