import { isSaturdayOff } from '../saturday-cycle.js';

// Shared by the calendar preview and server-side leave calculation.
export function isWorkingDay(date, config = {}, holidays = []) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0) return false;
  const rows = (Array.isArray(holidays) ? holidays : []).filter(row => (typeof row === 'string' ? row : row?.date) === date);
  if (rows.some(row => row?.workingDayOverride)) return true;
  if (rows.length) return false;
  if (day === 6) {
    const mode = String(config?.saturdayWorking ?? 'alternate').toLowerCase();
    if (mode === 'none' || (mode === 'alternate' && isSaturdayOff(date, config))) return false;
  }
  return true;
}

export function calculateLeaveCalendar(from, to, config = {}, holidays = [], { halfDay = false } = {}) {
  const chargeableDates = [], excludedDates = [];
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to || (halfDay && from !== to)) {
    return { days: 0, calendarDays: 0, chargeableDates, excludedDates };
  }
  for (const cursor = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (isWorkingDay(date, config, holidays)) {
      chargeableDates.push(date);
    } else {
      const day = cursor.getUTCDay();
      const holiday = holidays.find(row => (typeof row === 'string' ? row : row?.date) === date && !row?.workingDayOverride);
      const reason = day === 0 ? 'Sunday (weekly holiday)'
        : holiday?.name || (holiday ? 'Calendar holiday' : 'Saturday (weekly holiday)');
      excludedDates.push({ date, reason });
    }
  }
  return { days: chargeableDates.length * (halfDay ? 0.5 : 1),
    calendarDays: chargeableDates.length + excludedDates.length, chargeableDates, excludedDates };
}
