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

/**
 * Enforce the single-active-row invariant shared by every workProgress
 * writer (client break/task actions, server PUT, repair scripts).
 *
 * If more than one row has startTime && !endTime, keep the most recently
 * started one open and close the earlier ones at `nowTime`, clamped to
 * each row's own start so no negative duration is ever invented.
 *
 * @returns {{ rows: Array, healed: number }}
 */
export function closeExtraActiveRows(rows, nowTime) {
  const list = Array.isArray(rows) ? rows : [];
  const openIdx = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.startTime && !list[i]?.endTime) openIdx.push(i);
  }
  if (openIdx.length <= 1) return { rows: list, healed: 0 };
  // Keep the most recently started open row; on ties the later array entry wins.
  const keep = openIdx.reduce((best, i) => {
    const a = list[i]?.startTime || '';
    const b = list[best]?.startTime || '';
    if (a > b) return i;
    if (a === b) return Math.max(best, i);
    return best;
  }, openIdx[0]);
  let healed = 0;
  const out = list.map((row, i) => {
    if (i === keep || !(row?.startTime && !row?.endTime)) return row;
    const s = row.startTime;
    // Clamp: never close before the row's own start (avoids negative or
    // overnight-crossover durations). With no reference time, close at the
    // row's own start (zero-duration completion).
    const endTime = !nowTime ? s : (s && s > nowTime ? s : nowTime);
    healed++;
    const next = { ...row, endTime, duration: null };
    if (next.status === 'work_in_progress') next.status = 'stopped';
    next.duration = computeWorkRowDuration(next);
    return next;
  });
  return { rows: out, healed };
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

/**
 * Hours and the short-hours flag for one completed day.
 *
 * There is NO strict 8-hour rule: `expectedHours` only caps `payableHours`
 * for display. `shortHours` is driven by two independent, additive triggers
 * (both optional via `ctx` so existing 3-arg callers keep working):
 *
 *   shortfallMins   — clock-out landed before the scheduled shift end
 *   breakExcessMins — break time taken over the allowances
 *
 * A 3-hour shift whose employee arrives on time and leaves at the expected
 * logout time is a full, non-short day regardless of `expectedHours`.
 * Late arrival is a separate judgement (`determineStatus`) and never sets
 * `shortHours` on its own.
 *
 * @param {Object} [ctx]
 * @param {string|null} [ctx.clockOut]       HH:MM actually clocked
 * @param {number|null} [ctx.clockOutMins]
 * @param {number|null} [ctx.shiftStartMins]
 * @param {number|null} [ctx.shiftEndMins]   scheduled shift end, wrap-aware
 * @param {number} [ctx.breakExcessMins]
 */
export function calculateHoursWorked(elapsedMins, breakDeduction, cfg, ctx = {}) {
  const baseHours = Math.max(0, elapsedMins);
  const hoursWorked = Math.max(0, baseHours - breakDeduction);
  const payableHours = Math.min(cfg.expectedHours, hoursWorked);

  let clockOutMins = ctx.clockOutMins;
  if (clockOutMins == null && ctx.clockOut) clockOutMins = toMinutes(ctx.clockOut);

  let shiftStartMins = ctx.shiftStartMins;
  if (shiftStartMins == null) shiftStartMins = toMinutes(cfg?.startTime);

  let shortfallMins = 0;
  if (clockOutMins != null && ctx.shiftEndMins != null && Number.isFinite(ctx.shiftEndMins)) {
    // Put a next-day clock-out on the shift-day timeline: for an overnight
    // shift whose end is already past midnight, a 05:00 clock-out is 29:00.
    if (
      Number.isFinite(shiftStartMins) &&
      ctx.shiftEndMins > 24 * 60 &&
      clockOutMins < shiftStartMins
    ) {
      clockOutMins += 24 * 60;
    }
    shortfallMins = Math.max(0, ctx.shiftEndMins - clockOutMins);
  }

  const breakExcessMins = Math.max(0, ctx.breakExcessMins ?? breakDeduction ?? 0);
  const shortHours = shortfallMins > 0 || breakExcessMins > 0;

  return { baseHours, hoursWorked, payableHours, shortfallMins, breakExcessMins, shortHours };
}

export function determineStatus(minutesSinceShiftStart, cfg) {
  if (minutesSinceShiftStart > cfg.lateThreshold) {
    const halfDayThresholdExceeded = Number.isFinite(cfg?.halfDayThreshold) && minutesSinceShiftStart >= cfg.halfDayThreshold;
    return { status: 'late', lateFlag: true, halfDayThresholdExceeded };
  }
  return { status: 'present', lateFlag: false, halfDayThresholdExceeded: false };
}
