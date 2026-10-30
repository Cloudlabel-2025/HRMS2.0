// Pure schedule helpers shared by validation, resolution and regression tests.
export function validScheduleDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function adjacentDate(date, offset) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}

const minutes = time => Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
export function elapsedScheduleMinutes(now, date, startTime) {
  return Math.floor((now.getTime() - new Date(`${date}T00:00:00`).getTime()) / 60000) - minutes(startTime);
}
export function scheduleWindow(shift, dayOffset = 0) {
  if (!shift?.startTime || !shift?.endTime) return null;
  const start = minutes(shift.startTime) + dayOffset * 1440;
  let end = minutes(shift.endTime) + dayOffset * 1440;
  if (end <= start) end += 1440;
  return { start, end };
}

export function snapshotShift(shift) {
  if (!shift) return null;
  const snapshot = {};
  for (const key of ['name', 'startTime', 'endTime', 'expectedHours', 'absentThreshold',
    'lateThreshold', 'earlyLoginWindow', 'autoLogoutAfterShiftEnd', 'halfDayThreshold']) {
    if (shift[key] !== undefined) snapshot[key] = shift[key];
  }
  snapshot.breaks = (shift.breaks || []).map(rule => ({
    name: rule.name || '', type: rule.type, maxDuration: rule.maxDuration, maxCount: rule.maxCount,
  }));
  return snapshot;
}

export function shiftFromOverride(override) {
  return override ? { ...override.snapshot, _id: override.shiftId,
    dayOverrideId: String(override._id), scheduleRevision: override.revision,
    scheduleDate: override.date } : null;
}

export function overrideValidation(shift) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(shift?.startTime || '') || !time.test(shift?.endTime || '') || shift.startTime === shift.endTime) {
    return 'Choose a shift with valid, different start and end times.';
  }
  const span = scheduleWindow(shift);
  const duration = span.end - span.start;
  if (!(shift.expectedHours > 0 && shift.expectedHours <= duration)) return 'Expected work minutes must fit within the shift.';
  for (const key of ['absentThreshold', 'halfDayThreshold', 'lateThreshold']) {
    if (!Number.isFinite(shift[key]) || shift[key] < 0 || shift[key] > shift.expectedHours) {
      return `${key} must be between zero and the expected work minutes.`;
    }
  }
  return null;
}

export function overlapsAdjacent(shift, previous, next) {
  const window = scheduleWindow(shift);
  const before = scheduleWindow(previous, -1);
  const after = scheduleWindow(next, 1);
  return Boolean(window && ((before && before.end > window.start) || (after && window.end > after.start)));
}

// Resolve against yesterday's actual schedule, never today's normal shift.
export function scheduleDayAt(now, today, todayShift, previousShift) {
  const previous = scheduleWindow(previousShift, -1);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (previous && previous.end > 0 && nowMinutes < previous.end) {
    return { date: adjacentDate(today, -1), shift: previousShift };
  }
  return { date: today, shift: todayShift };
}
