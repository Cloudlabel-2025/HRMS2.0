import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { ok, fail } from '@/lib/jwt';
import crypto from 'crypto';

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return fail('Email is required');

    await dbConnect();
    const user = await User.findOne({ email });
    if (!user) return ok({ message: 'If an account with that email exists, we sent a password reset link.' }); // Prevent email enumeration

    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 mins

    await user.save();

    // In a real application, send this via Email. For now, log it.
    const resetUrl = `http://localhost:3000/login/reset-password?token=${resetToken}&email=${email}`;
    console.log('\n\n===========================================');
    console.log('PASSWORD RESET LINK GENERATED:');
    console.log(resetUrl);
    console.log('===========================================\n\n');

    return ok({ message: 'If an account with that email exists, we sent a password reset link.' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
