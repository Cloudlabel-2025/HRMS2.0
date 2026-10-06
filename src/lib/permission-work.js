import { computeWorkRowDuration } from './attendance-constants';
import { permissionOverrunMins } from './permission-window';

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
          scheduledEndTime: perm.endTime,
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
    // The window has passed but nobody ended the permission: it stays
    // open (still blocks tasks/breaks/clock-out) until explicitly ended.
    // Never auto-close — ending is always an explicit act. Flag the
    // overrun so the UI shows "time exceeded" and the day is marked late.
    // Any overlapping open task is closed first (clamped to its own start
    // so no negative/overnight duration is ever fabricated) to preserve
    // the single-active-row invariant enforced by PUT /api/attendance.
    // Wrap-aware: an overnight window never reports a phantom +1350m.
    const overrun = permissionOverrunMins(perm.startTime, perm.endTime, nowTimeStr);
    if (permIdx === -1) {
      const openTaskIdx = wp.findIndex(r => r.type !== 'permission' && r.startTime && !r.endTime);
      if (openTaskIdx >= 0) {
        const taskStart = wp[openTaskIdx].startTime;
        wp[openTaskIdx].endTime = taskStart && taskStart > perm.startTime ? taskStart : perm.startTime;
        wp[openTaskIdx].status = 'completed';
        wp[openTaskIdx].duration = computeWorkRowDuration(wp[openTaskIdx]);
      }
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
        scheduledEndTime: perm.endTime,
        endedLate: true,
        overrunMins: overrun,
      });
      modified = true;
    } else if (!wp[permIdx].endTime) {
      if (wp[permIdx].endedLate !== true || Number(wp[permIdx].overrunMins || 0) !== overrun) {
        wp[permIdx].endedLate = true;
        wp[permIdx].overrunMins = overrun;
        modified = true;
      }
      // Heal legacy two-active states (open task alongside the open
      // permission row): close the stray task with the same clamp so the
      // single-active-row invariant holds and PUT saves stop 400ing.
      for (let i = 0; i < wp.length; i++) {
        const r = wp[i];
        if (i !== permIdx && r.type !== 'permission' && r.startTime && !r.endTime) {
          const taskStart = r.startTime;
          r.endTime = taskStart && taskStart > perm.startTime ? taskStart : perm.startTime;
          r.status = 'completed';
          r.duration = computeWorkRowDuration(r);
          modified = true;
        }
      }
    }
  }
  return modified;
}

