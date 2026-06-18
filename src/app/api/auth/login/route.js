import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import { signToken, signRefreshToken, ok, fail } from '@/lib/jwt';
import { AuditLog, Shift } from '@/lib/models/index';
import { parseShiftStartTime } from '@/lib/payroll-cycle';
import { LoginSchema, validateRequest } from '@/lib/validation';

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
      
      // Log suspicious activity
      await dbConnect();
      await AuditLog.create({
        action: 'Login Rate Limit Exceeded',
        module: 'Auth',
        details: `IP: ${ip}`,
        severity: 'medium',
        ip,
      });
      
      return fail(`Too many login attempts from this IP. Try again in ${mins} minute(s).`, 429);
    }

    const body = await req.json();
    
    // Validate request schema
    const validation = validateRequest(LoginSchema, body);
    if (!validation.valid) {
      return fail('Invalid request: ' + validation.error, 400);
    }

    const { email, password } = validation.data;

    await dbConnect();
    const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');
    
    const handleFailure = async (msg, status = 401, severity = 'low', targetId = null) => {
      limit.count++;
      rateLimit.set(ip, limit);
      await AuditLog.create({
        action: 'Login Failed',
        module: 'Auth',
        userId: targetId || undefined,
        targetUserId: targetId || undefined,
        details: `Email: ${email}, Reason: ${msg}`,
        severity,
        ip,
      });
      return fail(msg, status);
    };

    if (!user) return handleFailure('Invalid email or password', 401, 'low');

    if (user.isLocked()) {
      const mins = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return handleFailure(`Account locked. Try again in ${mins} minute${mins > 1 ? 's' : ''}.`, 423, 'medium', user._id);
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      await user.incrementLoginAttempts();
      const remaining = 5 - user.loginAttempts;
      limit.count++;
      rateLimit.set(ip, limit);
      await AuditLog.create({
        action: 'Login Failed - Invalid Password',
        module: 'Auth',
        userId: user._id,
        targetUserId: user._id,
        details: `Email: ${email}, Attempts Remaining: ${remaining}`,
        severity: 'medium',
        ip,
      });
      return fail(
        remaining > 0
          ? `Invalid email or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining.`
          : 'Account locked for 30 minutes due to too many failed attempts.',
        401
      );
    }

    if (user.status !== 'active') {
      return handleFailure('Account is inactive', 403, 'medium', user._id);
    }

    // ── Join-date / hire-date early-access gate ────────────────────────────
    if (user.joinDate) {
      const now = new Date();
      const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const joinDate = new Date(user.joinDate);
      const joinStr  = joinDate.getFullYear() + '-' + String(joinDate.getMonth() + 1).padStart(2, '0') + '-' + String(joinDate.getDate()).padStart(2, '0');

      // Before hire date: block entirely
      if (todayStr < joinStr) {
        return handleFailure(
          `Your account is not yet active. Your hire date is ${joinStr}. Please try logging in on or after that date.`,
          403, 'medium', user._id
        );
      }

      // On hire date: block until 1.5 hours before shift start
      if (todayStr === joinStr) {
        const shiftName = user.shift || 'Morning (9AM-6PM)';
        const shiftDoc  = await Shift.findOne({ name: shiftName }).lean();
        let shiftHour = 9, shiftMin = 0, resolved = false;

        if (shiftDoc?.startTime) {
          const [sh, sm] = shiftDoc.startTime.split(':').map(Number);
          shiftHour = sh; shiftMin = sm; resolved = true;
        }

        if (!resolved) {
          const parsed = parseShiftStartTime(shiftName);
          if (parsed) {
            const [sh, sm] = parsed.split(':').map(Number);
            shiftHour = sh; shiftMin = sm; resolved = true;
          }
        }

        if (resolved) {
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          const shiftStartMinutes = shiftHour * 60 + shiftMin;
          const earliestAccessMinutes = shiftStartMinutes - 90;
          const accessFrom = `${Math.floor(earliestAccessMinutes / 60).toString().padStart(2, '0')}:${(earliestAccessMinutes % 60).toString().padStart(2, '0')}`;

          if (nowMinutes < earliestAccessMinutes) {
            return handleFailure(
              `Access restricted. Your shift starts at ${shiftHour.toString().padStart(2, '0')}:${shiftMin.toString().padStart(2, '0')}. You can log in from ${accessFrom}.`,
              403, 'medium', user._id
            );
          }
        }
      }
    }

    // Successful login — reset attempts
    limit.count = 0;
    rateLimit.set(ip, limit);
    await user.resetLoginAttempts();

    // Record first login timestamp
    if (user.isFirstLogin && !user.firstLoginAt) {
      await User.findByIdAndUpdate(user._id, { firstLoginAt: new Date() });
    }

    // Check for pending late logout reason
    let needsLateLogoutReason = false;
    let lateLogoutDate = null;
    try {
      const lateLogoutRecord = await Attendance.findOne({
        userId: user._id,
        autoLoggedOut: true,
        lateLogoutReason: { $in: ['', null] },
      }).sort({ date: -1 }).lean();

      if (lateLogoutRecord) {
        needsLateLogoutReason = true;
        lateLogoutDate = lateLogoutRecord.date;
      }
    } catch (e) {
      // Non-fatal — proceed with login
    }

    const token        = signToken({ id: user._id, role: user.role });
    const refreshToken = signRefreshToken({ id: user._id, role: user.role });

    // Audit log success
    await AuditLog.create({
      action: 'Login Success',
      module: 'Auth',
      userId: user._id,
      targetUserId: user._id,
      details: `User: ${user.name} (${user.email})`,
      severity: 'low',
      ip,
    });

    return ok({
      token,
      refreshToken,
      isFirstLogin: user.isFirstLogin,
      needsLateLogoutReason,
      lateLogoutDate,
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
    return fail('Internal error: ' + e.message, 500);
  }
}
