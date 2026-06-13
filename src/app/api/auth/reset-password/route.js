import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { ok, fail } from '@/lib/jwt';
import { auditLog } from '@/lib/middleware';
import crypto from 'crypto';

export async function POST(req) {
  try {
    const { email, token, newPassword } = await req.json();
    if (!email || !token || !newPassword) return fail('Email, token, and new password are required');

    await dbConnect();
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      email,
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: Date.now() },
    }).select('+password');

    if (!user) return fail('Invalid or expired password reset token', 400);

    user.password = newPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    await auditLog('Password Reset', 'Auth', user._id, 'Password successfully reset via reset link', 'medium', req.headers.get('x-forwarded-for') || '', null, user._id);

    return ok({ message: 'Password has been successfully reset' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
