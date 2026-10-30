import { normalizeEntitlementType, cycleRange } from '../payroll-periods.js';

// Display overuse without turning payroll's paid entitlement bank negative.
// LOP from a finished period must not consume the next period's allowance.
export function leaveBalanceDisplay(balance, type, leaves, period, config) {
  const normalized = normalizeEntitlementType(type);
  const size = normalized.usagePeriod === 'monthly' ? 1 : normalized.usagePeriod === 'quarterly' ? 3 : normalized.usagePeriod === 'half_yearly' ? 6 : 12;
  const firstMonth = Math.floor(period.month / size) * size;
  const start = cycleRange(config.startDay, config.endDay, period.year, firstMonth).fromDate;
  const end = cycleRange(config.startDay, config.endDay, period.year, firstMonth + size - 1).toDate;
  let excessDays = 0;
  if (normalized.isPaid !== false) {
    for (const leave of leaves) {
      if (leave.typeCode !== balance.typeCode || !['approved', 'pending'].includes(leave.status)) continue;
      if (leave.classificationRequired && !leave.classifiedAt && leave.status !== 'approved') continue;
      for (const day of leave.payrollDaySplit || []) {
        if (day.date >= start && day.date <= end) excessDays += Number(day.unpaidDays || 0);
      }
    }
  }
  const paidAvailable = Number(balance.allocated || 0) + Number(balance.carriedForward || 0) - Number(balance.used || 0) - Number(balance.pending || 0);
  return {
    displayBalance: Math.round((paidAvailable - excessDays) * 100) / 100,
    excessDays: Math.round(excessDays * 100) / 100,
    periodStart: start, periodEnd: end,
  };
}
