import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { signToken, signRefreshToken, ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

const rateLimit = new Map();

export async function POST(req) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();
    const limit = rateLimit.get(ip) || { count: 0, resetTime: now + 15 * 60 * 1000 };
    
    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 15 * 60 * 1000;
    }
    
    if (limit.count >= 3) {
      const mins = Math.ceil((limit.resetTime - now) / 60000);
      return fail(`Too many login attempts from this IP. Try again in ${mins} minute(s).`, 429);
    }

    const { email, password } = await req.json();
    if (!email || !password) return fail('Email and password are required');

    await dbConnect();
    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');
    
    const handleFailure = async (msg, status = 401) => {
      limit.count++;
      rateLimit.set(ip, limit);
      return fail(msg, status);
    };

    if (!user) return handleFailure('Invalid email or password');

    // Lockout check
    if (user.isLocked()) {
      const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return handleFailure(`Account locked. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 423);
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      await user.incrementLoginAttempts();
      const remaining = 5 - user.loginAttempts;
      limit.count++;
      rateLimit.set(ip, limit);
      return fail(
        remaining > 0
          ? `Invalid email or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`
          : 'Account locked for 30 minutes due to too many failed attempts.',
        401
      );
    }

    if (user.status !== 'active') return handleFailure('Account is inactive', 403);

    // Successful login — reset attempts
    limit.count = 0;
    rateLimit.set(ip, limit);
    await user.resetLoginAttempts();

    const token        = signToken({ id: user._id, role: user.role });
    const refreshToken = signRefreshToken({ id: user._id, role: user.role });

    // Audit log
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
