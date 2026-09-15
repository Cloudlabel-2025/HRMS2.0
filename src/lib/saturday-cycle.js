/**
 * Pure payroll-cycle Saturday helpers — no mongoose imports, safe for
 * both server (payroll-cycle.js) and client (calendar page).
 *
 * Rule: with saturdayWorking === 'alternate', the 1st & 3rd Saturdays
 * counted from the PAYROLL CYCLE START (not calendar month) are holidays.
 * Default calendar behaviour (1st & 3rd Saturday marked off) is preserved
 * and follows the configurable payrollStartDay from Settings → General.
 */

export function getPayrollDayNumber(value, defaultDay) {
  if (value === null || value === undefined || value === '') return defaultDay;
  const num = Number(value);
  if (!Number.isNaN(num) && num >= 1 && num <= 31) return num;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return Number(String(value).split('-')[2]);
  }
  return defaultDay;
}

export function getCycleMonthForDate(dateStr, payrollStartDay) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  if (day >= payrollStartDay) {
    const next = new Date(year, month + 1, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  }
  return { year, month };
}

export function getPayrollCycleStartForDate(dateStr, payrollStartDay) {
  const startDay = getPayrollDayNumber(payrollStartDay, 26);
  const { year, month } = getCycleMonthForDate(dateStr, startDay);
  const prevM = month === 0 ? 11 : month - 1;
  const prevY = month === 0 ? year - 1 : year;
  return new Date(prevY, prevM, startDay);
}

/**
 * Count Saturdays from the owning payroll cycle start up to and including
 * the given date (1-indexed). Returns 0 when the date is not a Saturday.
 */
export function countSaturdaysFromCycleStart(dateStr, payrollStartDay) {
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() !== 6) return 0;
  const cycleStart = getPayrollCycleStartForDate(dateStr, payrollStartDay);
  let satCount = 0;
  for (let dt = new Date(cycleStart); dt <= d; dt.setDate(dt.getDate() + 1)) {
    if (dt.getDay() === 6) satCount++;
  }
  return satCount;
}

/**
 * True when the date is a 1st/3rd Saturday of its payroll cycle and the
 * Saturday policy is 'alternate'.
 */
export function isPayrollCycleSaturdayOff(dateStr, config) {
  const mode = String(config?.saturdayWorking || 'alternate').toLowerCase();
  if (mode !== 'alternate') return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() !== 6) return false;
  const startDay = getPayrollDayNumber(config?.payrollStartDay, 26);
  const satCount = countSaturdaysFromCycleStart(dateStr, startDay);
  return satCount === 1 || satCount === 3;
}
