import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) return fail('Current and new passwords are required');

    await dbConnect();
    
    // We need to fetch the user again with the password included
    const dbUser = await User.findById(user._id).select('+password');
    if (!dbUser) return fail('User not found', 404);

    const valid = await dbUser.comparePassword(currentPassword);
    if (!valid) return fail('Invalid current password', 400);

    dbUser.password = newPassword;
    dbUser.isFirstLogin = false;
    await dbUser.save();

    await AuditLog.create({
      action: 'Password Setup', module: 'Auth', userId: dbUser._id,
      details: `${dbUser.name} completed first-login password setup`, severity: 'low',
    });

    return ok({ message: 'Password updated successfully' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
