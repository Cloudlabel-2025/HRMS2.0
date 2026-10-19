import { computeWorkRowDuration, toMinutes } from './attendance-constants';

// Break timestamps are authoritative. Older clients could save task rows over
// the sheet without removing the separately stored attendance breaks.
export function reconcileBreakWorkProgress(record) {
  const plain = row => row?.toObject ? row.toObject() : { ...row };
  const rows = (record.workProgress || []).map(plain);
  const anchor = toMinutes(record.clockIn || record.shiftStartTime) ?? 0;
  const minute = time => {
    const value = toMinutes(time);
    return value === null ? null : value < anchor ? value + 1440 : value;
  };
  const time = value => `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const matched = new Set();
  const intervals = [];
  for (const entry of record.breaks || []) {
    if (!entry.start) continue;
    const start = minute(entry.start);
    if (start === null) continue;
    let end = entry.end ? minute(entry.end) : Infinity;
    if (end === null) continue;
    if (end < start) end += 1440;
    if (end > start) intervals.push({ start, end });
    let index = rows.findIndex((row, i) => !matched.has(i) && row.type === entry.type && row.startTime === entry.start && (!entry.name || row.taskDetails === entry.name));
    if (index === -1) index = rows.findIndex((row, i) => !matched.has(i) && row.type === entry.type && row.startTime === entry.start);
    const previous = index === -1 ? {} : rows[index];
    const row = {
      ...previous, type: entry.type, taskDetails: entry.name || previous.taskDetails || entry.type,
      startTime: entry.start, endTime: entry.end || null,
      status: entry.end ? 'completed' : 'work_in_progress',
      remarks: previous.remarks || '', feedback: previous.feedback || '',
    };
    row.duration = computeWorkRowDuration(row);
    if (index === -1) { index = rows.length; rows.push(row); }
    else rows[index] = row;
    matched.add(index);
  }
  if (!matched.size) return rows;

  // Remove break time from overlapping tasks, retaining task text and remarks.
  // A task spanning a completed break becomes a stopped and a resumed segment.
  const result = rows.flatMap(row => {
    if (row.type !== 'task' || !row.startTime) return [row];
    const start = minute(row.startTime);
    let end = row.endTime ? minute(row.endTime) : Infinity;
    if (start === null || end === null) return [row];
    if (end < start) end += 1440;
    let segments = [{ start, end }];
    for (const pause of intervals) {
      segments = segments.flatMap(segment => {
        if (pause.start >= segment.end || pause.end <= segment.start) return [segment];
        return [
          ...(segment.start < pause.start ? [{ start: segment.start, end: pause.start }] : []),
          ...(pause.end < segment.end ? [{ start: pause.end, end: segment.end }] : []),
        ];
      });
    }
    // Keep notes even if a stale task lies wholly inside a saved break.
    if (!segments.length) return [{ ...row, endTime: row.startTime, status: 'stopped', completedAt: null, completedDate: null, duration: 0 }];
    return segments.map((segment, i) => {
      if (segment.start === start && segment.end === end) return row;
      const next = { ...row, startTime: time(segment.start), endTime: Number.isFinite(segment.end) ? time(segment.end) : null };
      if (i > 0) { delete next._id; next.resumedAfter = 'break'; }
      if (segment.end !== end) {
        next.status = 'stopped'; next.completedAt = null; next.completedDate = null;
      }
      next.duration = computeWorkRowDuration(next);
      return next;
    });
  });
  return result.sort((a, b) => (minute(a.startTime) ?? Infinity) - (minute(b.startTime) ?? Infinity));
}
