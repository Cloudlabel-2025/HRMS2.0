import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createAttendanceSaveQueue } from '../src/lib/attendance-save-queue.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('blur and debounce share one in-flight save for the same sheet', async () => {
  const enqueue = createAttendanceSaveQueue();
  const response = deferred();
  let writes = 0;
  const save = () => { writes++; return response.promise; };
  const first = enqueue('same rows', save);
  const second = enqueue('same rows', save);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(writes, 1);
  response.resolve('saved');
  assert.equal(await second, 'saved');
});

test('typing during a save waits for its returned revision before saving newer text', async () => {
  const enqueue = createAttendanceSaveQueue();
  const response = deferred();
  let revision = 4;
  const submitted = [];
  const first = enqueue('old text', async () => {
    submitted.push([revision, 'old text']);
    await response.promise;
    revision = 5;
  });
  const second = enqueue('new text', async () => {
    submitted.push([revision, 'new text']);
    revision = 6;
  });
  await Promise.resolve();
  assert.deepEqual(submitted, [[4, 'old text']]);
  response.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(submitted, [[4, 'old text'], [5, 'new text']]);
});

test('a break action shares the queue with a pending task autosave', async () => {
  const enqueue = createAttendanceSaveQueue();
  const response = deferred();
  const events = [];
  const autosave = enqueue('task', async () => {
    events.push('saving text');
    await response.promise;
    events.push('text saved');
  });
  const breakSave = enqueue('break', async () => { events.push('break saved'); });
  await Promise.resolve();
  assert.deepEqual(events, ['saving text']);
  response.resolve();
  await Promise.all([autosave, breakSave]);
  assert.deepEqual(events, ['saving text', 'text saved', 'break saved']);
});

test('a genuine conflict cancels queued stale snapshots and allows a fresh save', async () => {
  const enqueue = createAttendanceSaveQueue();
  const conflict = new Error('Attendance timing was corrected');
  let staleWrites = 0;
  const first = enqueue('first', async () => { throw conflict; });
  const stale = enqueue('stale snapshot', async () => { staleWrites++; });
  await Promise.all([
    assert.rejects(first, error => error === conflict),
    assert.rejects(stale, error => error === conflict),
  ]);
  assert.equal(staleWrites, 0);
  assert.equal(await enqueue('fresh snapshot', async () => 'saved'), 'saved');
});

test('an unchanged snapshot can be saved again after the previous request completes', async () => {
  const enqueue = createAttendanceSaveQueue();
  await assert.rejects(enqueue('text', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await enqueue('text', async () => 'retried'), 'retried');
});

// Exercise the actual page handlers with deferred network responses, without a
// database or browser, so React/UI wiring cannot bypass the shared save queue.
const page = await readFile(new URL('../src/app/(protected)/attendance/page.js', import.meta.url), 'utf8');
function pageHandlers(put) {
  const rows = [{ type: 'task', taskDetails: 'Initial text' }];
  const record = { date: '2026-10-19', timelineRevision: 0, workProgress: rows };
  const state = {
    today: record.date,
    todayRecordRef: { current: record },
    workProgressRef: { current: rows },
    savedWorkProgressRef: { current: null },
    workProgressSaveTimer: { current: null },
    attendanceSaveQueue: { current: createAttendanceSaveQueue() },
    api: { put },
    clearTimeout,
    setWorkProgressDirty: () => {},
    setIsDirty: () => {},
    loadTodayRecord: async () => {},
    showToast: () => {},
  };
  state.setTodayRecord = update => {
    state.record = typeof update === 'function' ? update(state.record) : update;
  };
  state.record = record;
  const persist = page.slice(page.indexOf('  const persistTodayRecord ='), page.indexOf('  // Keep workProgressRef and the debounced'));
  const save = page.slice(page.indexOf('  const saveWorkProgress ='), page.indexOf('  const computeTries ='));
  vm.runInNewContext(`${persist}\n${save}\nthis.save = saveWorkProgress; this.persist = persistTodayRecord;`, state);
  return state;
}

test('page blur/debounce handlers submit once and skip unchanged canonical rows', async () => {
  const response = deferred();
  let writes = 0;
  const state = pageHandlers(async (_, payload) => {
    writes++;
    await response.promise;
    return { ...payload, timelineRevision: payload.timelineRevision + 1 };
  });
  const first = state.save();
  const blur = state.save();
  response.resolve();
  assert.deepEqual(await Promise.all([first, blur]), [true, true]);
  assert.equal(writes, 1);
  assert.equal(await state.save(), true);
  assert.equal(writes, 1);
});

test('page handlers preserve newer text and save it using the previous response revision', async () => {
  const response = deferred();
  const revisions = [];
  const state = pageHandlers(async (_, payload) => {
    revisions.push(payload.timelineRevision);
    if (revisions.length === 1) await response.promise;
    return { ...payload, timelineRevision: payload.timelineRevision + 1 };
  });
  const first = state.save();
  await Promise.resolve();
  const newerRows = [{ type: 'task', taskDetails: 'Newer text' }];
  state.workProgressRef.current = newerRows;
  state.record = { ...state.record, workProgress: newerRows };
  const second = state.save();
  response.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(revisions, [0, 1]);
  assert.equal(state.record.workProgress[0].taskDetails, 'Newer text');
  assert.equal(state.record.timelineRevision, 2);
});

test('task action response does not discard text typed while it is saving', async () => {
  const response = deferred();
  const state = pageHandlers(async (_, payload) => {
    await response.promise;
    return { ...payload, timelineRevision: 1 };
  });
  const action = state.persist({ workProgress: state.workProgressRef.current });
  await Promise.resolve();
  const newerRows = [{ type: 'task', taskDetails: 'Typed during task action' }];
  state.workProgressRef.current = newerRows;
  state.record = { ...state.record, workProgress: newerRows };
  response.resolve();
  await action;
  assert.equal(state.record.workProgress, newerRows);
  assert.equal(state.todayRecordRef.current.timelineRevision, 1);
});

test('a failed page save reports failure to the manual save button', async () => {
  const state = pageHandlers(async () => { throw new Error('Network failed'); });
  assert.equal(await state.save(), false);
});
