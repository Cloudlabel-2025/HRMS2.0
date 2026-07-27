function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function diffMins(start, end) {
  if (!start || !end) return 0;
  const s = toMinutes(start), e = toMinutes(end);
  return e > s ? e - s : 0;
}

export function getShiftConfig(shiftDoc, globalConfig) {
  return {
    expectedHours:    shiftDoc?.expectedHours ?? 480,
    hardCapHours:     shiftDoc?.hardCapHours ?? 600,
    absentThreshold:  shiftDoc?.absentThreshold ?? 240,
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
  if (minutesSinceShiftStart > 300) return { status: 'leave', lateFlag: true };
  if (minutesSinceShiftStart > 180) return { status: 'half_day', lateFlag: true };
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
