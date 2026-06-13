import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

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

    await auditLog('Password Setup', 'Auth', dbUser._id, 'First-login password setup completed', 'low', req.headers.get('x-forwarded-for') || '', null, dbUser._id);

    return ok({ message: 'Password updated successfully' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
