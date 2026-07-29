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

export function getShiftConfig(shiftDoc, globalConfig) {
  return {
    expectedHours:    shiftDoc?.expectedHours ?? 480,
    hardCapHours:     shiftDoc?.hardCapHours ?? 600,
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
  const capped = Math.min(cfg.hardCapHours, Math.max(0, elapsedMins));
  const effective = Math.min(cfg.expectedHours, Math.max(0, capped - breakDeduction));
  return { baseHours: capped, hoursWorked: effective };
}

export function determineStatus(minutesSinceShiftStart, cfg) {
  const halfDayThreshold = cfg.halfDayThreshold ?? 180;
  const absentThreshold = cfg.absentThreshold ?? 240;
  if (minutesSinceShiftStart > absentThreshold) return { status: 'absent', lateFlag: true };
  if (minutesSinceShiftStart > halfDayThreshold) return { status: 'half_day', lateFlag: true };
  if (minutesSinceShiftStart > cfg.lateThreshold) return { status: 'late', lateFlag: true };
  return { status: 'present', lateFlag: false };
}

export function calculateBreakDeduction(breaks, shiftBreaks) {
  let deduction = 0;
  for (const b of (breaks || []).filter(b => b.end)) {
    const rule = shiftBreaks.find(r => r.type === b.type);
    const allowance = rule?.maxDuration ?? (b.type === 'lunch' ? 60 : 30);
    const duration = diffMins(b.start, b.end);
    deduction += Math.max(0, duration - allowance);
  }
  return deduction;
}

export function getBreakAllowance(type, shiftConfig) {
  const rule = shiftConfig?.breaks?.find(b => b.type === type);
  return rule?.maxDuration ?? (type === 'lunch' ? 60 : 30);
}
