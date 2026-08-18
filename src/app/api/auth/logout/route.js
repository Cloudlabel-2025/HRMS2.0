import { requirePortalAuth, auditLog } from '@/lib/middleware';
import { connectDB } from '@/lib/db';
import TokenBlacklist from '@/lib/models/TokenBlacklist';
import { getTokenFromRequest, fail, SESSION_COOKIE_OPTIONS } from '@/lib/jwt';
import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 * 
 * Revokes the current access token by adding it to blacklist
 * This prevents the token from being used again even if stolen
 */
export async function POST(req) {
  try {
    const { user } = await requirePortalAuth(req);

    const token = getTokenFromRequest(req);
    const ip = req.headers.get('x-forwarded-for') || 'unknown';

    // Always clear cookies, even when the access token has just expired. When a
    // valid session exists, also revoke and audit it.
    if (user && token) {
      await connectDB();
      await TokenBlacklist.create({
        token,
        userId: user._id,
        revokedAt: new Date(),
        reason: 'logout',
        ip,
      });
      await auditLog('Logout', 'Auth', user._id, `User ${user.name} logged out`, 'low', ip, null, user._id);
    }

    const response = NextResponse.json({ success: true, data: { message: 'Logged out successfully' } });
    response.cookies.set('hrms_access', '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    response.cookies.set('hrms_refresh', '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
    return response;
  } catch (e) {
    return fail('Logout failed: ' + e.message, 500);
  }
}
