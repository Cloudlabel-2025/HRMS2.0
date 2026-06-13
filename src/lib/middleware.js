import { verifyToken, getTokenFromRequest, fail } from './jwt';
import { connectDB } from './db';
import User from './models/User';
import { hasAccess, MODULE_ACCESS } from './rbac';
import { TokenBlacklist, AuditLog } from './models/index';

export async function requireAuth(req) {
  const token = getTokenFromRequest(req);
  if (!token) return { error: fail('No token provided', 401) };

  const decoded = verifyToken(token);
  if (!decoded) return { error: fail('Invalid or expired token', 401) };

  await connectDB();
  
  // Check if token is blacklisted (revoked)
  const blacklisted = await TokenBlacklist.findOne({ token });
  if (blacklisted) return { error: fail('Token has been revoked', 401) };

  const user = await User.findById(decoded.id).select('-password');
  if (!user || user.status !== 'active') return { error: fail('User not found or inactive', 401) };

  return { user };
}

/** Require one of the listed roles */
export function requireRole(...roles) {
  return (user) => {
    if (!roles.includes(user.role)) return fail('Access denied', 403);
    return null;
  };
}

/** Require access to a specific module (uses RBAC engine) */
export function requireModule(module) {
  return (user) => {
    if (!hasAccess(user.role, module)) return fail('Access denied', 403);
    return null;
  };
}

/** Convenience: requireAuth + requireModule in one call */
export async function requireAuthAndModule(req, module) {
  const { user, error } = await requireAuth(req);
  if (error) return { error };
  if (!hasAccess(user.role, module)) return { error: fail('Access denied', 403) };
  return { user };
}

/**
 * Centralized audit logging utility
 * Call this from any route to log security events
 */
export async function auditLog(
  action,
  module,
  userId,
  details = '',
  severity = 'low',
  ip = '',
  changes = null,
  targetUserId = null
) {
  try {
    await connectDB();
    await AuditLog.create({
      action,
      module,
      userId,
      targetUserId: targetUserId || null,
      details,
      severity,
      ip,
      changes,
      timestamp: new Date(),
    });
  } catch (e) {
    console.error('Audit log failed:', e);
  }
}

/**
 * Log a page/module access event — always writes, no dedup.
 * Called only from the dedicated /api/audit/page-view endpoint.
 */
export async function pageLog(module, userId, details = '', ip = '') {
  try {
    await connectDB();
    await AuditLog.create({
      action: `Viewed ${module}`,
      module,
      userId,
      targetUserId: userId,
      details: details || `Opened ${module} module`,
      severity: 'low',
      ip,
    });
  } catch (e) {
    // non-fatal
  }
}

