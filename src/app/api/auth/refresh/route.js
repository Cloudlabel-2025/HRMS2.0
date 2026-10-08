import { randomUUID } from 'crypto';
import { verifyToken, signToken, signRefreshToken, getRefreshTokenFromRequest, fail, SESSION_COOKIE_OPTIONS } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import EmpProfile from '@/lib/models/EmploymentProfile';
import RefreshToken from '@/lib/models/RefreshToken';
import Leave from '@/lib/models/Leave';
import TokenBlacklist from '@/lib/models/TokenBlacklist';
import { resolveShift } from '@/lib/shift-utils';
import { resolveHalfDaySplitMins, evaluateHalfDayGate } from '@/lib/half-day-window';
import { NextResponse } from 'next/server';
import { isAccountAllowedInEnvironment } from '@/lib/account-environment';

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

    // Rotation: jti must exist and not be revoked. Reuse => revoke family.
    if (decoded.jti) {
      const stored = await RefreshToken.findOne({ jti: decoded.jti });
      if (!stored || stored.revoked) {
        if (stored) {
          await RefreshToken.updateMany({ userId: stored.userId, revoked: false }, { $set: { revoked: true } });
        }
        return fail('Refresh token revoked. Please log in again.', 401);
      }
      if (stored.expiresAt <= new Date()) {
        await RefreshToken.updateOne({ jti: decoded.jti }, { $set: { revoked: true } });
        return fail('Invalid or expired refresh token', 401);
      }
    }

    const user = await User.findById(decoded.id).select('-password');
    if (!user) return fail('User not found or inactive', 401);
    if (!isAccountAllowedInEnvironment(user)) {
      // Clear only this browser's cookies. Shared DB sessions must remain usable locally.
      const blocked = NextResponse.json({ success: false, error: 'This account is only available in local development' }, { status: 401 });
      blocked.cookies.set('hrms_access', '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
      blocked.cookies.set('hrms_refresh', '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
      return blocked;
    }
    if (user.status !== 'active') {
      const profile = user.profileId
        ? await EmpProfile.findById(user.profileId).select('employmentStatus')
        : user.identityId ? await EmpProfile.findOne({ identityId: user.identityId }).select('employmentStatus') : null;
      if (!profile || !['resigned', 'terminated', 'retired', 'alumni'].includes(profile.employmentStatus)) {
        return fail('User not found or inactive', 401);
      }
    }

    // ── Leave split gate: a blocked half window ends the rotating session ─
    // Mirrors the login gate (login/route.js): full-day leave or the leave's
    // own half refuses refresh, so an approved leave cannot be ridden out on
    // an existing 7-day refresh family. The client treats a failed refresh
    // as session expiry and redirects to /login.
    let leaveToday;
    try {
      const { getTzDateStr } = await import('@/lib/timezone');
      leaveToday = await getTzDateStr();
    } catch {
      const d = new Date();
      leaveToday = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    const onLeave = await Leave.findOne({
      userId: user._id,
      status: 'approved',
      from: { $lte: leaveToday },
      to: { $gte: leaveToday },
    });
    if (onLeave && user.role !== 'super_admin') {
      const shiftDoc = await resolveShift(user).catch(() => null);
      const gate = evaluateHalfDayGate({
        leave: onLeave,
        splitMins: resolveHalfDaySplitMins(shiftDoc, user.shift, onLeave),
      });
      if (gate.blocked) {
        await RefreshToken.updateMany({ userId: user._id, revoked: false }, { $set: { revoked: true } });
        const blocked = NextResponse.json({ success: false, error: gate.message }, { status: 401 });
        blocked.cookies.set('hrms_access', '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
        blocked.cookies.set('hrms_refresh', '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
        return blocked;
      }
    }

    // Rotate: revoke old jti, issue new pair.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (decoded.jti) {
      const nextJti = randomUUID();
      await RefreshToken.updateOne({ jti: decoded.jti }, { $set: { revoked: true, replacedBy: nextJti } });
      const portalAccess = user.status === 'active' ? 'hrms' : 'alumni';
      const token = signToken({ id: user._id, role: user.role, portalAccess });
      const nextRefresh = signRefreshToken({ id: user._id, role: user.role, portalAccess }, nextJti);
      await RefreshToken.create({ jti: nextJti, userId: user._id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), ip });
      const response = NextResponse.json({ success: true, data: { refreshed: true } });
      response.cookies.set('hrms_access', token, { ...SESSION_COOKIE_OPTIONS, maxAge: 15 * 60 });
      response.cookies.set('hrms_refresh', nextRefresh, { ...SESSION_COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 });
      return response;
    }

    // Legacy token without jti (pre-rotation): issue rotated pair once.
    const portalAccess = user.status === 'active' ? 'hrms' : 'alumni';
    const token = signToken({ id: user._id, role: user.role, portalAccess });
    const legacyJti = randomUUID();
    const legacyRefresh = signRefreshToken({ id: user._id, role: user.role, portalAccess }, legacyJti);
    await RefreshToken.create({ jti: legacyJti, userId: user._id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), ip });
    // Blacklist the legacy bearer to prevent replay of the non-rotated token.
    await TokenBlacklist.create({ token: refreshToken, userId: user._id, reason: 'breach', ip }).catch(() => {});
    const response = NextResponse.json({ success: true, data: { refreshed: true } });
    response.cookies.set('hrms_access', token, { ...SESSION_COOKIE_OPTIONS, maxAge: 15 * 60 });
    response.cookies.set('hrms_refresh', legacyRefresh, { ...SESSION_COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 });
    return response;
  } catch (e) {
    return fail(e.message, 500);
  }
}
