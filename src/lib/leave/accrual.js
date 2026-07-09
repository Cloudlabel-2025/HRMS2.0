/**
 * Helper to get the cycle-relative period index and code.
 * @param {string} usagePeriod - 'monthly' | 'quarterly' | 'half_yearly' | 'annual'
 * @param {Date} cycleStart - Start date of the leave cycle
 * @param {Date} date - The date to evaluate (default: now)
 * @returns {{ index: number, code: string }}
 */
export function getRelativePeriod(usagePeriod, cycleStart, date) {
  const dStart = new Date(cycleStart);
  const dEval = new Date(date);

  let monthsDiff = (dEval.getFullYear() - dStart.getFullYear()) * 12 + dEval.getMonth() - dStart.getMonth();
  // Clamp between 0 and 11 for a 12-month cycle
  monthsDiff = Math.max(0, Math.min(11, monthsDiff));

  let index = 0;
  let prefix = 'A';

  switch (usagePeriod) {
    case 'monthly':
      index = monthsDiff;
      prefix = 'M';
      break;
    case 'quarterly':
      index = Math.floor(monthsDiff / 3);
      prefix = 'Q';
      break;
    case 'half_yearly':
      index = Math.floor(monthsDiff / 6);
      prefix = 'H';
      break;
    case 'calendar_year':
      index = 0;
      prefix = `CY_${dEval.getFullYear()}`;
      break;
    case 'financial_year':
      const fyStartYear = dEval.getMonth() < 3 ? dEval.getFullYear() - 1 : dEval.getFullYear();
      index = 0;
      prefix = `FY_${fyStartYear}`;
      break;
    case 'annual':
    default:
      index = 0;
      prefix = 'A';
      break;
  }

  return {
    index,
    code: prefix.startsWith('CY_') || prefix.startsWith('FY_') ? prefix : `${prefix}${index}`,
  };
}

/**
 * Calculates the active allowed balance an employee can request right now.
 * Factors in annual allocations, current used/pending days, credit schedule, usage caps, and rollovers.
 * @param {Object} typeConfig - Leave type config from LeavePolicy
 * @param {Object} balanceEntry - Balance entry from UserLeaveBalance
 * @param {Date} cycleStart - Start of the leave cycle
 * @param {Date} currentDate - Date of the request (default: now)
 * @returns {number} The maximum leave days they can request
 */
export function calculatePeriodAllowance(typeConfig, balanceEntry, cycleStart, currentDate = new Date()) {
  const overallRemaining = Math.max(
    0,
    balanceEntry.allocated + balanceEntry.carriedForward - balanceEntry.used - balanceEntry.pending
  );

  // If no usage cap per period, return the remaining balance
  if (!typeConfig.maxUsagePerPeriod || typeConfig.maxUsagePerPeriod <= 0) {
    return overallRemaining;
  }

  const { index: currIndex, code: currCode } = getRelativePeriod(typeConfig.usagePeriod, cycleStart, currentDate);

  // Get map of period usages
  const usageMap = {};
  if (balanceEntry.periodUsage && Array.isArray(balanceEntry.periodUsage)) {
    for (const pu of balanceEntry.periodUsage) {
      usageMap[pu.period] = pu.used;
    }
  }

  let allowed = 0;

  if (typeConfig.unusedPeriodRollover) {
    // Accumulate total cap up to current period
    const totalCap = (currIndex + 1) * typeConfig.maxUsagePerPeriod;
    
    // Sum up total usage across all periods from 0 to current index
    let totalUsed = 0;
    
    let prefix = 'A';
    if (typeConfig.usagePeriod === 'monthly') prefix = 'M';
    else if (typeConfig.usagePeriod === 'quarterly') prefix = 'Q';
    else if (typeConfig.usagePeriod === 'half_yearly') prefix = 'H';
    else if (typeConfig.usagePeriod === 'calendar_year') prefix = `CY_${currentDate.getFullYear()}`;
    else if (typeConfig.usagePeriod === 'financial_year') {
      const fyStartYear = currentDate.getMonth() < 3 ? currentDate.getFullYear() - 1 : currentDate.getFullYear();
      prefix = `FY_${fyStartYear}`;
    }

    if (prefix.startsWith('CY_') || prefix.startsWith('FY_')) {
      totalUsed = usageMap[prefix] || 0;
    } else {
      for (let i = 0; i <= currIndex; i++) {
        const pCode = `${prefix}${i}`;
        totalUsed += usageMap[pCode] || 0;
      }
    }

    allowed = Math.max(0, totalCap - totalUsed);
  } else {
    // No rollover: cap is strictly for the current period
    const currentPeriodUsed = usageMap[currCode] || 0;
    allowed = Math.max(0, typeConfig.maxUsagePerPeriod - currentPeriodUsed);
  }

  // Allowance cannot exceed remaining balance
  return Math.min(overallRemaining, allowed);
}

/**
 * Helper to update/increment period usage inside balanceEntry.
 * @param {Object} balanceEntry - Balance entry to update
 * @param {string} usagePeriod - Policy usage period type
 * @param {Date} cycleStart - Start of the leave cycle
 * @param {Date} date - Date of the leave
 * @param {number} days - Number of days to record
 */
export function recordPeriodUsage(balanceEntry, usagePeriod, cycleStart, date, days) {
  const { code } = getRelativePeriod(usagePeriod, cycleStart, date);
  
  if (!balanceEntry.periodUsage) {
    balanceEntry.periodUsage = [];
  }

  let entry = balanceEntry.periodUsage.find(pu => pu.period === code);
  if (!entry) {
    entry = { period: code, used: 0, cap: 0 };
    balanceEntry.periodUsage.push(entry);
  }

  entry.used += days;
}
