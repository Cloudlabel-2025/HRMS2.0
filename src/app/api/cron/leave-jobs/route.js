import dbConnect from '@/lib/db';
import { UserLeaveBalance, LeavePolicy } from '@/lib/models/index';
import { ok, fail } from '@/lib/jwt';

export async function POST(req) {
  const body = await req.json();
  const { action } = body;
  
  if (!action) return fail('action is required', 400);

  // In production, require an authorization header for cron jobs
  // if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) return fail('Unauthorized', 401);

  await dbConnect();

  if (action === 'monthly-accrual') {
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), 0, 1);
    const allBalances = await UserLeaveBalance.find({ cycleStart });
    let processed = 0;

    for (const bal of allBalances) {
      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      let updated = false;
      for (const entry of bal.balances) {
        const typeStr = (entry.typeId?._id || entry.typeId).toString();
        const config = policy.leaveTypeConfigs.find(c => c.typeId.toString() === typeStr);
        
        if (config && config.enabled && config.accrualMode === 'monthly') {
          const monthlyAmount = Number((config.annualAllocation / 12).toFixed(2));
          entry.allocated = (entry.allocated || 0) + monthlyAmount;
          if (entry.allocated > config.annualAllocation) {
            entry.allocated = config.annualAllocation;
          }
          updated = true;
        }
      }
      if (updated) {
        await bal.save();
        processed++;
      }
    }
    return ok({ message: `Monthly accrual processed for ${processed} users` });
  }

  if (action === 'carry-forward') {
    const now = new Date();
    const currentCycleStart = new Date(now.getFullYear(), 0, 1);
    const nextCycleStart = new Date(now.getFullYear() + 1, 0, 1);
    const nextCycleEnd = new Date(now.getFullYear() + 1, 11, 31);

    const allBalances = await UserLeaveBalance.find({ cycleStart: currentCycleStart });

    let processed = 0;
    for (const bal of allBalances) {
      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      const nextBalances = [];
      for (const entry of bal.balances) {
        const typeStr = (entry.typeId?._id || entry.typeId).toString();
        const config = policy.leaveTypeConfigs.find(c => c.typeId.toString() === typeStr);
        
        if (!config || !config.enabled || !config.carryForwardAllowed) continue;

        const unused = Math.max(0, (entry.allocated + entry.carriedForward) - entry.used - entry.pending);
        const carryOver = Math.min(unused, config.carryForwardMaxDays || Infinity);

        let expiryDate = null;
        if (carryOver > 0 && config.carryForwardExpiryMonths > 0) {
          expiryDate = new Date(nextCycleStart.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000);
        }

        nextBalances.push({
          typeId: entry.typeId,
          allocated: config.annualAllocation || 0,
          used: 0,
          pending: 0,
          carriedForward: carryOver,
          expiryDate,
        });
      }

      if (nextBalances.length > 0) {
        // Prevent duplicates
        const existingNext = await UserLeaveBalance.findOne({ userId: bal.userId, cycleStart: nextCycleStart });
        if (!existingNext) {
          await UserLeaveBalance.create({
            userId: bal.userId,
            policyId: bal.policyId,
            cycleStart: nextCycleStart,
            cycleEnd: nextCycleEnd,
            balances: nextBalances,
          });
          processed++;
        }
      }
    }
    return ok({ message: `Carry forward processed for ${processed} users` });
  }

  return fail('Unknown action', 400);
}
