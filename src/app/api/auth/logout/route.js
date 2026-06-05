import { requireAuth, auditLog } from '@/lib/middleware';
import { connectDB } from '@/lib/db';
import { TokenBlacklist } from '@/lib/models/index';
import { getTokenFromRequest, ok, fail } from '@/lib/jwt';

/**
 * POST /api/auth/logout
 * 
 * Revokes the current access token by adding it to blacklist
 * This prevents the token from being used again even if stolen
 */
export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const token = getTokenFromRequest(req);
    const ip = req.headers.get('x-forwarded-for') || 'unknown';

    await connectDB();

    // Add token to blacklist
    await TokenBlacklist.create({
      token,
      userId: user._id,
      revokedAt: new Date(),
      reason: 'logout',
      ip,
    });

    // Audit log
    await auditLog(
      'Logout',
      'Auth',
      user._id,
      `User ${user.name} logged out`,
      'low',
      ip
    );

    return ok({ message: 'Logged out successfully' });
  } catch (e) {
    return fail('Logout failed: ' + e.message, 500);
  }
}
