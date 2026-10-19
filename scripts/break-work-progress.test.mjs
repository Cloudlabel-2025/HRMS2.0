import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);
import test from 'node:test';
import assert from 'node:assert/strict';
const { reconcileBreakWorkProgress: reconcile } = await import('../src/lib/break-work-progress.js');
const task = (startTime, endTime = null) => ({ _id: 'task1', type: 'task', taskDetails: 'Development', startTime, endTime, status: endTime ? 'completed' : 'work_in_progress', remarks: 'Retain notes' });

test('restores a completed missing break and splits an overlapping task without double counting', () => {
  const record = { clockIn: '09:00', breaks: [{ type: 'tea', name: 'Tea', start: '10:00', end: '10:15' }], workProgress: [task('09:00', '12:00')] };
  const original = structuredClone(record);
  const rows = reconcile(record);
  assert.deepEqual(rows.map(r => [r.type, r.startTime, r.endTime, r.status]), [
    ['task', '09:00', '10:00', 'stopped'], ['tea', '10:00', '10:15', 'completed'], ['task', '10:15', '12:00', 'completed'],
  ]);
  assert.equal(rows[0]._id, 'task1');
  assert.equal(rows[2]._id, undefined);
  assert.equal(rows[2].remarks, 'Retain notes');
  assert.equal(rows.reduce((sum, row) => sum + row.duration, 0), 180);
  assert.deepEqual(record, original);
  assert.deepEqual(reconcile({ ...record, workProgress: rows }), rows);
});

test('an open break closes overlapping work and remains the only active row', () => {
  const rows = reconcile({ clockIn: '09:00', breaks: [{ type: 'break', start: '10:00' }], workProgress: [task('09:00')] });
  assert.equal(rows[0].endTime, '10:00');
  assert.equal(rows[0].status, 'stopped');
  assert.equal(rows.filter(r => r.startTime && !r.endTime).length, 1);
  assert.equal(rows[1].type, 'break');
  assert.equal(rows[1].duration, null);
});

test('closing a break updates its existing row, preserving its identity and feedback', () => {
  const rows = reconcile({ clockIn: '09:00', breaks: [{ type: 'break', name: 'Tea', start: '10:00', end: '10:10' }], workProgress: [
    { _id: 'break1', type: 'break', taskDetails: 'Tea', startTime: '10:00', endTime: null, feedback: 'Preserve' },
    task('10:10'),
  ] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]._id, 'break1');
  assert.equal(rows[0].feedback, 'Preserve');
  assert.equal(rows[0].duration, 10);
  assert.equal(rows[0].status, 'completed');
});

test('overnight breaks split tasks in shift order and repeated breaks stay distinct', () => {
  const record = { clockIn: '22:00', breaks: [
    { type: 'break', start: '23:50', end: '00:10' },
    { type: 'break', start: '01:00', end: '01:10' },
  ], workProgress: [task('22:00', '06:00')] };
  const rows = reconcile(record);
  assert.deepEqual(rows.map(r => [r.startTime, r.endTime]), [
    ['22:00', '23:50'], ['23:50', '00:10'], ['00:10', '01:00'], ['01:00', '01:10'], ['01:10', '06:00'],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.duration, 0), 480);
  assert.deepEqual(reconcile({ ...record, workProgress: rows }), rows);
});

test('permission rows, task metadata and multiple rules of the same type are preserved', () => {
  const permission = { type: 'permission', startTime: '11:00', endTime: '11:30', permissionRequestId: 'request1' };
  const rows = reconcile({ clockIn: '09:00', breaks: [
    { type: 'break', name: 'Morning', start: '10:00', end: '10:10' },
    { type: 'break', name: 'Afternoon', start: '14:00', end: '14:10' },
  ], workProgress: [task('09:00', '10:00'), permission] });
  assert.deepEqual(rows.find(r => r.type === 'permission'), permission);
  assert.deepEqual(rows.filter(r => r.type === 'break').map(r => r.taskDetails), ['Morning', 'Afternoon']);
  assert.equal(rows[0].remarks, 'Retain notes');
});

test('a task wholly inside a break retains its notes with zero counted work time', () => {
  const record = { clockIn: '09:00', breaks: [{ type: 'break', start: '10:00', end: '10:30' }], workProgress: [task('10:05', '10:10')] };
  const rows = reconcile(record);
  const savedTask = rows.find(row => row.type === 'task');
  assert.equal(savedTask.remarks, 'Retain notes');
  assert.equal(savedTask._id, 'task1');
  assert.equal(savedTask.duration, 0);
  assert.deepEqual(reconcile({ ...record, workProgress: rows }), rows);
});
