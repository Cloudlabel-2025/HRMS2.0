import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { signToken, signRefreshToken, ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) return fail('Email and password are required');

    await dbConnect();
    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');
    if (!user) return fail('Invalid email or password', 401);

    // Lockout check
    if (user.isLocked()) {
      const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return fail(`Account locked. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 423);
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      await user.incrementLoginAttempts();
      const remaining = 5 - user.loginAttempts;
      return fail(
        remaining > 0
          ? `Invalid email or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`
          : 'Account locked for 30 minutes due to too many failed attempts.',
        401
      );
    }

    if (user.status !== 'active') return fail('Account is inactive', 403);

    // Successful login — reset attempts
    await user.resetLoginAttempts();

    const token        = signToken({ id: user._id, role: user.role });
    const refreshToken = signRefreshToken({ id: user._id, role: user.role });

    // Audit log
    const ip = req.headers.get('x-forwarded-for') || '';
    await AuditLog.create({
      action: 'Login', module: 'Auth', userId: user._id,
      details: `${user.name} logged in`, severity: 'low', ip,
    });

    return ok({
      token,
      refreshToken,
      isFirstLogin: user.isFirstLogin,
      user: {
        id:          user._id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        department:  user.department,
        designation: user.designation,
        avatar:      user.avatar,
        teamLeadId:  user.teamLeadId,
        teamAdminId: user.teamAdminId,
        isFirstLogin:user.isFirstLogin,
      },
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
