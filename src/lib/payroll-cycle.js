import { SystemConfig, Holiday } from '@/lib/models/index';
import { isSaturdayOff } from '@/lib/saturday-cycle';

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
  if (dayOfWeek === 0) return false;

  // Compensated working day: a Holiday row flagged workingDayOverride makes
  // the date working even though a Holiday record exists (Saturdays only —
  // enforced where the flag is written). Every other Holiday row still wins.
  // Rows may be date strings or { date, workingDayOverride } objects.
  const rows = Array.isArray(holidays) ? holidays : [];
  const sameDate = (h) => (typeof h === 'string' ? h === dateStr : h?.date === dateStr);
  if (rows.some(h => sameDate(h) && h?.workingDayOverride)) return true;
  if (rows.some(sameDate)) return false;

  // Saturday policy is authoritative (Settings → General → Saturday Working,
  // changeable at any time, default 'alternate').
  // 'all': every Saturday working unless explicit Holiday.
  // 'none': no Saturday working.
  // 'alternate' (default): Saturdays alternate continuously (leave, working,
  // leave, …) and the alternation never resets at a payroll-cycle boundary,
  // so a 5-Saturday cycle is L W L W L or W L W L W — never L W L W W.
  // The exact phase is chosen by Settings → Alternate Saturday Pattern
  // ('pattern1' / 'pattern2' mirrors, 'legacy' = old per-cycle 1st & 3rd).
  // Automatic, no Holiday doc or generator run required (explicit Holiday
  // docs still win).
  if (dayOfWeek === 6) {
    const mode = String(config?.saturdayWorking ?? 'alternate').toLowerCase();
    if (mode === 'none') return false;
    if (mode === 'alternate' && isSaturdayOff(dateStr, config)) return false;
  }

  return true;
}

/**
 * Full calendar classification for a range. Every date is exactly one of
 * 'working' | 'holiday' | 'weekly_off' — the single source the attendance
 * register, the absence grid and payroll all share.
 */
export function buildCalendarMap(fromDate, toDate, config = {}, holidays = []) {
  const holidaySet = new Set((holidays || []).map(h => (typeof h === 'string' ? h : h.date)));
  // Dates booked as compensated working days. The direct membership test
  // above would label them 'holiday' before isWorkingDay is ever consulted,
  // so they are carved out here to keep the whole map consistent.
  const overrideSet = new Set((holidays || []).filter(h => typeof h !== 'string' && h.workingDayOverride).map(h => h.date));
  const working = new Set();
  const holidayDates = new Set();
  const weeklyOff = new Set();
  const byDate = new Map();
  for (let cursor = new Date(`${fromDate}T00:00:00`), end = new Date(`${toDate}T00:00:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
    let kind;
    if (holidaySet.has(date) && !overrideSet.has(date)) kind = 'holiday';
    else if (!isWorkingDay(date, config, holidays)) kind = 'weekly_off';
    else kind = 'working';
    byDate.set(date, kind);
    if (kind === 'working') working.add(date);
    else if (kind === 'holiday') holidayDates.add(date);
    else weeklyOff.add(date);
  }
  return { working, holidays: holidayDates, weeklyOff, byDate };
}

/**
 * Single-source working-date set for a cycle. Leave, attendance and payroll
 * must all use this (or isWorkingDay directly) so Saturday/holiday handling
 * agrees and phantom LOP disappears.
 */
export function buildWorkingDateSet(fromDate, toDate, config = {}, holidays = []) {
  return buildCalendarMap(fromDate, toDate, config, holidays).working;
}

/**
 * Count working days in a leave span using the SAME calendar as payroll.
 * Respects policy.countWeekends/countHolidays: when policy excludes weekends,
 * non-working Saturdays/Sundays are skipped; when it includes them, only
 * Sundays + holidays are skipped via isWorkingDay (Saturdays per policy mode).
 */
export function countWorkingDaysInRange(fromStr, toStr, config = {}, holidays = [], { countWeekends = false, countHolidays = false } = {}) {
  const holidayDates = new Set((holidays || []).map(h => (typeof h === 'string' ? h : h.date)));
  // A compensated working day is not a holiday for counting purposes even
  // though it holds a Holiday row — it counts as a working day below.
  const overrideDates = new Set((holidays || []).filter(h => typeof h !== 'string' && h.workingDayOverride).map(h => h.date));
  let days = 0;
  for (let d = new Date(`${fromStr}T00:00:00`), last = new Date(`${toStr}T00:00:00`); d <= last; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dow = d.getDay();
    // Sundays are never leave days unless the policy counts weekends.
    if (dow === 0 && !countWeekends) continue;
    // Saturdays defer to the working calendar: a working Saturday is a leave
    // day even when countWeekends is off; an off Saturday never is.
    // countWeekends therefore governs Sundays only.
    if (dow === 6 && !isWorkingDay(dateStr, config, holidays)) continue;
    if (holidayDates.has(dateStr) && !overrideDates.has(dateStr) && !countHolidays) continue;
    // When weekends are counted, still exclude Sundays/holidays via isWorkingDay
    // so payroll and leave agree; Saturdays follow saturdayWorking mode.
    if (countWeekends && !isWorkingDay(dateStr, config, holidays)) {
      // Sunday or holiday: skip only if policy excludes holidays/weekends detail.
      // If policy explicitly counts weekends+holidays, include everything.
      if (!countHolidays && holidayDates.has(dateStr)) continue;
      if (dow === 0) continue;
    }
    days += 1;
  }
  return days;
}

export async function getWorkingDayCalendar(fromDate, toDate, config = {}) {
  const holidays = await Holiday.find({ date: { $gte: fromDate, $lte: toDate } }).lean();
  const holidayDates = holidays.map(holiday => holiday.date);
  let workingDays = 0;
  let sundays = 0;
  let saturdayHolidays = 0;
  for (const d = new Date(fromDate + 'T00:00:00'); d <= new Date(toDate + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (d.getDay() === 0) sundays++;
    if (d.getDay() === 6 && holidayDates.includes(dateStr)) saturdayHolidays++;
    if (isWorkingDay(dateStr, config, holidays)) workingDays++;
  }
  return { workingDays, holidays: holidayDates, workingDayOverrides: holidays.filter(h => h.workingDayOverride).map(h => h.date), sundays, saturdayHolidays };
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
  return `${names[prevMonth]} ${payrollStartDay} – ${names[month]} ${payrollEndDay}, ${year}`;
}

export function getCycleCalendarStats(fromDate, toDate, config = {}) {
  let totalDays = 0;
  let sundays = 0;
  let alternateSaturdays = 0;

  const from = new Date(fromDate + 'T00:00:00');
  const to = new Date(toDate + 'T00:00:00');
  const saturdayMode = String(config?.saturdayWorking ?? 'alternate').toLowerCase();

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    totalDays++;
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0) {
      sundays++;
    } else if (dayOfWeek === 6) {
      // Continuous alternation via the shared helper — same rule as
      // isWorkingDay/calendar/generate-saturdays. Only meaningful in
      // 'alternate' mode ('none' already treats every Saturday as off,
      // 'all' has no alternate Saturdays).
      if (saturdayMode !== 'alternate') continue;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (isSaturdayOff(dateStr, config)) alternateSaturdays++;
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
