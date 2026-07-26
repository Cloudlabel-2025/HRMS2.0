import dbConnect from '@/lib/db';
import { UserLeaveBalance } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const { userId, typeCode, days, reason } = await req.json();

  if (!userId || !typeCode || days === undefined || !reason) {
    return fail('userId, typeCode, days, and reason are required', 400);
  }

  await dbConnect();
  
  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), 0, 1);
  const balance = await UserLeaveBalance.findOne({ userId, cycleStart });
  if (!balance) return fail('No balance record found for this user', 404);

  const entry = balance.balances.find(b => b.typeCode === typeCode);
  if (!entry) return fail('Leave type not found in balance', 400);

  entry.allocated += Number(days);
  
  await balance.save();
  await auditLog('Leave Balance Adjusted', 'Leave', user._id, `Adjusted balance for user ${userId} by ${days} days. Reason: ${reason}`, 'high', req.headers.get('x-forwarded-for') || '', null, userId);
  
  return ok({ message: 'Balance adjusted successfully' });
}
