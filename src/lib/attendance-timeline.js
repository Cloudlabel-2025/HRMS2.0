import { computeWorkRowDuration, toMinutes } from './attendance-constants';

const plain = row => row?.toObject ? row.toObject() : { ...row };
function identify(rows) {
  const counts = new Map();
  return rows.map(row => {
    const type = row.type || 'task';
    const index = counts.get(type) || 0;
    counts.set(type, index + 1);
    return { row, key: row._id ? String(row._id) : `${type}:${index}` };
  });
}

/** Align tasks with approved event boundaries without shifting later events. */
export function reconcileAttendanceTimeline(before, record) {
  const oldRows = identify((before.workProgress || []).map(plain));
  const current = identify((record.workProgress || []).map(plain));
  const shiftStart = toMinutes(record.shiftStartTime || before.shiftStartTime);
  const shiftEnd = toMinutes(record.shiftEndTime || before.shiftEndTime);
  const clockIn = toMinutes(before.clockIn || record.clockIn);
  const clockOut = toMinutes(before.clockOut || record.clockOut);
  const overnightShift = shiftStart !== null && shiftEnd !== null && shiftEnd < shiftStart;
  const overnight = overnightShift
    || (clockIn !== null && clockOut !== null && clockOut < clockIn)
    || (clockIn >= 720 && oldRows.some(({ row }) => row.endTime && toMinutes(row.endTime) < clockIn));
  let anchor = overnight ? (overnightShift ? shiftStart : clockIn ?? shiftStart ?? 0) : 0;
  if (overnight) {
    for (const time of [before.clockIn, record.clockIn]) {
      const value = toMinutes(time);
      if (value !== null && value < anchor && anchor - value < 720) anchor = value;
    }
  }
  const minute = time => {
    const value = toMinutes(time);
    return value === null ? null : value + (overnight && value < anchor ? 1440 : 0);
  };
  oldRows.sort((a, b) => (minute(a.row.startTime) ?? Infinity) - (minute(b.row.startTime) ?? Infinity));
  const oldByKey = new Map(oldRows.map(entry => [entry.key, entry.row]));
  const byKey = new Map(current.map(entry => [entry.key, entry]));
  // Existing event order survives corrections crossing a task's old timestamp.
  // Newly materialised events are inserted at their actual start time.
  const ordered = oldRows.filter(entry => byKey.has(entry.key)).map(entry => byKey.get(entry.key));
  for (const entry of current.filter(entry => !oldByKey.has(entry.key))) {
    const position = ordered.findIndex(other => (minute(other.row.startTime) ?? Infinity) > (minute(entry.row.startTime) ?? Infinity));
    ordered.splice(position < 0 ? ordered.length : position, 0, entry);
  }
  let firstTask = true;
  for (let index = 0; index < ordered.length; index++) {
    const { row, key } = ordered[index];
    if (row.type !== 'task') continue;
    const old = oldByKey.get(key);
    const previous = ordered[index - 1]?.row;
    const next = ordered[index + 1];
    if (previous?.endTime) row.startTime = previous.endTime;
    else if (index === 0 && record.clockIn) row.startTime = record.clockIn;
    if (firstTask && record.clockIn && minute(row.startTime) < minute(record.clockIn)) row.startTime = record.clockIn;
    firstTask = false;
    if (next && next.row.type !== 'task') {
      if (next.row.startTime) row.endTime = next.row.startTime;
    }
    if (index === ordered.length - 1 && record.clockOut
      && (record.clockOut !== before.clockOut || !row.endTime || row.endTime === before.clockOut)) row.endTime = record.clockOut;
    // Preserve a task consumed by an extended break as zero minutes, not 24h.
    if (row.startTime && row.endTime && minute(row.endTime) < minute(row.startTime)) row.endTime = row.startTime;
    if (row.endTime && (!old?.endTime || old.endTime !== row.endTime)) {
      if (row.status === 'work_in_progress') row.status = 'stopped';
      if (old?.completedAt && old.completedAt === old.endTime) row.completedAt = row.endTime;
    }
  }
  const last = ordered[ordered.length - 1]?.row;
  if (record.clockIn && ((!last) || (last.type !== 'task' && last.endTime && !record.clockOut))) {
    ordered.push({ key: 'resumed-task', row: {
      type: 'task', taskDetails: '', startTime: last?.endTime || record.clockIn,
      endTime: record.clockOut || null, status: record.clockOut ? 'stopped' : 'work_in_progress',
      remarks: '', feedback: '', resumedAfter: last?.type || null,
    } });
  }
  let previousEnd = null;
  for (const { row } of ordered) {
    const start = minute(row.startTime);
    const end = minute(row.endTime);
    if (start !== null && ((previousEnd !== null && start < previousEnd) || (end !== null && end < start))) {
      const error = new Error('Corrected timing overlaps another break or permission. Adjust the conflicting timings in the request.');
      error.statusCode = 400;
      throw error;
    }
    row.duration = computeWorkRowDuration(row);
    previousEnd = end ?? previousEnd;
  }
  record.workProgress = ordered.map(entry => entry.row);
  return record.workProgress;
}
