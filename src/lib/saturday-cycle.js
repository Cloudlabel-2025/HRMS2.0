/**
 * Pure payroll-cycle Saturday helpers — no mongoose imports, safe for
 * both server (payroll-cycle.js) and client (calendar page).
 *
 * Rule: Saturdays ALTERNATE continuously — leave, working, leave, working —
 * and the alternation never resets at a payroll-cycle boundary. A
 * 5-Saturday cycle is therefore always L W L W L or W L W L W, never the
 * broken L W L W W of the old per-cycle rule.
 *
 * The two patterns ('pattern1' / 'pattern2') are exact mirrors; they differ
 * only in phase. 'legacy' preserves the old per-cycle 1st & 3rd rule
 * verbatim as a temporary, deprecated migration aid.
 */

// Fixed anchor Saturday. Parity is measured from this epoch — NOT from
// payrollStartDay, which would restart the pattern at every cycle boundary
// and reintroduce the 5-Saturday bug.
const SATURDAY_EPOCH_UTC = Date.UTC(1970, 0, 3); // 1970-01-03 was a Saturday
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const SATURDAY_ALTERNATE_PATTERNS = ['pattern1', 'pattern2', 'legacy'];

/**
 * Global Saturday index from the epoch. Date.UTC day-difference math is
 * exact (no float drift) and valid for pre-epoch dates too, so negative
 * indices carry correct parity.
 */
export function saturdayGlobalIndex(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - SATURDAY_EPOCH_UTC) / WEEK_MS);
}

export function getSaturdayPattern(config) {
  const p = String(config?.saturdayAlternatePattern || 'pattern1').toLowerCase();
  return SATURDAY_ALTERNATE_PATTERNS.includes(p) ? p : 'pattern1';
}

/**
 * True when the date is a leave (non-working) Saturday under the
 * configured alternate pattern.
 */
export function isSaturdayOff(dateStr, config) {
  const pattern = getSaturdayPattern(config);
  if (pattern === 'legacy') return isLegacyCycleSaturdayOff(dateStr, config);
  const idx = saturdayGlobalIndex(dateStr);
  if (idx === null) return false;
  return pattern === 'pattern2' ? idx % 2 === 1 : idx % 2 === 0;
}

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
 * Saturday policy is 'alternate'. DEPRECATED legacy rule kept verbatim as a
 * temporary migration aid — see isSaturdayOff.
 */
export function isPayrollCycleSaturdayOff(dateStr, config) {
  const mode = String(config?.saturdayWorking || 'alternate').toLowerCase();
  if (mode !== 'alternate') return false;
  return isLegacyCycleSaturdayOff(dateStr, config);
}

/**
 * The original per-cycle 1st & 3rd rule, unchanged. In 5-Saturday cycles it
 * leaves the 4th AND 5th working (L W L W W) — the bug that continuous
 * alternation fixes. Retained only behind the 'legacy' pattern.
 */
export function isLegacyCycleSaturdayOff(dateStr, config) {
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() !== 6) return false;
  const startDay = getPayrollDayNumber(config?.payrollStartDay, 26);
  const satCount = countSaturdaysFromCycleStart(dateStr, startDay);
  return satCount === 1 || satCount === 3;
}
