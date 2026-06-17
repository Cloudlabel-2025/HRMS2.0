/**
 * Compute the shift-aware "today" date for attendance.
 *
 * For shifts that cross midnight (e.g., 22:00-06:00), the attendance date
 * is the shift's start date, not the calendar date.  So at 01:00 the
 * attendance date is still "yesterday" (the shift start date) until the
 * shift end time passes.
 *
 * @param {Date} now             Current time
 * @param {string|null} shiftStartTime  Shift start time "HH:MM" or null
 * @param {string|null} shiftEndTime    Shift end time "HH:MM" or null
 * @returns {string}             Date string "YYYY-MM-DD"
 */
export function getAttendanceDate(now, shiftStartTime, shiftEndTime) {
  if (!shiftStartTime || !shiftEndTime) {
    return formatDate(now);
  }

  const [sH, sM] = shiftStartTime.split(':').map(Number);
  const [eH, eM] = shiftEndTime.split(':').map(Number);
  const startMinutes = sH * 60 + sM;
  const endMinutes = eH * 60 + eM;

  // Shift that crosses midnight (end < start)
  if (endMinutes < startMinutes) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    // Before shift end → still the previous shift day
    if (nowMinutes < endMinutes) {
      const prev = new Date(now);
      prev.setDate(prev.getDate() - 1);
      return formatDate(prev);
    }
  }

  return formatDate(now);
}

export function formatDate(date) {
  return date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');
}
