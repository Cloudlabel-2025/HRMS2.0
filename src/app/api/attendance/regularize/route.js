import { connectDB } from '@/lib/db';
import { AttendanceRegularization, Notification, SelfServiceRequest } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AttendanceRegularizeSchema, ApproveRegularizationSchema, validateRequest } from '@/lib/validation';
import { canApproveManualPermission, canApproveRegularization, getRegularizationApproverIds } from '@/lib/rbac';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getShiftConfig, calculateHoursWorked, diffMins, computeWorkRowDuration, closeExtraActiveRows } from '@/lib/attendance-constants';
import { calculateBreakDeduction } from '@/lib/attendance-breaks';
import { resolveShift, resolveShiftForDate, getShiftEndMinutes } from '@/lib/shift-utils';
import { isEmployer } from '@/lib/permissions';
import { computePermissionUsage, permissionDurationMins, getPermissionAllowanceMins, getPermissionUsageForCycle, getCycleRangeForDate } from '@/lib/permission-allowance';
import { permissionOverrunMins } from '@/lib/permission-window';
import { resolveDayStatus } from '@/lib/attendance-resolver';
import { isFullDayLeaveCovered } from '@/lib/leave-cover';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope'); // 'my' | 'approvals' | 'history'

    // Strict own-department scoping for team roles (no cross-department viewing).
    const strictDeptMemberIds = async (roles) => {
      const members = await User.find({
        department: user.department,
        status: 'active',
        role: { $in: roles },
      }).select('_id').lean();
      return [user._id, ...members.map(m => m._id)];
    };

    let query = {};
    if (scope === 'history') {
      if (user.role === 'super_admin') {
        query = {};
      } else if (user.role === 'admin_full') {
        const excludeUsers = await User.find({ $or: [{ _id: user._id }, { role: 'admin_full' }] }).select('_id');
        const excludeIds = excludeUsers.map(u => u._id);
        query = { userId: { $nin: excludeIds } };
      } else if (user.role === 'team_lead') {
        query = { userId: { $in: await strictDeptMemberIds(['team_admin', 'employee', 'intern', 'sme']) } };
      } else if (user.role === 'team_admin') {
        query = { userId: { $in: await strictDeptMemberIds(['employee', 'intern', 'sme']) } };
      } else {
        query = { userId: user._id };
      }
    } else if (scope === 'approvals') {
      if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
        return fail('Access denied', 403);
      }
      query = { status: 'pending' };
    } else if (scope === 'permission') {
      // Owner-scoped permission lookup for the regularization modal: fetch
      // the approved permission for THIS user on the given date. Never leaks
      // other users' permissions.
      const date = searchParams.get('date');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Valid date YYYY-MM-DD is required', 400);
      const orConds = [];
      if (user.identityId) orConds.push({ identityId: user.identityId });
      if (user.profileId) orConds.push({ profileId: user.profileId });
      if (orConds.length === 0) return ok({ permission: null, source: 'manual' });
      const perm = await SelfServiceRequest.findOne({
        $or: orConds,
        requestType: 'permission',
        status: 'approved',
        'payload.date': date,
      }).select('payload').lean();
      if (!perm) return ok({ permission: null, source: 'manual' });
      return ok({
        permission: {
          startTime: perm.payload?.startTime || null,
          endTime: perm.payload?.endTime || null,
          actualEndTime: perm.payload?.actualEndTime || null,
          duration: perm.payload?.duration || null,
        },
        source: 'fetched',
      });
    } else {
      query = { userId: user._id };
    }

    let requests = await AttendanceRegularization.find(query)
      .populate('userId', 'name avatar department role')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    // Approval queue scoping: no self-approval, no cross-department, and only
    // requests the viewer's role is actually allowed to act on.
    if (scope === 'approvals') {
      const canSeeApproval = (viewer, req) => {
        const requester = req.userId;
        if (!requester?._id) return false;
        if (String(requester._id) === String(viewer._id)) return false;
        if (viewer.role === 'super_admin') return true;
        if (viewer.role === 'admin_full') return requester.role !== 'admin_full';
        if (viewer.role === 'team_lead') {
          return requester.department === viewer.department &&
            ['team_admin', 'employee', 'intern', 'sme'].includes(requester.role);
        }
        if (viewer.role === 'team_admin') {
          return requester.department === viewer.department &&
            ['employee', 'intern', 'sme'].includes(requester.role);
        }
        return false;
      };
      requests = requests.filter(r => canSeeApproval(user, r));
    }

    return ok(requests);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (isEmployer(user.role)) return fail('Employer accounts do not track attendance', 403);
    await connectDB();

    const body = await req.json();
    const ip = req.headers.get('x-forwarded-for') || '';
    const validation = validateRequest(AttendanceRegularizeSchema, body);
    if (!validation.valid) {
      auditLog('Regularization Request Failed', 'Attendance', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { date, requestedIn, requestedOut, requestedBreaks, requestedPermission, reason } = validation.data;

    const countToday = await AttendanceRegularization.countDocuments({ userId: user._id, date: validation.data.date });
    if (countToday >= 4) {
      return fail('Maximum 4 regularization requests allowed per day', 400);
    }

    const existingPending = await AttendanceRegularization.findOne({ userId: user._id, date: validation.data.date, status: 'pending' });
    if (existingPending) {
      return fail('You already have a pending regularization request for this date', 400);
    }

    // A timing-request permission must match an approved permission request
    // for this user + date. The start/end window is authoritative and cannot
    // be typed in manually — only the actual end stays editable.
    // Exception: an explicitly manual window (source 'manual') is accepted
    // without a pre-approved request, but only super_admin / admin_full may
    // approve it later (enforced at PUT).
    let verifiedPermission = null;
    if (requestedPermission?.startTime && requestedPermission?.endTime) {
      if (requestedPermission.source === 'manual') {
        verifiedPermission = {
          startTime: requestedPermission.startTime,
          endTime: requestedPermission.endTime,
          actualEndTime: requestedPermission.actualEndTime || null,
          source: 'manual',
        };
      } else {
        const permOrConds = [];
        if (user.identityId) permOrConds.push({ identityId: user.identityId });
        if (user.profileId) permOrConds.push({ profileId: user.profileId });
        if (permOrConds.length === 0) {
          return fail('No approved permission found for this date. Apply a permission request first.', 400);
        }
        const approved = await SelfServiceRequest.findOne({
          $or: permOrConds,
          requestType: 'permission',
          status: 'approved',
          'payload.date': date,
        }).select('payload').lean();
        if (!approved?.payload?.startTime || !approved?.payload?.endTime) {
          return fail('No approved permission found for this date. Apply a permission request first.', 400);
        }
        if (requestedPermission.startTime !== approved.payload.startTime ||
            requestedPermission.endTime !== approved.payload.endTime) {
          return fail('Permission start and end must match the approved permission for this date.', 400);
        }
        verifiedPermission = {
          startTime: approved.payload.startTime,
          endTime: approved.payload.endTime,
          actualEndTime: requestedPermission.actualEndTime || null,
          source: 'fetched',
        };
      }
    }

    const request = await AttendanceRegularization.create({
      userId: user._id, date,
      requestedIn: requestedIn || null,
      requestedOut: requestedOut || null,
      requestedOutTime: null,
      requestedBreaks: (requestedBreaks || []).map(b => ({
        type: b.type,
        name: b.name || '',
        ruleIdx: b.ruleIdx ?? null,
        idx: b.idx ?? null,
        start: b.start || '',
        end: b.end || null,
        notYet: b.notYet || false,
      })),
      requestedPermission: verifiedPermission,
      reason, status: 'pending',
    });

    // Send notification only to reviewers allowed to act on this requester's role
    const approverIds = await getRegularizationApproverIds(user);
    const notificationPromises = approverIds.map(approverId =>
      Notification.create({
        userId: approverId,
        title: 'Attendance Regularization Requested',
        message: `${user.name} requested attendance regularization for ${date}. Reason: ${reason}`,
        type: 'attendance',
        refId: request._id,
      })
    );
    await Promise.all(notificationPromises);

    // Audit log
    await auditLog(
      'Attendance Regularization Requested',
      'Attendance',
      user._id,
      `Requested regularization for ${date}`,
      'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      user._id
    );

    return ok(request, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
      return fail('Access denied', 403);
    }
    await connectDB();

    const body = await req.json();
    const { id, ...rest } = body;
    if (!id) return fail('id is required', 400);

    // Validate request
    const validation = validateRequest(ApproveRegularizationSchema, rest);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { action } = validation.data;

    const toMins = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const shiftTime = (t, delta) => {
      const total = (((toMins(t) + delta) % 1440) + 1440) % 1440;
      return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    };

    const reg = await AttendanceRegularization.findById(id);
    if (!reg) return fail('Request not found', 404);

    // Role-based scope verification (regularization approval matrix)
    const requester = await User.findById(reg.userId).select('role department').lean();
    if (!requester || !(await canApproveRegularization(user, requester))) {
      return fail('Access denied', 403);
    }

    const empUser = await User.findById(reg.userId).select('shift shiftId identityId profileId').lean();

    // ── Permission pre-claim gate ──────────────────────────────────────────
    // Validation, monthly-allowance enforcement and the SelfServiceRequest
    // upsert ALL happen before the atomic claim (STEP 1) so a rejection here
    // can never leave the request marked approved with attendance untouched.
    const regPerm = reg.requestedPermission || null;
    let regPermSelfReq = null;
    let regPermDuration = 0;
    if (action === 'approved' && regPerm && regPerm.startTime && regPerm.endTime) {
      regPermDuration = permissionDurationMins(regPerm.startTime, regPerm.endTime);
      if (regPermDuration <= 0 || regPermDuration > 120) {
        return fail('Permission duration must be between 1 and 120 minutes', 400);
      }
      if (!regPerm.actualEndTime) {
        return fail('Permission actual end time is required', 400);
      }
      // Manual (non-pre-approved) windows may only be approved by
      // super_admin / admin_full — team roles stay limited to fetched ones.
      const isManualPerm = regPerm.source === 'manual';
      if (isManualPerm && !canApproveManualPermission(user)) {
        return fail('Manual permission entries need Super Admin or Admin approval', 403);
      }
      // Leave wins: a manual or fetched permission can never share a day
      // with an approved full-day leave.
      try {
        const { Leave: LeaveModel } = await import('@/lib/models/index');
        const leaveCover = await LeaveModel.findOne({
          userId: reg.userId,
          status: 'approved',
          halfDay: { $ne: true },
          from: { $lte: reg.date },
          to: { $gte: reg.date },
        }).lean();
        if (leaveCover) {
          return fail(`Cannot approve: approved full-day ${leaveCover.type || leaveCover.typeCode || 'leave'} (${leaveCover.from} to ${leaveCover.to}) already covers ${reg.date}. A day can hold either a leave or a permission, not both.`, 409);
        }
      } catch (e) {
        return fail('Permission leave-cover check failed: ' + (e?.message || e), 400);
      }
      if (!empUser.profileId || !empUser.identityId) {
        return fail('Employee identity/profile not found; cannot record permission', 400);
      }

      regPermSelfReq = await SelfServiceRequest.findOne({
        $or: [{ identityId: empUser.identityId }, { profileId: empUser.profileId }],
        requestType: 'permission',
        'payload.date': reg.date,
      }).sort({ createdAt: -1 }).lean();

      // Monthly allowance enforcement — mirrors self-service approval.
      // An already-counted (approved/pending) request adds 0; a new or
      // previously-rejected one adds its full duration.
      try {
        const cfg = await getGlobalConfig();
        const { fromDate, toDate } = await getCycleRangeForDate(reg.date, cfg);
        const usage = await getPermissionUsageForCycle(empUser.profileId, fromDate, toDate);
        const allowance = getPermissionAllowanceMins(cfg);
        const alreadyCounted = !!regPermSelfReq && ['approved', 'pending'].includes(regPermSelfReq.status);
        const projected = usage.totalUsed + (alreadyCounted ? 0 : regPermDuration);
        if (projected > allowance) {
          return fail(`Permission allowance exceeded for cycle ${fromDate} to ${toDate}: ${projected} of ${allowance} minutes`, 400);
        }
      } catch (e) {
        return fail('Permission allowance check failed: ' + (e?.message || e), 400);
      }

      // Upsert the SelfServiceRequest so allowance/balance/calendar/history
      // stay single-sourced (getPermissionUsageForCycle reads it).
      try {
        const payload = {
          date: reg.date,
          startTime: regPerm.startTime,
          endTime: regPerm.endTime,
          actualEndTime: regPerm.actualEndTime,
          duration: regPermDuration,
        };
        if (regPermSelfReq) {
          regPermSelfReq = await SelfServiceRequest.findByIdAndUpdate(
            regPermSelfReq._id,
            {
              $set: {
                payload: { ...(regPermSelfReq.payload || {}), ...payload },
                status: 'approved',
                reviewerUserId: user._id,
                reviewedAt: new Date(),
                reviewNote: isManualPerm ? 'Approved via attendance regularization (manual window)' : 'Approved via attendance regularization',
              },
            },
            { new: true }
          ).lean();
        } else {
          regPermSelfReq = (await SelfServiceRequest.create({
            identityId: empUser.identityId,
            profileId: empUser.profileId,
            requestType: 'permission',
            payload,
            reason: `Regularization-approved permission for ${reg.date}`,
            status: 'approved',
            reviewerUserId: user._id,
            reviewedAt: new Date(),
            reviewNote: isManualPerm ? 'Created via attendance regularization approval (manual window)' : 'Created via attendance regularization approval',
            requestSource: 'regularization',
          })).toObject();
        }
      } catch (e) {
        return fail('Failed to record permission request: ' + (e?.message || e), 400);
      }
    }

    // STEP 1: Atomically claim the regulation FIRST
    const updated = await AttendanceRegularization.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status: action, reviewedBy: user._id, reviewedAt: new Date() } },
      { new: true }
    );
    if (!updated) {
      const existing = await AttendanceRegularization.findById(id);
      if (!existing) return fail('Request not found', 404);
      auditLog(`Regularization Review Attempted`, 'Attendance', user._id, `Attempted to ${action} already-processed request (status: ${existing.status})`, 'low', req.headers.get('x-forwarded-for') || '', null, reg.userId);
      return fail('This request has already been processed', 400);
    }

    // STEP 2: Now safely update the attendance record
    let regShiftDoc = null;
    let finalClockOut = null;
    if (action === 'approved') {
      let attendance = await Attendance.findOne({ userId: reg.userId, date: reg.date });
      if (!attendance) {
        attendance = new Attendance({
          userId: reg.userId,
          date: reg.date,
          status: 'present',
        });
      }

      const oldClockIn = attendance.clockIn;
      if (reg.requestedIn) attendance.clockIn = reg.requestedIn;
      if (reg.requestedIn && oldClockIn && reg.requestedIn !== oldClockIn) {
        const delta = toMins(reg.requestedIn) - toMins(oldClockIn);
        // The approved permission window is authoritative and must never be
        // shifted — only work/break rows move with the corrected clock-in.
        attendance.workProgress = (attendance.workProgress || []).map(w => {
          if (w.type === 'permission') return w;
          return {
            ...w,
            startTime: w.startTime ? shiftTime(w.startTime, delta) : w.startTime,
            endTime:   w.endTime   ? shiftTime(w.endTime, delta)   : w.endTime,
          };
        });
        attendance.breaks = (attendance.breaks || []).map(b => ({
          ...b,
          start: b.start ? shiftTime(b.start, delta) : b.start,
          end:   b.end   ? shiftTime(b.end, delta)   : b.end,
        }));
      }
      if (reg.requestedOut) attendance.clockOut = reg.requestedOut;

      // Apply requested breaks from regularization
      const attendanceBreaks = attendance.breaks ? [...attendance.breaks] : [];
      const attendanceWorkProgress = attendance.workProgress ? [...attendance.workProgress] : [];

      if (reg.requestedBreaks && reg.requestedBreaks.length > 0) {
        const ruleKey = (b) => (b.ruleIdx != null ? 'r' + b.ruleIdx : (b.name ? b.type + '|' + b.name : b.type || ''));

        // Indexes of attendance break entries per rule key (ordered)
        const breaksByRule = {};
        attendanceBreaks.forEach((b, i) => {
          const k = ruleKey(b);
          (breaksByRule[k] = breaksByRule[k] || []).push(i);
        });

        // Find the instIdx-th attendance break for the requested break's rule,
        // falling back to type-only matching for legacy (pre rule-identity) data.
        const findExistingIdx = (rb, instIdx) => {
          const key = ruleKey(rb);
          const byKey = breaksByRule[key]?.[instIdx];
          if (byKey !== undefined) return byKey;
          const byType = breaksByRule[rb.type]?.[instIdx];
          if (byType !== undefined) return byType;
          return undefined;
        };

        // Find the instIdx-th workProgress row belonging to the requested break's rule
        const findWp = (rb, instIdx) => {
          let seen = -1;
          let match = -1;
          attendanceWorkProgress.forEach((w, i) => {
            if (w.type === rb.type && (rb.name ? w.taskDetails === rb.name : true)) {
              seen++;
              if (seen === instIdx) match = i;
            }
          });
          if (match !== -1) return match;
          seen = -1; match = -1;
          attendanceWorkProgress.forEach((w, i) => {
            if (w.type === rb.type) { seen++; if (seen === instIdx) match = i; }
          });
          return match;
        };

        for (const rb of reg.requestedBreaks) {
          const instIdx = rb.idx ?? 0;
          if (rb.notYet) {
            const removeIdx = findExistingIdx(rb, instIdx);
            if (removeIdx !== undefined) {
              attendanceBreaks.splice(removeIdx, 1);
              for (const k of Object.keys(breaksByRule)) {
                breaksByRule[k] = breaksByRule[k].map(i => i > removeIdx ? i - 1 : i).filter(i => i !== removeIdx);
              }
            }
            const wpRemoveIdx = findWp(rb, instIdx);
            if (wpRemoveIdx !== -1) attendanceWorkProgress.splice(wpRemoveIdx, 1);
          } else if (rb.start || rb.end) {
            const existingIdx = findExistingIdx(rb, instIdx);
            if (existingIdx !== undefined) {
              if (rb.start) attendanceBreaks[existingIdx].start = rb.start;
              if (rb.end) attendanceBreaks[existingIdx].end = rb.end;
            } else {
              attendanceBreaks.push({ type: rb.type, name: rb.name || '', ruleIdx: rb.ruleIdx ?? null, start: rb.start || '', end: rb.end || null });
            }

            const wpIdx = findWp(rb, instIdx);
            if (wpIdx !== -1) {
              if (rb.start) attendanceWorkProgress[wpIdx].startTime = rb.start;
              if (rb.end) {
                attendanceWorkProgress[wpIdx].endTime = rb.end;
                attendanceWorkProgress[wpIdx].status = 'completed';
                attendanceWorkProgress[wpIdx].duration = computeWorkRowDuration(attendanceWorkProgress[wpIdx]);
              }
            } else {
              // Close any other open row first so regularization can never
              // create a second active row (which wedges every later save
              // with "Multiple active work rows").
              const healed = closeExtraActiveRows(attendanceWorkProgress, rb.start || rb.end || null);
              attendanceWorkProgress.length = 0;
              attendanceWorkProgress.push(...healed.rows);
              attendanceWorkProgress.push({
                type: rb.type, taskDetails: rb.name || (rb.type === 'lunch' ? 'Lunch break' : 'Break'),
                startTime: rb.start || '', endTime: rb.end || null,
                status: rb.end ? 'completed' : 'work_in_progress',
                remarks: '', feedback: '',
                duration: rb.end ? computeWorkRowDuration({ startTime: rb.start || '', endTime: rb.end }) : null,
              });
            }
          }
        }
      }

      attendance.breaks = attendanceBreaks;
      attendance.workProgress = attendanceWorkProgress;

      // Per-user effective-dated assignments are authoritative. Use the frozen
      // snapshot only when no assignment history covers this date.
      try {
        regShiftDoc = await resolveShiftForDate(empUser, reg.date, { fallbackToCurrent: false });
      } catch { regShiftDoc = null; }
      if (!regShiftDoc && attendance.shiftStartTime) {
        regShiftDoc = {
          _id: attendance.shiftId || null,
          name: attendance.shiftName || empUser?.shift || '',
          startTime: attendance.shiftStartTime,
          endTime: attendance.shiftEndTime || '',
          lateThreshold: attendance.shiftLateThreshold ?? null,
        };
      } else if (!regShiftDoc) {
        try {
          regShiftDoc = (await resolveShiftForDate(empUser, reg.date)) || await resolveShift(empUser);
        } catch {
          regShiftDoc = await resolveShift(empUser);
        }
      }
      const config = await getGlobalConfig();
      const regCfg = getShiftConfig(regShiftDoc, config);

      // ── Apply the approved permission to the day's attendance ────────────
      // Usage is recomputed the same way clock-in does it, shortHours stays
      // suppressed downstream, and the work-progress permission row is
      // materialised completed (actualEndTime is required) so it can never
      // become a second active row. Any pre-existing wedge is healed first.
      if (regPerm && regPerm.startTime && regPerm.endTime) {
        try {
          const actualEnd = regPerm.actualEndTime;
          // Wrap-aware overrun: measured against the permission start so an
          // overnight window (23:00-01:00) returning at 23:30 is not read as
          // "+1350m over". Shared with the attendance page badges.
          const overrunMins = permissionOverrunMins(regPerm.startTime, regPerm.endTime, actualEnd);
          const endedLate = overrunMins > 0;

          const permShiftStart = regShiftDoc?.startTime || null;
          const [psH, psM] = permShiftStart ? permShiftStart.split(':').map(Number) : [NaN, NaN];
          const shiftStartMins = Number.isNaN(psH) ? null : psH * 60 + psM;

          const usage = computePermissionUsage({
            actualClockIn: attendance.clockIn || reg.requestedIn || null,
            permStart: regPerm.startTime,
            permEnd: regPerm.endTime,
            grantedDuration: regPermDuration,
            shiftStartMins,
            lateThreshold: regCfg?.lateThreshold ?? 15,
          });
          const effectiveClockIn = usage.applied && shiftStartMins !== null
            ? `${String(Math.floor(shiftStartMins / 60)).padStart(2, '0')}:${String(shiftStartMins % 60).padStart(2, '0')}`
            : attendance.clockIn || null;
          const prevPerm = attendance.permission || {};

          attendance.permission = {
            requestId: regPermSelfReq?._id || prevPerm.requestId || null,
            startTime: regPerm.startTime,
            endTime: regPerm.endTime,
            duration: regPermDuration,
            grantedDuration: regPermDuration,
            usedDuration: usage.used,
            refundedDuration: usage.refunded,
            actualClockIn: attendance.clockIn || null,
            effectiveClockIn,
            applied: usage.applied,
            isMidDay: usage.isMidDay,
            status: 'approved',
            approvedBy: user._id,
            approvedAt: prevPerm.approvedAt || new Date(),
            endedAt: actualEnd,
            endedEarly: true,
            endedLate: endedLate || !!prevPerm.endedLate,
            endedLateMins: overrunMins > 0 ? overrunMins : (prevPerm.endedLateMins ?? null),
            endedBy: 'manual',
          };

          const rows = attendance.workProgress || [];
          const permissionRowIdx = rows.findIndex(w =>
            w.type === 'permission' && String(w.permissionRequestId || '') === String(attendance.permission.requestId || '')
          );
          if (permissionRowIdx >= 0) {
            // Re-regularization can reuse the same approved request. Refresh
            // its existing work-log row so the actual end and overrun stay
            // aligned with the newly approved regularization values.
            attendance.workProgress = rows.map((row, idx) => idx === permissionRowIdx ? {
              ...row,
              taskDetails: endedLate
                ? `Permission (${regPerm.startTime}-${regPerm.endTime}) · ended ${actualEnd} (+${overrunMins}m over)`
                : `Permission (${regPerm.startTime}-${regPerm.endTime})`,
              startTime: regPerm.startTime,
              endTime: actualEnd,
              status: 'completed',
              duration: computeWorkRowDuration({ startTime: regPerm.startTime, endTime: actualEnd }),
              scheduledEndTime: regPerm.endTime,
              endedLate,
              overrunMins: overrunMins || null,
            } : row);
          } else {
            // Single-active-row invariant: heal first, then push a COMPLETED
            // row (actualEndTime is required, so it can never stay open).
            const healed = closeExtraActiveRows(rows, actualEnd);
            attendance.workProgress = healed.rows;
            attendance.workProgress.push({
              type: 'permission',
              taskDetails: `Permission (${regPerm.startTime}-${regPerm.endTime})`,
              startTime: regPerm.startTime,
              endTime: actualEnd,
              status: 'completed',
              remarks: '',
              feedback: '',
              duration: computeWorkRowDuration({ startTime: regPerm.startTime, endTime: actualEnd }),
              permissionRequestId: attendance.permission.requestId,
              scheduledEndTime: regPerm.endTime,
              endedLate,
              overrunMins: overrunMins || null,
            });
          }

          // Reconcile the SelfServiceRequest usage so unused minutes return
          // to the monthly allowance (approved counts used, not granted).
          if (regPermSelfReq?._id) {
            await SelfServiceRequest.findByIdAndUpdate(regPermSelfReq._id, {
              $set: {
                'payload.usedDuration': usage.used,
                'payload.refundedMins': usage.refunded,
                'payload.applied': usage.applied,
                'payload.actualClockIn': attendance.clockIn || null,
                'payload.isMidDay': usage.isMidDay,
                'payload.actualEndTime': actualEnd,
              },
            });
          }
        } catch (e) {
          console.error('Regularization permission apply failed:', e?.message || e);
        }
      }

      if (attendance.clockIn && attendance.clockOut) {
        let base = diffMins(attendance.clockIn, attendance.clockOut);
        base = Math.max(0, base);
        attendance.baseHoursWorked = base;

        attendance.breakDeduction = calculateBreakDeduction(attendanceBreaks, regCfg.breaks);
        // Short hours = clock-out before the scheduled shift end OR break
        // excess. No strict 8-hour rule: a 3-hour shift that ends on time is a
        // full day.
        const regShiftEndMins = regShiftDoc ? getShiftEndMinutes(regShiftDoc, regCfg) : null;
        const { hoursWorked, payableHours, shortfallMins, breakExcessMins, shortHours: rawShortHours } =
          calculateHoursWorked(base, attendance.breakDeduction, regCfg, {
            clockOut: attendance.clockOut,
            shiftEndMins: regShiftEndMins,
            breakExcessMins: attendance.breakDeduction,
          });
        attendance.hoursWorked = hoursWorked;
        attendance.payableHours = payableHours;
        const hasRegPermission = !!(attendance.permission?.requestId || attendance.permission?.startTime);
        attendance.shortHours = hasRegPermission ? false : rawShortHours;
        attendance.shortfallMins = hasRegPermission ? 0 : shortfallMins;
        attendance.breakExcessMins = hasRegPermission ? 0 : breakExcessMins;
        // Leave wins: approving a timing correction for an approved
        // full-day leave date must not flip the day to present/late.
        // Clock corrections and hours still apply; only the status is kept.
        const regLeaveCovered = await isFullDayLeaveCovered(reg.userId, reg.date).catch(() => false);
        attendance.status = regLeaveCovered ? 'leave' : 'present';
        if (regLeaveCovered) attendance.lateFlag = false;

        // Recalculate late via resolveDayStatus so the permission window is
        // consulted — judging only against shift start would wrongly mark an
        // employee with an approved covering permission as Late (the read-path
        // resolves the same day as Present).
        if (!regLeaveCovered && (empUser?.shift || regShiftDoc?.startTime)) {
          const lateShiftDoc = regShiftDoc || await resolveShift(empUser);
          if (lateShiftDoc?.startTime && attendance.clockIn) {
            const [sH, sM] = lateShiftDoc.startTime.split(':').map(Number);
            const shiftStartMins = sH * 60 + sM;
            const [cH, cM] = attendance.clockIn.split(':').map(Number);
            let minutesLate = cH * 60 + cM - shiftStartMins;
            if (minutesLate < -720) minutesLate += 1440;
            if (minutesLate > 720) minutesLate -= 1440;

            const resolved = resolveDayStatus({
              clockIn: attendance.clockIn,
              permission: attendance.permission?.startTime && attendance.permission?.endTime
                ? { startTime: attendance.permission.startTime, endTime: attendance.permission.endTime }
                : null,
              approvedHalfDayLeave: !!attendance.approvedHalfDayLeave,
              nonWorkingDayType: attendance.nonWorkingDayType || 'none',
              leaveOverrideStatus: attendance.leaveOverride?.status || 'none',
              minutesSinceShiftStart: minutesLate,
              shiftStartMins,
              cfg: regCfg,
            });
            attendance.lateFlag = !!resolved.lateFlag
              || (!!attendance.permission?.endedLate && attendance.permission?.applied !== true);
            attendance.halfDayThresholdExceeded = !!attendance.lateFlag && minutesLate > (regCfg?.halfDayThreshold || 180);
            if (!attendance.approvedHalfDayLeave && attendance.lateFlag) attendance.status = 'late';
            else if (!attendance.lateFlag && attendance.status === 'late') attendance.status = 'present';
          }
        }
        // A permission overrun is Late even when the regularized clock-in was
        // covered by the approved window. It remains separate from shortHours.
        // Never on an approved full-day leave day — leave wins.
        if (!regLeaveCovered && attendance.permission?.endedLate && attendance.permission?.applied !== true && !attendance.approvedHalfDayLeave) {
          attendance.lateFlag = true;
          attendance.status = 'late';
        }
      }

      // Freeze the per-day shift snapshot so later shift changes can never
      // re-judge this regularization.
      if (regShiftDoc?.startTime && !attendance.shiftStartTime) {
        attendance.shiftId = regShiftDoc._id || attendance.shiftId || null;
        attendance.shiftName = regShiftDoc.name || empUser?.shift || null;
        attendance.shiftStartTime = regShiftDoc.startTime || null;
        attendance.shiftEndTime = regShiftDoc.endTime || null;
        attendance.shiftLateThreshold = regCfg?.lateThreshold ?? null;
      }

      finalClockOut = attendance.clockOut || null;
      await attendance.save();
    }

    // Send notification to the employee
    await Notification.create({
      userId: reg.userId,
      title: `Attendance Regularization ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      message: `Your attendance regularization request for ${reg.date} has been ${action} by ${user.name}.`,
      type: 'attendance',
      refId: reg._id,
    });

    // Audit log
    await auditLog(
      `Attendance Regularization ${action}`,
      'Attendance',
      user._id,
      `${action} regularization request for ${reg.userId} on ${reg.date} (shift: ${regShiftDoc?.name || 'unknown'}, clockOut: ${finalClockOut || 'none'})`,
      action === 'approved' ? 'medium' : 'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      reg.userId
    );

    return ok(updated);
  } catch (e) {
    return fail(e.message, 500);
  }
}
