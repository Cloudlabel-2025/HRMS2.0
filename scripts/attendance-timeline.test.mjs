import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);
import test from 'node:test';
import assert from 'node:assert/strict';
const { reconcileAttendanceTimeline } = await import('../src/lib/attendance-timeline.js');
const task = (id, startTime, endTime = null) => ({ _id: id, type: 'task', taskDetails: `Task ${id}`, startTime, endTime, status: endTime ? 'completed' : 'work_in_progress', remarks: 'Keep remarks', tries: 2 });
const event = (type, id, startTime, endTime) => ({ _id: id, type, taskDetails: id, startTime, endTime, status: endTime ? 'completed' : 'work_in_progress' });
const day = rows => ({ clockIn: '09:00', clockOut: null, date: '2026-10-17', workProgress: rows });

for (const type of ['break', 'lunch', 'tea', 'personal', 'permission']) {
  test(`${type} corrected earlier moves the following task to the approved end`, () => {
    const before = day([task('a', '09:00', '10:00'), event(type, 'b', '10:00', '10:45'), task('c', '10:45', '12:00'), task('d', '12:00')]);
    const after = structuredClone(before);
    after.workProgress[1].endTime = '10:15';
    reconcileAttendanceTimeline(before, after);
    assert.equal(after.workProgress[2].startTime, '10:15');
    assert.equal(after.workProgress[2].endTime, '12:00');
    assert.equal(after.workProgress[2].duration, 105);
    assert.equal(after.workProgress[2].taskDetails, 'Task c');
    assert.equal(after.workProgress[2].remarks, 'Keep remarks');
    assert.equal(after.workProgress[2].tries, 2);
    assert.equal(after.workProgress[2].status, 'completed');
    assert.equal(after.workProgress[3].startTime, '12:00');
    assert.equal(after.workProgress[3].duration, null);
    assert.equal(before.workProgress[2].startTime, '10:45');
  });
}

test('clock-in correction changes the first task without shifting later fixed events', () => {
  const before = day([task('a', '09:00', '10:00'), event('lunch', 'b', '10:00', '10:30'), task('c', '10:30')]);
  const after = structuredClone(before);
  after.clockIn = '08:45';
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].startTime, '08:45');
  assert.equal(after.workProgress[0].duration, 75);
  assert.equal(after.workProgress[1].startTime, '10:00');
  assert.equal(after.workProgress[1].endTime, '10:30');
  assert.equal(after.workProgress[2].startTime, '10:30');
});

test('correcting a break start updates the preceding task end and its cached completion time', () => {
  const before = day([{ ...task('a', '09:00', '10:00'), completedAt: '10:00' }, event('break', 'b', '10:00', '10:30'), task('c', '10:30')]);
  const after = structuredClone(before);
  after.workProgress[1].startTime = '10:10';
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].endTime, '10:10');
  assert.equal(after.workProgress[0].completedAt, '10:10');
  assert.equal(after.workProgress[0].duration, 70);
});

test('clock-out correction updates the last task end and duration', () => {
  const before = { ...day([task('a', '09:00', '18:00')]), clockOut: '18:00' };
  const after = { ...structuredClone(before), clockOut: '17:30' };
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].endTime, '17:30');
  assert.equal(after.workProgress[0].duration, 510);
});

test('repeated break instances are matched by identity', () => {
  const before = day([task('a', '09:00', '10:00'), event('break', 'b1', '10:00', '10:15'), task('c', '10:15', '12:00'), event('break', 'b2', '12:00', '12:45'), task('e', '12:45')]);
  const after = structuredClone(before);
  after.workProgress[3].endTime = '12:15';
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[2].startTime, '10:15');
  assert.equal(after.workProgress[4].startTime, '12:15');
});

