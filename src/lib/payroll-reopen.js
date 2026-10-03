import { Payroll } from '@/lib/models/Payroll';
import { getGlobalConfig, getPayrollDay, getCycleMonth } from '@/lib/payroll-cycle';
import { auditLog } from '@/lib/middleware';

/**
 * Map a leave's date span to the payroll cycle month(s) that own it.
 * A leave can straddle a cycle boundary (e.g. 25th–26th with a 26th–25th
 * cycle), so both months are returned.
 *
 * @returns {string[]} unique 'YYYY-MM' keys
 */
export function affectedPayrollMonths(fromDate, toDate, config) {
  const startDay = getPayrollDay(config?.payrollStartDay, 26);
  const months = new Set();
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  // Iterate the span (bounded to 400 days so a malformed range can never spin).
  const cursor = new Date(start);
  const limit = new Date(start);
  limit.setDate(limit.getDate() + 400);
  while (cursor <= end && cursor <= limit) {
    const { year, month } = getCycleMonth(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      startDay
    );
    months.add(`${year}-${String(month + 1).padStart(2, '0')}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return [...months];
}

/**
 * Reopen any APPROVED/FINALIZED payroll cycle that an approved leave falls
 * into, so the leave is honoured by a recomputed cycle instead of silently
 * becoming LOP in an already-locked run.
 *
 * Only cycles that actually exist and are already closed are touched. A
 * payroll still in `draft` needs no action; a cycle with no payroll row yet
 * is picked up by the next normal run.
 *
 * @returns {string[]} months that were reopened to 'draft'
 */
export async function reopenPayrollForLeave(leave, actor, ip = '') {
  if (!leave?.userId || !leave?.from || !leave?.to) return [];

  let config;
  try {
    config = await getGlobalConfig();
  } catch {
    return [];
  }

  const months = affectedPayrollMonths(leave.from, leave.to, config);
  if (!months.length) return [];

  const reopened = [];
  for (const month of months) {
    const doc = await Payroll.findOne({ userId: leave.userId, month }).select('status').lean().catch(() => null);
    if (!doc) continue;
    if (!['approved', 'finalized'].includes(doc.status)) continue;
    const res = await Payroll.updateOne(
      { userId: leave.userId, month, status: { $in: ['approved', 'finalized'] } },
      { $set: { status: 'draft' } }
    ).catch(() => null);
    if (res?.modifiedCount) reopened.push(month);
  }

  if (reopened.length) {
    await auditLog(
      'Payroll Reopened',
      'Payroll',
      actor?._id || null,
      `Leave ${leave._id} (${leave.from} to ${leave.to}) approved after payroll closed — reopened ${reopened.join(', ')} to draft for recompute`,
      'high',
      ip,
      null,
      leave.userId
    ).catch(() => {});
  }

  return reopened;
}