import dbConnect from '@/lib/db';
import { requireAuth, auditLog, } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { notify } from '@/lib/notify';
import { CORE_HR_WRITE_ROLES } from '@/lib/core/constants';
import { SelfServiceRequest, EmpProfile, UsrIdentity, Employee } from '@/lib/models/index';
import User from '@/lib/models/User';
import { recordLifecycleHistory } from '@/lib/core/history';
import { ReviewSelfServiceRequestSchema, validateRequest } from '@/lib/validation';
import { startSeparation } from '@/lib/core/separation';

function syncLegacy(identity, profile, userStatus) {
  return Promise.all([
    identity.authUserId ? User.findByIdAndUpdate(identity.authUserId, {
      identityId: identity._id,
      profileId: profile._id,
      name: identity.displayName || identity.legalName,
      email: identity.primaryEmail,
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      status: userStatus,
      ...(identity.personalPhone ? { phone: identity.personalPhone } : {}),
    }) : null,
    Employee.findOneAndUpdate({ userId: identity.authUserId }, {
      name: identity.displayName || identity.legalName,
      email: identity.primaryEmail,
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      status: userStatus,
      ...(identity.personalPhone ? { phone: identity.personalPhone } : {}),
    }),
  ]);
}

async function applyApprovedRequest(request, reviewer) {
  const profile = await EmpProfile.findById(request.profileId);
  if (!profile) throw new Error('Employment profile not found');
  const identity = await UsrIdentity.findById(request.identityId);
  if (!identity) throw new Error('Identity not found');

  if (request.requestType === 'profile_update') {
    identity.preferredName = request.payload.preferredName || identity.preferredName;
    identity.personalPhone = request.payload.personalPhone || identity.personalPhone;
    identity.secondaryPhone = request.payload.secondaryPhone || identity.secondaryPhone;
    await identity.save();
    await syncLegacy(identity, profile, profile.employmentStatus === 'active' ? 'active' : 'inactive');
    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service profile update',
      fromState: identity.recordStatus || '',
      toState: identity.recordStatus || '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-profile-update' },
    });
  }

  if (request.requestType === 'address_update') {
    identity.addressHistory = request.payload.addressHistory || [];
    await identity.save();
    await recordLifecycleHistory({
      entityType: 'address',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service address update',
      fromState: '',
      toState: '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-address-update' },
    });
  }

  if (request.requestType === 'emergency_contact_update') {
    identity.emergencyContacts = request.payload.emergencyContacts || [];
    await identity.save();
    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service emergency contact update',
      fromState: '',
      toState: '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-emergency-contact-update' },
    });
  }

  if (request.requestType === 'resignation') {
    await startSeparation({
      profile,
      identity,
      actor: reviewer,
      separationType: 'resignation',
      reason: request.reason,
      noticePeriodDays: request.payload.noticePeriodDays || 0,
      lastWorkingDate: request.payload.lastWorkingDate,
      effectiveDate: new Date(),
      source: 'self-service-resignation',
      metadata: { requestId: request._id.toString() },
    });
  }

  if (request.requestType === 'permission') {
    // Past-date approval requires recorded attendance: there is no worked
    // time to cover otherwise. Fatal (409) — the request stays pending.
    try {
      const { default: AttendanceCheck } = await import('@/lib/models/Attendance');
      const { getTzTime: getTzCheck } = await import('@/lib/timezone');
      const pDate = request.payload?.date;
      if (pDate && identity?.authUserId) {
        const nowT = await getTzCheck().catch(() => new Date());
        const tStr = nowT.getFullYear() + '-' + String(nowT.getMonth() + 1).padStart(2, '0') + '-' + String(nowT.getDate()).padStart(2, '0');
        if (String(pDate) < tStr) {
          const attRow = await AttendanceCheck.findOne({ userId: identity.authUserId, date: pDate }).select('clockIn').lean().catch(() => null);
          if (!attRow?.clockIn) {
            const err = new Error(`Cannot approve a past-date permission with no attendance recorded for ${pDate}`);
            err.statusCode = 409;
            throw err;
          }
        }
      }
    } catch (e) {
      if (e?.statusCode === 409) throw e;
      console.error('Past-date attendance check failed (non-fatal):', e?.message || e);
    }
    // A full-day leave approved after this request was filed wins: refuse
    // approval (creation-time already blocks the reverse order). Half-day
    // leaves are intentionally ignored here — they are creation-guarded only.
    try {
      const { Leave: LeaveModel } = await import('@/lib/models/index');
      const permDate = request.payload?.date;
      if (permDate && identity?.authUserId) {
        const leaveCover = await LeaveModel.findOne({
          userId: identity.authUserId,
          status: 'approved',
          halfDay: { $ne: true },
          from: { $lte: permDate },
          to: { $gte: permDate },
        }).lean();
        if (leaveCover) {
          throw new Error(`Cannot approve: approved full-day ${leaveCover.type || leaveCover.typeCode || 'leave'} (${leaveCover.from} to ${leaveCover.to}) already covers ${permDate}. A day can hold either a leave or a permission, not both.`);
        }
      }
    } catch (e) {
      if (String(e?.message || '').includes('Cannot approve')) throw e;
      console.error('Permission leave-cover check failed:', e?.message || e);
    }
    // Re-check monthly allowance at approval time (creation already checked).
    try {
      const { getGlobalConfig, getPayrollDay, getCycleMonth, getCycleRange } = await import('@/lib/payroll-cycle');
      const { getPermissionAllowanceMins, getPermissionUsageForCycle } = await import('@/lib/permission-allowance');
      const cfg = await getGlobalConfig();
      const permDate = request.payload?.date;
      const granted = Number(request.payload?.duration || 0) || 0;
      if (permDate && granted > 0) {
        const startDay = getPayrollDay(cfg.payrollStartDay, 26);
        const endDay = getPayrollDay(cfg.payrollEndDay, 25);
        const { year, month } = getCycleMonth(permDate, startDay);
        const { fromDate, toDate } = getCycleRange(startDay, endDay, year, month);
        const usage = await getPermissionUsageForCycle(request.profileId, fromDate, toDate);
        const allowance = getPermissionAllowanceMins(cfg);
        // usage includes this pending request; approve only if it still fits.
        if (usage.totalUsed > allowance) {
          throw new Error(`Permission allowance exceeded for cycle ${fromDate} to ${toDate}.`);
        }
      }
    } catch (e) {
      if (String(e?.message || '').includes('allowance exceeded')) throw e;
      console.error('Permission allowance re-check failed:', e?.message || e);
    }

    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service permission request',
      fromState: '',
      toState: '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-permission' },
    });

    // Mirror the approved permission onto the day's attendance so the
    // 8-hours day view shows it even before the employee clocks in.
    // clockIn stays null until the employee actually clocks in; the real
    // wall time is always preserved (never overwritten with shift start).
    // The mirrored row never claims presence: status defaults to 'absent'
    // and the sync/display layers (Not-Arrived badge, absent-with-permission
    // context) own the rest. A permission for a FUTURE date with no row yet
    // creates nothing — the request itself is the source of truth until the
    // day arrives (clock-in or the calendar sync creates the row).
    try {
      const { default: Attendance } = await import('@/lib/models/Attendance');
      const { getTzTime } = await import('@/lib/timezone');
      const { buildPastApprovalClose } = await import('@/lib/permission-work');
      const permDate = request.payload?.date;
      if (permDate && identity.authUserId) {
        const nowTz = await getTzTime();
        const todayStr = nowTz.getFullYear() + '-' + String(nowTz.getMonth() + 1).padStart(2, '0') + '-' + String(nowTz.getDate()).padStart(2, '0');
        const startTime = request.payload?.startTime || null;
        const endTime = request.payload?.endTime || null;
        const granted = Number(request.payload?.duration || 0) || null;
        const existingPermRec = await Attendance.findOne({ userId: identity.authUserId, date: permDate }).select('permission clockIn workProgress').lean().catch(() => null);
        if (!existingPermRec && permDate > todayStr) {
          // Nothing to mirror onto yet — skip row creation.
        } else {
          const keepEnded = existingPermRec?.permission?.endedAt ? { endedAt: existingPermRec.permission.endedAt, endedEarly: !!existingPermRec.permission.endedEarly } : {};
          // Arrival already covered at clock-in (applied) must survive a late
          // approval: re-approving must not wipe the clock-in reconciliation
          // nor close-as-late a permission that already did its job.
          const keepApplied = existingPermRec?.permission?.applied === true
            ? {
                applied: true,
                usedDuration: existingPermRec.permission.usedDuration ?? null,
                refundedDuration: existingPermRec.permission.refundedDuration ?? null,
                actualClockIn: existingPermRec.permission.actualClockIn ?? null,
                effectiveClockIn: existingPermRec.permission.effectiveClockIn ?? null,
              }
            : {};
          // Leave wins: an overdue permission approval must never flip an
          // approved full-day leave day to late. (Status is never touched
          // here at all — leave-wins resolution owns it downstream.)
          // Past worked days additionally settle usage (used/refunded/
          // applied from the real clock-in), close on time at the scheduled
          // end (a past window is never late by itself), and gain a completed
          // work-progress row so the sheet documents taken time. Past dates
          // with no clock-in cannot reach here — approval is refused above.
          let usageFields = {
            usedDuration: null,
            refundedDuration: null,
            actualClockIn: null,
            effectiveClockIn: null,
            applied: false,
            isMidDay: false,
          };
          let pastClose = {};
          let pastNote = '';
          let settledWp = null;
          if (String(permDate) < todayStr && existingPermRec?.clockIn) {
            try {
              const { computePermissionUsage } = await import('@/lib/permission-allowance');
              const { getGlobalConfig } = await import('@/lib/payroll-cycle');
              const { resolveShiftForDate } = await import('@/lib/shift-utils');
              const cfg = await getGlobalConfig().catch(() => ({}));
              const authUser = await User.findById(identity.authUserId).select('shift shiftId').lean().catch(() => null);
              const shiftDoc = authUser
                ? await resolveShiftForDate({ _id: identity.authUserId, shift: authUser.shift, shiftId: authUser.shiftId }, permDate).catch(() => null)
                : null;
              const toM = (t) => {
                if (!t || typeof t !== 'string') return null;
                const [h, m] = t.split(':').map(Number);
                if (Number.isNaN(h) || Number.isNaN(m)) return null;
                return h * 60 + m;
              };
              const shiftStartMins = toM(shiftDoc?.startTime);
              const lateThreshold = Number(shiftDoc?.lateThreshold ?? cfg?.lateThreshold ?? 15);
              let usage = null;
              let effectiveClockIn = null;
              if (shiftStartMins !== null) {
                usage = computePermissionUsage({
                  actualClockIn: existingPermRec.clockIn,
                  permStart: startTime,
                  permEnd: endTime,
                  grantedDuration: granted || 0,
                  shiftStartMins,
                  lateThreshold,
                });
                if (usage.applied) {
                  effectiveClockIn = `${String(Math.floor(shiftStartMins / 60)).padStart(2, '0')}:${String(shiftStartMins % 60).padStart(2, '0')}`;
                }
              }
              const settled = buildPastApprovalClose({
                permStart: startTime,
                permEnd: endTime,
                actualClockIn: existingPermRec.clockIn,
                usage,
                permDate,
                todayStr,
                requestId: request._id,
              });
              if (settled.isPast && settled.hasWork) {
                usageFields = {
                  usedDuration: usage ? usage.used : null,
                  refundedDuration: usage ? usage.refunded : null,
                  actualClockIn: existingPermRec.clockIn,
                  effectiveClockIn,
                  applied: usage ? usage.applied : false,
                  isMidDay: usage ? usage.isMidDay : false,
                };
                pastNote = ' — backdated approval, closed on time at scheduled end';
                if (settled.row && !keepEnded.endedAt) {
                  pastClose = settled.close;
                  const wp = Array.isArray(existingPermRec.workProgress) ? [...existingPermRec.workProgress] : [];
                  const reqStr = String(request._id);
                  let idx = wp.findIndex((w) => w?.type === 'permission' && String(w.permissionRequestId || '') === reqStr);
                  if (idx === -1) idx = wp.findIndex((w) => w?.type === 'permission' && !w.endTime && !w.permissionRequestId);
                  if (idx === -1) {
                    wp.push({ ...settled.row, permissionRequestId: request._id });
                  } else if (!wp[idx].endTime) {
                    wp[idx] = { ...wp[idx], ...settled.row, permissionRequestId: wp[idx].permissionRequestId || request._id };
                  } else {
                    wp[idx] = {
                      ...wp[idx],
                      endTime: settled.row.endTime,
                      duration: settled.row.duration,
                      taskDetails: settled.row.taskDetails,
                      endedLate: false,
                      overrunMins: null,
                    };
                  }
                  settledWp = wp;
                }
              }
            } catch (se) { console.error('Past-date settlement failed (non-fatal):', se?.message || se); }
          }
          await Attendance.findOneAndUpdate(
            { userId: identity.authUserId, date: permDate },
            {
              $set: {
                permission: {
                  requestId: request._id,
                  startTime,
                  endTime,
                  duration: granted,
                  grantedDuration: granted,
                  ...usageFields,
                  status: 'approved',
                  approvedBy: reviewer._id,
                  approvedAt: new Date(),
                  ...keepApplied,
                  ...pastClose,
                  ...keepEnded,
                },
                ...(settledWp ? { workProgress: settledWp } : {}),
                note: `Permission Approved: ${startTime || ''}-${endTime || ''}${request.reason ? ` (${request.reason})` : ''}${pastNote}`,
              },
              $setOnInsert: { status: 'absent' },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }
    } catch (e) {
      // Non-fatal: approval itself succeeded; attendance mirror is best-effort.
      console.error('Failed to mirror approved permission to attendance:', e?.message || e);
    }
  }
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_WRITE_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    const requestType = searchParams.get('requestType') || '';
    const query = { status };
    if (requestType) query.requestType = requestType;

    const requests = await SelfServiceRequest.find(query)
      .populate('identityId', 'legalName primaryEmail displayName')
      .populate('profileId', 'employeeNumber employmentStatus department designation')
      .populate('reviewerUserId', 'name')
      .sort({ createdAt: -1 })
      .limit(100);

    // Annotate pending permission requests with approval feasibility so the
    // HR UI can hide/disable requests that would fail the allowance re-check.
    if (status === 'pending') {
      try {
        const { getGlobalConfig, getPayrollDay, getCycleMonth, getCycleRange } = await import('@/lib/payroll-cycle');
        const { getPermissionAllowanceMins, getPermissionUsageForCycle } = await import('@/lib/permission-allowance');
        const cfg = await getGlobalConfig();
        const allowance = getPermissionAllowanceMins(cfg);
        const startDay = getPayrollDay(cfg.payrollStartDay, 26);
        const endDay = getPayrollDay(cfg.payrollEndDay, 25);
        for (const r of requests) {
          if (r.requestType !== 'permission' || r.status !== 'pending') continue;
          const obj = r.toObject ? r.toObject() : r;
          try {
            const permDate = r.payload?.date;
            if (!permDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(permDate))) {
              obj._canApprove = true;
              obj._exceedReason = '';
            } else {
              const { year, month } = getCycleMonth(String(permDate), startDay);
              const { fromDate, toDate } = getCycleRange(startDay, endDay, year, month);
              const usage = await getPermissionUsageForCycle(r.profileId?._id || r.profileId, fromDate, toDate);
              const remaining = Math.max(0, allowance - usage.totalUsed);
              obj._canApprove = usage.totalUsed <= allowance;
              obj._remaining = remaining;
              obj._allowance = allowance;
              obj._cycleRange = { fromDate, toDate };
              obj._exceedReason = obj._canApprove
                ? ''
                : `Permission allowance exceeded for cycle ${fromDate} to ${toDate}. ${remaining} mins remaining of ${allowance} mins.`;
            }
          } catch {
            obj._canApprove = true;
            obj._exceedReason = '';
          }
          const idx = requests.indexOf(r);
          if (idx >= 0) requests[idx] = obj;
        }
      } catch (e) {
        console.error('canApprove annotation failed:', e?.message || e);
      }
    }
    return ok({ requests });
  } catch (e) {
    return fail(e.message, e.statusCode || 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_WRITE_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const body = await req.json();
    const validation = validateRequest(ReviewSelfServiceRequestSchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const request = await SelfServiceRequest.findById(body.id);
    if (!request) return fail('Request not found', 404);
    if (request.status !== 'pending') return fail('Request already processed', 400);

    if (request.requestType === 'resignation' && validation.data.action === 'approved') {
      request.payload = {
        ...request.payload,
        noticePeriodDays: validation.data.noticePeriodDays ?? request.payload.noticePeriodDays ?? 0,
        lastWorkingDate: validation.data.lastWorkingDate ?? request.payload.lastWorkingDate,
      };
      request.markModified('payload');
    }

    if (validation.data.action === 'approved') {
      await applyApprovedRequest(request, user);
    }

    request.status = validation.data.action;
    request.reviewerUserId = user._id;
    request.reviewedAt = new Date();
    request.reviewNote = validation.data.reviewNote || '';
    await request.save();

    // Notify the employee
    const identity = await (await import('@/lib/models/Identity')).default.findById(request.identityId).select('authUserId legalName');
    if (identity?.authUserId) {
      const typeLabel = request.requestType.replace(/_/g, ' ');
      const approved = validation.data.action === 'approved';
      await notify(
        identity.authUserId,
        approved ? `Request Approved — ${typeLabel}` : `Request Rejected — ${typeLabel}`,
        approved
          ? `Your ${typeLabel} request has been approved.${validation.data.reviewNote ? ' Note: ' + validation.data.reviewNote : ''}`
          : `Your ${typeLabel} request was rejected.${validation.data.reviewNote ? ' Reason: ' + validation.data.reviewNote : ''}`,
        'self_service',
        request._id
      );
    }

    await auditLog('Self-Service Request Reviewed', 'SelfService', user._id, `${validation.data.action} ${request.requestType} request`, validation.data.action === 'approved' ? 'medium' : 'low', req.headers.get('x-forwarded-for') || '', null, identity?.authUserId || null);
    const updatedRequest = await SelfServiceRequest.findById(request._id)
      .populate('identityId', 'legalName primaryEmail displayName')
      .populate('profileId', 'employeeNumber employmentStatus department designation')
      .populate('reviewerUserId', 'name');
    return ok({ request: updatedRequest || request });
  } catch (e) {
    return fail(e.message, e.statusCode || 500);
  }
}