export function closePermissionEarly(record, endTimeStr, endedBy = 'manual') {
  const perm = record?.permission;
  if (!perm?.requestId) return { error: 'No approved permission on this date' };
  if (!record.clockIn) return { error: 'Clock in first' };
  if (record.clockOut) return { error: 'Already clocked out' };
  const startMins = toMins(perm.startTime);
  const endMins = toMins(perm.endTime);
  const nowMins = toMins(endTimeStr);
  if (nowMins === null) return { error: 'Invalid end time' };
  if (startMins !== null && nowMins < startMins) return { error: 'Cannot end before permission start' };
  // Ending after the scheduled end is allowed — it is recorded as a late
  // end (time exceeded) instead of rejected. The old 400 here made
  // over-run permissions impossible to close, so they just disappeared.
  // Exception: an APPLIED arrival-cover permission already fulfilled its
  // purpose at clock-in (arrival inside the window, time consumed). Closing
  // it later in the day (e.g. at clock-out) is never an overrun, so it must
  // not flip the day to Late.
  if (perm.endedAt) return { error: 'Permission already ended', already: true };

  // Wrap-aware overrun: only the requested [start, end] window counts as
  // permission time. Anything past perm.endTime is ordinary worked time
  // recorded as overrun (late hours), never permission time.
  // Exception: an APPLIED arrival-cover permission already fulfilled its
  // purpose at clock-in (arrival inside the window, time consumed). Closing
  // it later in the day (e.g. at clock-out) is never an overrun, so it must
  // not flip the day to Late.
  const overrunMins = permissionOverrunMins(perm.startTime, perm.endTime, endTimeStr);
  const late = overrunMins > 0 && perm.applied !== true;
  const permRowEnd = late ? perm.endTime : endTimeStr;

  // An APPLIED arrival-cover row records TAKEN time, not open-to-close time:
  // it completes at the actual clock-in (duration = consumed mins) instead of
  // spanning window-start to whenever it was closed (e.g. 10:00-19:17).
  // Without an actual clock-in on record, fall back to the window end.
  // Otherwise the row keeps HEAD's clamped span (window end when late).
  const appliedCover = perm.applied === true;
  const actualMins = toMins(perm.actualClockIn);
  const takenEndTime = appliedCover
    ? (actualMins !== null && startMins !== null && actualMins >= startMins ? perm.actualClockIn : perm.endTime)
    : null;
  const rowEndTime = takenEndTime || permRowEnd;
  const takenMins = takenEndTime ? computeWorkRowDuration({ startTime: perm.startTime, endTime: takenEndTime }) : null;
  const takenLabel = appliedCover && takenMins !== null
    ? `Permission (${perm.startTime}-${perm.endTime}) · taken ${takenMins}m`
    : null;

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
    const clampedRow = { startTime: perm.startTime, endTime: rowEndTime };
    wp.push({
      type: 'permission',
      taskDetails: takenLabel
        || (late
          ? `Permission (${perm.startTime}-${perm.endTime}) · ended ${endTimeStr} (+${overrunMins}m over)`
          : `Permission (${perm.startTime}-${perm.endTime})`),
      startTime: perm.startTime,
      endTime: rowEndTime,
      permissionRequestId: perm.requestId,
      scheduledEndTime: perm.endTime,
      endedLate: late,
      overrunMins: late ? overrunMins : null,
    });
  } else {
    wp[permIdx].endTime = rowEndTime;
    wp[permIdx].status = 'completed';
    wp[permIdx].duration = computeWorkRowDuration(wp[permIdx]);
    wp[permIdx].endedLate = late;
    wp[permIdx].overrunMins = late ? overrunMins : null;
    if (takenLabel) {
      wp[permIdx].taskDetails = takenLabel;
    } else if (late) {
      wp[permIdx].taskDetails = `Permission (${perm.startTime}-${perm.endTime}) · ended ${endTimeStr} (+${overrunMins}m over)`;
    }
  }
  const activeIdx = wp.findIndex(r => r.startTime && !r.endTime);
  if (activeIdx === -1) {
    wp.push({
      type: 'task',
      taskDetails: '',
      startTime: permRowEnd,
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
  perm.endedLate = late;
  perm.endedLateMins = late ? overrunMins : 0;
  perm.overrunMins = late ? overrunMins : null;
  perm.endedBy = endedBy;
  // Allowance settlement: only the requested (granted) time is ever
  // deducted. On an overrun the full grant is consumed; an on-time or
  // early end keeps whatever the clock-in reconcile already wrote.
  const granted = Number(perm.grantedDuration ?? perm.duration) || 0;
  let touchedRequest = false;
  if (late && granted > 0) {
    perm.usedDuration = granted;
    perm.refundedDuration = 0;
    touchedRequest = true;
  }
  return { ok: true, endedLate: late, overrunMins, usedDuration: perm.usedDuration ?? null, refundedDuration: perm.refundedDuration ?? null, touchedRequest };
}

/**
 * Settle a permission on a record whose session is already closed
 * (`clockOut` set — e.g. force-closed by checkAndApplyAutoLogout, which
 * never settles the permission). `closePermissionEarly` rejects such
 * records, so this path clamps the permission row to the requested end,
 * stamps the fields and opens nothing. Callers persist the mutated record
 * and mirror used/refunded to the SelfServiceRequest when touchedRequest.
 *
 * @param {Object} record - Attendance doc (mutated in place)
 * @param {Object} [opts]
 * @param {string} [opts.endedBy] - defaults to 'sweep_overdue'
 * @param {string|null} [opts.endTimeStr] - explicit end for an open session
 *   (e.g. the shift end when sweeping a past date that was never closed).
 *   Defaults to the requested end (no overrun).
 * @returns {{ ok, endedLate, overrunMins, usedDuration, refundedDuration, touchedRequest }|{ error }}
 */
export function settlePermissionOverrun(record, { endedBy = 'sweep_overdue', endTimeStr = null } = {}) {
  const perm = record?.permission;
  if (!perm?.requestId) return { error: 'No approved permission on this date' };
  if (perm.endedAt) {
    return {
      ok: true, already: true, endedLate: !!perm.endedLate,
      overrunMins: Number(perm.overrunMins ?? perm.endedLateMins) || 0,
      usedDuration: perm.usedDuration ?? null, refundedDuration: perm.refundedDuration ?? null,
      touchedRequest: false,
    };
  }
  if (!record?.clockIn) return { error: 'Clock in first' };
  // Open session -> the full close path (also opens the resumed task row).
  if (!record.clockOut) {
    return closePermissionEarly(record, endTimeStr || perm.endTime, endedBy);
  }
  // Closed session: the employee implicitly ended the permission at
  // clock-out. Clamp the row, stamp the fields, open nothing.
  const overrunMins = permissionOverrunMins(perm.startTime, perm.endTime, record.clockOut);
  const late = overrunMins > 0;
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
  const rowEnd = late ? perm.endTime : record.clockOut;
  if (permIdx === -1) {
    const clamped = { startTime: perm.startTime, endTime: rowEnd };
    wp.push({
      type: 'permission',
      taskDetails: late
        ? `Permission (${perm.startTime}-${perm.endTime}) · ended ${record.clockOut} (+${overrunMins}m over)`
        : `Permission (${perm.startTime}-${perm.endTime})`,
      startTime: perm.startTime,
      endTime: rowEnd,
      status: 'completed',
      remarks: '',
      feedback: '',
      duration: computeWorkRowDuration(clamped),
      permissionRequestId: perm.requestId,
      scheduledEndTime: perm.endTime,
      endedLate: late,
      overrunMins: late ? overrunMins : null,
    });
  } else if (!wp[permIdx].endTime) {
    wp[permIdx].endTime = rowEnd;
    wp[permIdx].status = 'completed';
    wp[permIdx].duration = computeWorkRowDuration(wp[permIdx]);
    wp[permIdx].endedLate = late;
    wp[permIdx].overrunMins = late ? overrunMins : null;
    if (late) {
      wp[permIdx].taskDetails = `Permission (${perm.startTime}-${perm.endTime}) · ended ${record.clockOut} (+${overrunMins}m over)`;
    }
  }
  perm.endedAt = record.clockOut;
  perm.endedEarly = true;
  perm.endedLate = late;
  perm.endedLateMins = late ? overrunMins : 0;
  perm.overrunMins = late ? overrunMins : null;
  perm.endedBy = endedBy;
  const granted = Number(perm.grantedDuration ?? perm.duration) || 0;
  let touchedRequest = false;
  if (late && granted > 0) {
    perm.usedDuration = granted;
    perm.refundedDuration = 0;
    touchedRequest = true;
  }
  return { ok: true, endedLate: late, overrunMins, usedDuration: perm.usedDuration ?? null, refundedDuration: perm.refundedDuration ?? null, touchedRequest };
}

/**
 * Approval-time settlement for a PAST-date permission.
 *
 * A past window is never "late" by itself: it closes on time at its
 * scheduled end, and lateness comes only from the actual arrival (judged
 * separately by resolveDayStatus). Approving a past date with no recorded
 * clock-in is refused outright — there is no worked time to cover.
 *
 * @param {Object} args
 * @param {string} args.permStart - HH:MM window start
 * @param {string} args.permEnd - HH:MM window end
 * @param {string|null} args.actualClockIn - attendance clockIn or null
 * @param {Object|null} args.usage - computePermissionUsage() result or null
 * @param {string} args.permDate - YYYY-MM-DD permission date
 * @param {string} args.todayStr - YYYY-MM-DD approver today
 * @param {*} args.requestId - SelfServiceRequest _id for the row link
 * @returns {{ isPast, hasWork, refuseReason|null, close|null, row|null }}
 */
export function buildPastApprovalClose({ permStart, permEnd, actualClockIn, usage, permDate, todayStr, requestId }) {
  const isPast = !!permDate && !!todayStr && String(permDate) < String(todayStr);
  if (!isPast) return { isPast: false, hasWork: !!actualClockIn, refuseReason: null, close: null, row: null };
  if (!actualClockIn) {
    return {
      isPast: true,
      hasWork: false,
      refuseReason: `Cannot approve a past-date permission with no attendance recorded for ${permDate}`,
      close: null,
      row: null,
    };
  }
  const applied = usage?.applied === true;
  const s = toMins(permStart);
  const a = toMins(actualClockIn);
  const rowEnd = applied && a !== null && s !== null && a >= s ? actualClockIn : permEnd;
  const dur = computeWorkRowDuration({ startTime: permStart, endTime: rowEnd });
  const takenLabel = applied && dur !== null
    ? `Permission (${permStart}-${permEnd}) · taken ${dur}m`
    : null;
  return {
    isPast: true,
    hasWork: true,
    refuseReason: null,
    close: {
      endedAt: permEnd,
      endedEarly: true,
      endedLate: false,
      endedLateMins: 0,
      endedBy: 'approval_overdue',
    },
    row: {
      type: 'permission',
      taskDetails: takenLabel || `Permission (${permStart}-${permEnd})`,
      startTime: permStart,
      endTime: rowEnd,
      status: 'completed',
      remarks: '',
      feedback: '',
      duration: dur,
      permissionRequestId: requestId || null,
      scheduledEndTime: permEnd,
      endedLate: false,
      overrunMins: null,
    },
  };
}
