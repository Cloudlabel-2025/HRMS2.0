import dbConnect from '@/lib/db';
import { UserLeaveBalance } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import mongoose from 'mongoose';
import LeaveBalanceAdjustment from '@/lib/models/LeaveBalanceAdjustment';
import { getTzDateStr } from '@/lib/timezone';
import { reconcileLeaveAndPayroll } from '@/lib/leave/reconcile-entitlements';
import { payrollPeriod } from '@/lib/payroll-periods';
import { getGlobalConfig } from '@/lib/payroll-cycle';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const { userId, typeCode, days, reason } = await req.json();

  if (!userId || !typeCode || days === undefined || !reason) {
    return fail('userId, typeCode, days, and reason are required', 400);
  }
  if (!Number.isFinite(Number(days)) || Number(days) === 0) return fail('Adjustment days must be a finite, non-zero number', 400);

  await dbConnect();
  
  const date = await getTzDateStr();
  await reconcileLeaveAndPayroll(userId, user);
  const period = payrollPeriod(date, await getGlobalConfig());
  const cycleStart = new Date(period.yearStart + 'T00:00:00Z');
  const balance = await UserLeaveBalance.findOne({ userId, cycleStart });
  if (!balance) return fail('No balance record found for this user', 404);

  const entry = balance.balances.find(b => b.typeCode === typeCode);
  if (!entry) return fail('Leave type not found in balance', 400);

  await mongoose.connection.transaction(async session => {
    await LeaveBalanceAdjustment.create([{ userId, typeCode, days: Number(days), date, reason, actor: user._id }], { session });
    await reconcileLeaveAndPayroll(userId, user, null, { session, forceAllPayrolls: true });
  });
  await auditLog('Leave Balance Adjusted', 'Leave', user._id, `Adjusted balance for user ${userId} by ${days} days. Reason: ${reason}`, 'high', req.headers.get('x-forwarded-for') || '', null, userId);
  
  return ok({ message: 'Balance adjusted successfully' });
}
