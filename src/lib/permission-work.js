import { computeWorkRowDuration } from './attendance-constants';

function toMins(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function reconcilePermissionWorkProgress(record, nowTimeStr) {
  if (!record?.clockIn || record?.clockOut) return false;
  const perm = record.permission;
  if (!perm?.requestId || !perm?.startTime || !perm?.endTime) return false;
  const nowMins = toMins(nowTimeStr);
  const startMins = toMins(perm.startTime);
  const endMinsRaw = toMins(perm.endTime);
  const endedAtMins = perm.endedAt ? toMins(perm.endedAt) : null;
  const effectiveEndMins = endedAtMins !== null ? endedAtMins : endMinsRaw;
  if (nowMins === null || startMins === null || endMinsRaw === null) return false;

  if (!Array.isArray(record.workProgress)) record.workProgress = [];
  const wp = record.workProgress;
  const permIdStr = String(perm.requestId);
  let permIdx = wp.findIndex(r => r.type === 'permission' && String(r.permissionRequestId || '') === permIdStr);
  if (permIdx === -1) {
    const legacyIdx = wp.findIndex(r => r.type === 'permission');
    if (legacyIdx !== -1) {
      wp[legacyIdx].permissionRequestId = perm.requestId;
      permIdx = legacyIdx;
    }
  }
  const permissionIndices = wp.reduce((a, r, i) => (r.type === 'permission' ? a.concat(i) : a), []);
  if (permissionIndices.length > 1) {
    const keep = permIdx !== -1 ? permIdx : permissionIndices[0];
    for (let k = permissionIndices.length - 1; k >= 0; k--) {
      const idx = permissionIndices[k];
      if (idx !== keep) wp.splice(idx, 1);
    }
    if (permIdx !== -1 && permIdx !== keep) permIdx = wp.findIndex(r => r.type === 'permission' && String(r.permissionRequestId || '') === permIdStr);
    else if (permIdx === -1) permIdx = keep;
  }
  let activeIdx = wp.findIndex(r => r.startTime && !r.endTime);

  const hasActivePerm = permIdx >= 0 && !wp[permIdx]?.endTime;
  const activeIsPerm = activeIdx >= 0 && wp[activeIdx]?.type === 'permission';

  let modified = permissionIndices.length > 1;

  const endTimeForPerm = perm.endedAt || perm.endTime;

  const invalidBlank = [];
  for (let i = 0; i < wp.length; i++) {
    const r = wp[i];
    if (r.type === 'task' && r.startTime && r.endTime && !String(r.taskDetails || '').trim()) {
      const s = toMins(r.startTime); const e = toMins(r.endTime);
      if (s !== null && e !== null && e < s) invalidBlank.push(i);
    }
    if (r.type !== 'permission' && r.type !== 'task' && r.startTime && r.endTime) {
      const s = toMins(r.startTime); const e = toMins(r.endTime);
      if (s !== null && e !== null && e < s) invalidBlank.push(i);
    }
  }
  if (invalidBlank.length > 0) {
    for (let k = invalidBlank.length - 1; k >= 0; k--) wp.splice(invalidBlank[k], 1);
    modified = true;
  }

  if (endedAtMins !== null) {
    if (permIdx >= 0 && !wp[permIdx]?.endTime) {
      wp[permIdx].endTime = endTimeForPerm;
      wp[permIdx].status = 'completed';
      wp[permIdx].duration = computeWorkRowDuration(wp[permIdx]);
      modified = true;
      const stillActive = wp.findIndex(r => r.startTime && !r.endTime);
      if (stillActive === -1) {
        wp.push({ type: 'task', taskDetails: '', startTime: endTimeForPerm, endTime: null, status: 'work_in_progress', remarks: '', feedback: '', duration: null, resumedAfter: 'permission' });
        modified = true;
      }
    }
    return modified;
  }

  if (nowMins >= startMins && nowMins < endMinsRaw) {
    if (!hasActivePerm) {
      if (activeIdx >= 0 && !activeIsPerm) {
        const active = wp[activeIdx];
        active.endTime = perm.startTime;
        active.status = 'completed';
        active.duration = computeWorkRowDuration(active);
        modified = true;
        permIdx = wp.findIndex(r => r.type === 'permission' && String(r.permissionRequestId || '') === permIdStr);
        activeIdx = wp.findIndex(r => r.startTime && !r.endTime);
      }
      if (permIdx === -1) {
        wp.push({
          type: 'permission',
          taskDetails: `Permission (${perm.startTime}-${perm.endTime})`,
          startTime: perm.startTime,
          endTime: null,
          status: 'work_in_progress',
          remarks: '',
          feedback: '',
          duration: null,
          permissionRequestId: perm.requestId,
        });
        modified = true;
      } else if (wp[permIdx]?.endTime) {
        wp[permIdx].endTime = null;
        wp[permIdx].status = 'work_in_progress';
        wp[permIdx].duration = null;
        modified = true;
      }
    }
  } else if (nowMins >= effectiveEndMins) {
    if (permIdx >= 0 && !wp[permIdx].endTime) {
      wp[permIdx].endTime = endTimeForPerm;
      wp[permIdx].status = 'completed';
      wp[permIdx].duration = computeWorkRowDuration(wp[permIdx]);
      modified = true;
      activeIdx = wp.findIndex(r => r.startTime && !r.endTime);
      if (activeIdx === -1) {
        wp.push({
          type: 'task',
          taskDetails: '',
          startTime: endTimeForPerm,
          endTime: null,
          status: 'work_in_progress',
          remarks: '',
          feedback: '',
          duration: null,
          resumedAfter: 'permission',
        });
        modified = true;
      }
    }
  }
  return modified;
}

export function closePermissionEarly(record, endTimeStr) {
  const perm = record?.permission;
  if (!perm?.requestId) return { error: 'No approved permission on this date' };
  if (!record.clockIn) return { error: 'Clock in first' };
  if (record.clockOut) return { error: 'Already clocked out' };
  const startMins = toMins(perm.startTime);
  const endMins = toMins(perm.endTime);
  const nowMins = toMins(endTimeStr);
  if (nowMins === null) return { error: 'Invalid end time' };
  if (startMins !== null && nowMins < startMins) return { error: 'Cannot end before permission start' };
  if (endMins !== null && nowMins > endMins) return { error: 'End time is after scheduled permission end' };
  if (perm.endedAt) return { error: 'Permission already ended', already: true };

  if (!Array.isArray(record.workProgress)) record.workProgress = [];
  const wp = record.workProgress;
  const permIdStr = String(perm.requestId);
  let permIdx = wp.findIndex(r => r.type === 'permission' && String(r.permissionRequestId || '') === permIdStr);
  if (permIdx === -1) {
    const legacyIdx = wp.findIndex(r => r.type === 'permission');
    if (legacyIdx !== -1) {
      wp[legacyIdx].permissionRequestId = perm.requestId;
      permIdx = legacyIdx;
    }
  }
  const dupIndices = wp.reduce((a, r, i) => (r.type === 'permission' && i !== permIdx ? a.concat(i) : a), []);
  if (dupIndices.length > 0) {
    for (let k = dupIndices.length - 1; k >= 0; k--) wp.splice(dupIndices[k], 1);
    if (permIdx !== -1 && dupIndices.some(idx => idx < permIdx)) permIdx -= dupIndices.filter(idx => idx < permIdx).length;
  }
  if (permIdx === -1) {
    const activeIdx = wp.findIndex(r => r.startTime && !r.endTime);
    if (activeIdx >= 0) {
      wp[activeIdx].endTime = perm.startTime;
      wp[activeIdx].status = 'completed';
      wp[activeIdx].duration = computeWorkRowDuration(wp[activeIdx]);
    }
    wp.push({
      type: 'permission',
      taskDetails: `Permission (${perm.startTime}-${perm.endTime})`,
      startTime: perm.startTime,
      endTime: endTimeStr,
      status: 'completed',
      remarks: '',
      feedback: '',
      duration: computeWorkRowDuration({ startTime: perm.startTime, endTime: endTimeStr }),
      permissionRequestId: perm.requestId,
    });
  } else {
    wp[permIdx].endTime = endTimeStr;
    wp[permIdx].status = 'completed';
    wp[permIdx].duration = computeWorkRowDuration(wp[permIdx]);
  }
  const activeIdx = wp.findIndex(r => r.startTime && !r.endTime);
  if (activeIdx === -1) {
    wp.push({
      type: 'task',
      taskDetails: '',
      startTime: endTimeStr,
      endTime: null,
      status: 'work_in_progress',
      remarks: '',
      feedback: '',
      duration: null,
      resumedAfter: 'permission',
    });
  }
  perm.endedAt = endTimeStr;
  perm.endedEarly = true;
  return { ok: true };
}
