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
    const currentMonth = now.getMonth();
    const allBalances = await UserLeaveBalance.find({ cycleStart });
    let processed = 0;

    for (const bal of allBalances) {
      if (now < bal.cycleStart || now > bal.cycleEnd) continue;

      // Idempotency: skip if already accrued this month
      if (bal.lastAccrualMonth === currentMonth) continue;

      const cycleStartForDiff = new Date(bal.cycleStart);
      const monthsDiff = (now.getFullYear() - cycleStartForDiff.getFullYear()) * 12 + now.getMonth() - cycleStartForDiff.getMonth();
      if (monthsDiff <= 0) continue; // Skip first month (initialized on creation)

      const policy = await LeavePolicy.findById(bal.policyId);
      if (!policy) continue;

      let updated = false;
      for (const entry of bal.balances) {
        const config = policy.leaveTypeConfigs.find(c => c.code === entry.typeCode);
        if (!config || !config.enabled) continue;

        let creditAmount = 0;
        if (config.creditSchedule === 'monthly') {
          creditAmount = Number((config.annualAllocation / 12).toFixed(2));
        } else if (config.creditSchedule === 'quarterly' && monthsDiff % 3 === 0) {
          creditAmount = Number((config.annualAllocation / 4).toFixed(2));
        } else if (config.creditSchedule === 'half_yearly' && monthsDiff % 6 === 0) {
          creditAmount = Number((config.annualAllocation / 2).toFixed(2));
        }

        if (creditAmount > 0) {
          entry.allocated = (entry.allocated || 0) + creditAmount;
          if (entry.allocated > config.annualAllocation) {
            entry.allocated = config.annualAllocation;
          }
          updated = true;
        }
      }
      if (updated) {
        bal.lastAccrualMonth = currentMonth;
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
        const typeStr = entry.typeCode;
        const config = policy.leaveTypeConfigs.find(c => c.code === typeStr);
        
        if (!config || !config.enabled || !config.carryForwardAllowed) continue;

        const unused = Math.max(0, (entry.allocated + entry.carriedForward) - entry.used - entry.pending);
        const carryOver = Math.min(unused, config.carryForwardMaxDays || Infinity);

        let expiryDate = null;
        if (carryOver > 0 && config.carryForwardExpiryMonths > 0) {
          expiryDate = new Date(nextCycleStart.getTime() + config.carryForwardExpiryMonths * 30 * 24 * 60 * 60 * 1000);
        }

        nextBalances.push({
          typeCode: entry.typeCode,
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
