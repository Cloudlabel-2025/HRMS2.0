export function toMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function diffMins(start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return 0;
  if (e >= s) return e - s;
  return e + (24 * 60) - s; // overnight crossover
}

export function computeWorkRowDuration(row) {
  if (!row?.startTime || !row?.endTime) return null;
  return diffMins(row.startTime, row.endTime);
}

export function formatTaskDuration(row) {
  if (!row?.startTime) return '—';
  if (!row?.endTime) return 'Running';
  const mins = typeof row.duration === 'number' ? row.duration : computeWorkRowDuration(row);
  if (mins == null) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function getShiftConfig(shiftDoc, globalConfig) {
  return {
    startTime:        shiftDoc?.startTime || '',
    endTime:          shiftDoc?.endTime || '',
    expectedHours:    shiftDoc?.expectedHours ?? 480,
    absentThreshold:  shiftDoc?.absentThreshold ?? 240,
    halfDayThreshold: shiftDoc?.halfDayThreshold ?? 180,
    lateThreshold:    shiftDoc?.lateThreshold ?? (Number(globalConfig?.lateThreshold) || 15),
    earlyWindow:      shiftDoc?.earlyLoginWindow ?? 120,
    autoLogoutBuffer: shiftDoc?.autoLogoutAfterShiftEnd ?? 360,
    breaks:           shiftDoc?.breaks?.length ? shiftDoc.breaks : [
      { type: 'break', maxDuration: 30, maxCount: 1 },
      { type: 'lunch', maxDuration: 60, maxCount: 1 },
    ],
  };
}

export function calculateHoursWorked(elapsedMins, breakDeduction, cfg) {
  const baseHours = Math.max(0, elapsedMins);
  const hoursWorked = Math.max(0, baseHours - breakDeduction);
  const payableHours = Math.min(cfg.expectedHours, hoursWorked);
  return { baseHours, hoursWorked, payableHours, shortHours: hoursWorked < cfg.expectedHours };
}

export function determineStatus(minutesSinceShiftStart, cfg) {
  // Arrival time is informational. It must never create absence, half-day, or LOP.
  if (minutesSinceShiftStart > cfg.lateThreshold) return { status: 'late', lateFlag: true };
  return { status: 'present', lateFlag: false };
}