test('a correction extending past a short task does not manufacture overnight work', () => {
  const before = day([task('a', '09:00', '10:00'), event('break', 'b', '10:00', '10:15'), task('c', '10:15', '10:30'), task('d', '10:30')]);
  const after = structuredClone(before);
  after.workProgress[1].endTime = '10:45';
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[2].startTime, '10:45');
  assert.equal(after.workProgress[2].endTime, '10:45');
  assert.equal(after.workProgress[2].duration, 0);
  assert.equal(after.workProgress[3].startTime, '10:45');
});

test('overnight correction moves the next task across midnight correctly', () => {
  const before = { ...day([task('a', '22:00', '23:45'), event('break', 'b', '23:45', '00:30'), task('c', '00:30', '06:00')]), clockIn: '22:00', clockOut: '06:00', shiftStartTime: '22:00', shiftEndTime: '06:00' };
  const after = structuredClone(before);
  after.workProgress[1].endTime = '00:15';
  after.clockIn = '21:55';
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].startTime, '21:55');
  assert.equal(after.workProgress[2].startTime, '00:15');
  assert.equal(after.workProgress[2].duration, 345);
});

test('removing a break joins the following task to the previous task end', () => {
  const before = day([task('a', '09:00', '10:00'), event('break', 'b', '10:00', '10:30'), task('c', '10:30')]);
  const after = structuredClone(before);
  after.workProgress.splice(1, 1);
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[1].startTime, '10:00');
});

test('newly materialised permission rows are inserted into the timeline', () => {
  const before = day([task('a', '09:00', '10:00'), task('b', '10:45')]);
  const after = structuredClone(before);
  after.workProgress.push(event('permission', 'p', '10:00', '10:15'));
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[1].type, 'permission');
  assert.equal(after.workProgress[2].startTime, '10:15');
});

test('conflicting fixed events reject the correction instead of creating overlaps', () => {
  const before = day([task('a', '09:00', '10:00'), event('break', 'b', '10:00', '10:15'), task('c', '10:15', '10:30'), event('permission', 'p', '10:30', '11:00')]);
  const after = structuredClone(before);
  after.workProgress[1].endTime = '10:45';
  assert.throws(() => reconcileAttendanceTimeline(before, after), /overlaps/);
});

test('a newly recorded completed break resumes an open day at its approved end', () => {
  const before = day([task('a', '09:00')]);
  const after = structuredClone(before);
  after.workProgress.push(event('break', 'b', '10:00', '10:15'));
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].endTime, '10:00');
  assert.equal(after.workProgress[2].type, 'task');
  assert.equal(after.workProgress[2].startTime, '10:15');
  assert.equal(after.workProgress[2].endTime, null);
  assert.equal(after.workProgress.filter(row => !row.endTime).length, 1);
});

test('clock-in correction with no existing worksheet seeds a task at the corrected time', () => {
  const before = { clockIn: null, clockOut: null, workProgress: [] };
  const after = { ...structuredClone(before), clockIn: '09:15' };
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].startTime, '09:15');
  assert.equal(after.workProgress[0].duration, null);
});

test('break and permission corrections in the same request align each resumed task independently', () => {
  const before = day([task('a', '09:00', '10:00'), event('break', 'b', '10:00', '10:45'), task('c', '10:45', '12:00'), event('permission', 'p', '12:00', '13:00'), task('e', '13:00')]);
  const after = structuredClone(before);
  after.workProgress[1].endTime = '10:15';
  after.workProgress[3].endTime = '12:30';
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[2].startTime, '10:15');
  assert.equal(after.workProgress[3].startTime, '12:00');
  assert.equal(after.workProgress[4].startTime, '12:30');
});

test('previously approved break times repair both adjacent tasks without reapplying the request', () => {
  const before = { ...day([task('a', '10:01', '12:21'), event('break', 'b', '12:20', '12:35'), task('c', '13:36', '14:04'), task('d', '14:04')]), clockIn: '10:01' };
  const after = structuredClone(before);
  reconcileAttendanceTimeline(before, after);
  assert.equal(after.workProgress[0].endTime, '12:20');
  assert.equal(after.workProgress[2].startTime, '12:35');
  assert.equal(after.workProgress[2].duration, 89);
});
