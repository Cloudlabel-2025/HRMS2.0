import { SystemConfig, Holiday } from '@/lib/models/index';

export async function getGlobalConfig() {
  const doc = await SystemConfig.findOne({ key: 'global_config' }).lean();
  return doc?.value || {};
}

export function getPayrollDay(value, defaultDay) {
  if (!value) return defaultDay;
  const num = Number(value);
  if (!Number.isNaN(num) && num >= 1 && num <= 31) return num;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return Number(value.split('-')[2]);
  }
  return defaultDay;
}

export function getSaturdayOrdinal(year, month, day) {
  const d = new Date(year, month, day);
  if (d.getDay() !== 6) return 0;
  let count = 0;
  for (let i = 1; i <= day; i++) {
    if (new Date(year, month, i).getDay() === 6) count++;
  }
  return count;
}

export function isWorkingDay(dateStr, config, holidays) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = d.getDay();
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  if (dayOfWeek === 0) return false;

  if (holidays?.some(h => h.date === dateStr)) return false;

  if (dayOfWeek === 6) {
    if (config.saturdayWorking === 'all') return true;
    if (config.saturdayWorking === 'none') return false;
    if (config.saturdayWorking === 'alternate') {
      const ordinal = getSaturdayOrdinal(year, month, day);
      return ordinal === 2 || ordinal === 4;
    }
  }

  return true;
}

export function getCycleRange(payrollStartDay, payrollEndDay, year, month) {
  const prevM = month === 0 ? 11 : month - 1;
  const prevY = month === 0 ? year - 1 : year;
  const fromDate = `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(payrollStartDay).padStart(2, '0')}`;
  const toDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(payrollEndDay).padStart(2, '0')}`;
  return { fromDate, toDate };
}

export function getCycleMonth(dateStr, payrollStartDay) {
  const d = new Date(dateStr);
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  if (day >= payrollStartDay) {
    const nextMonth = new Date(year, month + 1, 1);
    return { year: nextMonth.getFullYear(), month: nextMonth.getMonth() };
  }
  return { year, month };
}

export function getCycleLabel(year, month, payrollStartDay, payrollEndDay) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  return `${names[prevMonth]} ${payrollStartDay} – ${names[month]} ${payrollEndDay}, ${year}`;
}

export async function countWorkingDays(fromDate, toDate, config) {
  const holidays = await Holiday.find({
    date: { $gte: fromDate, $lte: toDate },
  }).lean();

  let count = 0;
  const from = new Date(fromDate + 'T00:00:00');
  const to = new Date(toDate + 'T00:00:00');

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (isWorkingDay(dateStr, config, holidays)) {
      count++;
    }
  }

  return count;
}

export async function getCycleWorkingDays(year, month, config) {
  const startDay = config.payrollStartDay || 26;
  const endDay = config.payrollEndDay || 25;
  const { fromDate, toDate } = getCycleRange(startDay, endDay, year, month);
  const workingDays = await countWorkingDays(fromDate, toDate, config);
  return { fromDate, toDate, workingDays };
}

export function getCycleCalendarStats(fromDate, toDate) {
  let totalDays = 0;
  let sundays = 0;
  let alternateSaturdays = 0;

  const from = new Date(fromDate + 'T00:00:00');
  const to = new Date(toDate + 'T00:00:00');

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    totalDays++;
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0) {
      sundays++;
    } else if (dayOfWeek === 6) {
      const year = d.getFullYear();
      const month = d.getMonth();
      const day = d.getDate();
      let count = 0;
      for (let i = 1; i <= day; i++) {
        if (new Date(year, month, i).getDay() === 6) count++;
      }
      if (count === 2 || count === 4) alternateSaturdays++;
    }
  }

  return { totalDays, sundays, alternateSaturdays };
}

const TIME_IN_PARENS = /\((\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i;
const TIME_RANGE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i;

export function parseShiftStartTime(shiftName) {
  if (!shiftName) return null;

  // Try extracting from parentheses first: "Morning (9AM-6PM)" -> "9AM"
  const parenMatch = shiftName.match(TIME_IN_PARENS);
  if (parenMatch) {
    let h = Number(parenMatch[1]);
    const m = parenMatch[2] ? Number(parenMatch[2]) : 0;
    const ampm = parenMatch[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Try HH:MM format: "18:00-2:00" or "18:00 to 2:00"
  const colonMatch = shiftName.match(/(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    const h = Number(colonMatch[1]);
    const m = Number(colonMatch[2]);
    if (h >= 0 && h <= 23) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  // Try general time pattern: "6PM to 2AM" or "6PM-2AM"
  const rangeMatch = shiftName.match(TIME_RANGE);
  if (rangeMatch) {
    let h = Number(rangeMatch[1]);
    const m = rangeMatch[2] ? Number(rangeMatch[2]) : 0;
    const ampm = rangeMatch[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return null;
}
