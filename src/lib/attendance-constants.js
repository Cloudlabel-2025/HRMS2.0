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

/**
 * Gross shift length in minutes, derived purely from the shift window
 * (startTime -> endTime), wrap-aware for overnight shifts. Returns null
 * when the window is unresolvable — callers must not cap in that case.
 * There is no fixed-hours target anywhere in the system.
 */
export function shiftGrossMins(shiftDoc) {
  const s = shiftDoc?.startTime, e = shiftDoc?.endTime;
  if (!s || !e || typeof s !== 'string' || typeof e !== 'string') return null;
  return diffMins(s, e);
}

export function getShiftConfig(shiftDoc, globalConfig) {
  return {
    startTime:        shiftDoc?.startTime || '',
    endTime:          shiftDoc?.endTime || '',
    grossMins:        shiftGrossMins(shiftDoc),
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
 * There is NO fixed-hours target: `payableHours` is capped only by the
 * shift's own gross window (`cfg.grossMins`, i.e. startTime -> endTime),
 * and uncapped when the window is unresolvable. `shortHours` is driven by
 * three independent, additive triggers (all optional via `ctx` so existing
 * 3-arg callers keep working):
 *
 *   shortfallMins   — clock-out landed before the scheduled shift end
 *   breakExcessMins — break time taken over the allowances
 *   overrunMins     — permission time exceeded past the approved end
 *
 * A 3-hour shift whose employee arrives on time and leaves at the expected
 * logout time is a full, non-short day regardless of any hours number.
 * Late arrival is a separate judgement (`determineStatus`) and never sets
 * `shortHours` on its own.
 *
 * @param {Object} [ctx]
 * @param {string|null} [ctx.clockOut]       HH:MM actually clocked
 * @param {number|null} [ctx.clockOutMins]
 * @param {number|null} [ctx.shiftStartMins]
 * @param {number|null} [ctx.shiftEndMins]   scheduled shift end, wrap-aware
 * @param {number} [ctx.breakExcessMins]
 * @param {number} [ctx.permissionMins]      approved window minutes before clock-in
 * @param {number} [ctx.overrunMins]         permission minutes past the approved end
 */
export function calculateHoursWorked(elapsedMins, breakDeduction, cfg, ctx = {}) {
  const permissionMins = Math.max(0, Number(ctx.permissionMins) || 0);
  const overrunMins = Math.max(0, Number(ctx.overrunMins) || 0);
  const baseHours = Math.max(0, elapsedMins + permissionMins);
  const hoursWorked = Math.max(0, baseHours - breakDeduction);
  const cap = Number.isFinite(cfg?.grossMins) && cfg.grossMins > 0 ? cfg.grossMins : Number.POSITIVE_INFINITY;
  const payableHours = Math.min(cap, hoursWorked);

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
  const shortHours = shortfallMins > 0 || breakExcessMins > 0 || overrunMins > 0;

  return { baseHours, hoursWorked, payableHours, shortfallMins, breakExcessMins, shortHours, permissionMins, overrunMins };
}

export function determineStatus(minutesSinceShiftStart, cfg) {
  if (minutesSinceShiftStart > cfg.lateThreshold) {
    const halfDayThresholdExceeded = Number.isFinite(cfg?.halfDayThreshold) && minutesSinceShiftStart >= cfg.halfDayThreshold;
    return { status: 'late', lateFlag: true, halfDayThresholdExceeded };
  }
  return { status: 'present', lateFlag: false, halfDayThresholdExceeded: false };
}

/**
 * OVERTIME — INTENTIONALLY NOT IMPLEMENTED. Reserved extension point.
 *
 * The intended future rule is: a clock-out later than the shift's end time
 * yields overtime minutes. Deliberately NOT decided here, because each of
 * these is a policy question that must be answered before any money moves:
 *
 *   - the grace band before overtime starts counting
 *   - whether a late clock-out is paid at the same rate as a normal hour
 *   - whether overtime attaches to gross, basic, or only an OT-specific component
 *   - whether overtime is paid out, or banked and paid later
 *   - whether overtime is capped per day / per month
 *   - whether an auto-logout (system-forced clock-out) counts as overtime —
 *     it almost certainly must NOT
 *
 * Until those are settled this returns 0 and MUST NOT be added to net pay.
 * `Attendance.overtimeMinutes` is storage for the eventual value only.
 *
 * @param {Object} rec - Attendance record
 * @param {Object} cfg - shift config
 * @returns {number} always 0 for now
 */
export function computeOvertimeMinutes(rec, cfg) { // eslint-disable-line no-unused-vars
  return 0;
}
