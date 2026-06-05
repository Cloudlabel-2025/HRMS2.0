import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';
import crypto from 'crypto';

const GENERIC_RESET_MESSAGE = 'If an account with that email exists, we sent a password reset link.';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return fail('Email is required');

    await dbConnect();
    const user = await User.findOne({ email });
    if (!user) return ok({ message: GENERIC_RESET_MESSAGE }); // Prevent email enumeration

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 mins

    await user.save();

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${appUrl.replace(/\/$/, '')}/login/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    await AuditLog.create({
      action: 'Password Reset Requested',
      module: 'Auth',
      userId: user._id,
      details: 'Password reset token generated',
      severity: 'medium',
      ip: req.headers.get('x-forwarded-for') || '',
    });

    if (process.env.NODE_ENV !== 'production' && process.env.RETURN_RESET_LINK === 'true') {
      return ok({ message: GENERIC_RESET_MESSAGE, resetUrl });
    }

    return ok({ message: GENERIC_RESET_MESSAGE });
  } catch (e) {
    return fail(e.message, 500);
  }
}
