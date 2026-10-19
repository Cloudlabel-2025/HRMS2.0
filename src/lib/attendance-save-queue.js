// Run the whole save (including applying its returned revision) before the next
// save starts. Blur, debounce and manual-save callers can share one request.
export function createAttendanceSaveQueue() {
  let tail = Promise.resolve();
  let generation = 0;
  let lastError;
  const pending = new Map();

  return (key, save) => {
    if (pending.has(key)) return pending.get(key);
    const queuedGeneration = generation;
    const result = tail.then(async () => {
      // A failed save may have reloaded corrected timing. Never replay queued
      // snapshots against that new revision.
      if (queuedGeneration !== generation) throw lastError;
      try {
        return await save();
      } catch (error) {
        lastError = error;
        generation++;
        throw error;
      }
    });
    pending.set(key, result);
    tail = result.then(
      () => { pending.delete(key); },
      () => { pending.delete(key); },
    );
    return result;
  };
}
