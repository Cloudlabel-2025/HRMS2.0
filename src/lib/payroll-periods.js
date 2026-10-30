// Date-only payroll boundaries. UTC arithmetic avoids duplicate IST/UTC cycles.
export function payrollDay(value, fallback) {
  const n = Number(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).slice(8) : value);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : fallback;
}
const dateAt = (year, month, day) => {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
};
export function cycleRange(start, end, year, month) {
  const fromDate = dateAt(year, start > end ? month - 1 : month, start);
  if (start > end && end === start - 1) {
    const nextStart = new Date(dateAt(year, month, start) + 'T00:00:00Z');
    nextStart.setUTCDate(nextStart.getUTCDate() - 1);
    return { fromDate, toDate: nextStart.toISOString().slice(0, 10) };
  }
  return { fromDate, toDate: dateAt(year, month, end) };
}
export function cycleMonth(date, start, end = start === 1 ? 31 : start - 1) {
  const [year, month, day] = String(date).slice(0, 10).split('-').map(Number);
  const shift = start > end && day >= Number(dateAt(year, month - 1, start).slice(8)) ? 1 : 0;
  const result = new Date(Date.UTC(year, month - 1 + shift, 1));
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() };
}
export function payrollPeriod(date, config = {}) {
  const start = payrollDay(config.payrollStartDay, 26), end = payrollDay(config.payrollEndDay, 25);
  const { year, month } = cycleMonth(date, start, end);
  const quarter = Math.floor(month / 3);
  return { year, month, quarter, monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
    ...cycleRange(start, end, year, month),
    quarterStart: cycleRange(start, end, year, quarter * 3).fromDate,
    quarterEnd: cycleRange(start, end, year, quarter * 3 + 2).toDate,
    yearStart: cycleRange(start, end, year, 0).fromDate,
    yearEnd: cycleRange(start, end, year, 11).toDate };
}

export function normalizeEntitlementType(type) {
  // Mongoose subdocuments keep persisted fields behind getters; spreading
  // them directly drops code/name/enabled and hides the balance in the UI.
  type = typeof type?.toObject === 'function' ? type.toObject() : type;
  const code = String(type.code || '').toUpperCase();
  if (!['SL', 'CL', 'EL'].includes(code)) return type;
  const earned = code === 'EL';
  return { ...type, annualAllocation: earned ? 12 : 6, creditSchedule: 'quarterly', accrualMode: 'quarterly',
    usagePeriod: 'quarterly', maxUsagePerPeriod: earned ? 3 : 1.5,
    unusedPeriodRollover: earned, carryForwardAllowed: earned };
}

export function leavePaidFraction(leave, date) {
  if (leave.entitlementVersion === 1) {
    const row = leave.payrollDaySplit?.find(row => row.date === date);
    return row && row.paidDays + row.unpaidDays > 0 ? row.paidDays / (row.paidDays + row.unpaidDays) : 0;
  }
  return leave.typeCode === 'LOP' || leave.type === 'Loss of Pay' || leave.isPaid === false ? 0 : 1;
}
