import { verifyToken, signToken, getRefreshTokenFromRequest, fail, SESSION_COOKIE_OPTIONS } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    // Body fallback keeps active clients functional during the cookie migration.
    const refreshToken = getRefreshTokenFromRequest(req) || body.refreshToken;
    if (!refreshToken) return fail('Refresh token required', 401);

    const decoded = verifyToken(refreshToken);
    if (!decoded) return fail('Invalid or expired refresh token', 401);
    if (decoded.tokenType !== 'refresh') return fail('Invalid refresh token', 401);

    await connectDB();
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return fail('User not found or inactive', 401);
    if (user.status !== 'active') {
      const profile = user.profileId
        ? await EmpProfile.findById(user.profileId).select('employmentStatus')
        : user.identityId ? await EmpProfile.findOne({ identityId: user.identityId }).select('employmentStatus') : null;
      if (!profile || !['resigned', 'terminated', 'retired', 'alumni'].includes(profile.employmentStatus)) {
        return fail('User not found or inactive', 401);
      }
    }

    const portalAccess = user.status === 'active' ? 'hrms' : 'alumni';
    const token = signToken({ id: user._id, role: user.role, portalAccess });
    const response = NextResponse.json({ success: true, data: { refreshed: true } });
    response.cookies.set('hrms_access', token, { ...SESSION_COOKIE_OPTIONS, maxAge: 15 * 60 });
    return response;
  } catch (e) {
    return fail(e.message, 500);
  }
}
