import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Leave, Holiday, SelfServiceRequest } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ClockInOutSchema, validateRequest } from '@/lib/validation';
import { getGlobalConfig, parseShiftStartTime, isWorkingDay } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime, toTzLocal } from '@/lib/timezone';
import { checkAndApplyAutoLogout, finalizeDayWork } from '@/lib/attendance-utils';
import { resolveShift } from '@/lib/shift-utils';
import { getShiftConfig, calculateHoursWorked, diffMins } from '@/lib/attendance-constants';
import { resolveDayStatus } from '@/lib/attendance-resolver';
import { computePermissionUsage, permissionCoversShiftStart } from '@/lib/permission-allowance';
import { calculateBreakDeduction, getBreakAllowanceForEntry } from '@/lib/attendance-breaks';
import { isEmployer } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { publishAttendance } from '@/lib/sse';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (isEmployer(user.role)) return fail('Employer accounts do not track attendance', 403);
    await connectDB();

    const body = await req.json();
    
    // Validate request
    const validation = validateRequest(ClockInOutSchema, body);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }
    
    const { action } = validation.data; // 'in' | 'out'
    const geo = body.geo;
    let deductionBreakdown;
    const ip = req.headers.get('x-forwarded-for') || '';
    // Server time is authoritative. Client time is accepted only within 5m
    // drift (offline tolerance); larger skew falls back to server time and
    // is audited to prevent late-evasion via spoofed wall clocks.
    const serverNow = await getTzTime();
    let now = serverNow;
    const clientNow = body.clientTime ? new Date(body.clientTime) : null;
    if (clientNow && !isNaN(clientNow.getTime())) {
      try {
        const clientLocal = await toTzLocal(clientNow);
        const driftMs = Math.abs(clientLocal.getTime() - serverNow.getTime());
        if (driftMs <= 5 * 60 * 1000) {
          now = clientLocal;
        } else {
          auditLog('Clock Time Skew', 'Attendance', user._id, `Client time drift ${Math.round(driftMs / 60000)}m rejected; server time used`, 'medium', ip, null, user._id);
        }
      } catch { now = serverNow; }
    }
    const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0'); // 'HH:MM'

    // Lazy fallback: apply any due scheduled shift changes for this user before
    // resolving their shift, so a missed cron never leaves the user on a stale shift.
    // Re-fetch afterwards: the applier writes via updateMany, so the
    // JWT-decoded `user` would otherwise stay stale and this clock-in would
    // still be judged by the old shift.
    try {
      const { applyDueShiftChangesForUser } = await import('@/lib/shift-assign');
      const n = await applyDueShiftChangesForUser(user);
      if (n > 0) {
        try {
          const fresh = await User.findById(user._id).select('shift shiftId').lean();
          if (fresh) { user.shift = fresh.shift; user.shiftId = fresh.shiftId; }
        } catch { /* fallback to stale user */ }
      }
    } catch (e) {
      /* non-fatal */
    }

    let shiftDoc = await resolveShift(user);
    const config = await getGlobalConfig();

    // Resolve shift-aware attendance date
    let today;
    try {
      today = getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
    } catch {
      today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    }

    const cfg = getShiftConfig(shiftDoc, config);

    let record = await Attendance.findOne({ userId: user._id, date: today });

    // Non-fatal: never let SSE publishing break the primary clock response.
    const publishRecordEvent = (type, rec) => {
      try {
        publishAttendance({
          type,
          userId: user._id.toString(),
          name: user.name,
          date: rec.date,
          clockIn: rec.clockIn,
          clockOut: rec.clockOut || null,
          hoursWorked: rec.hoursWorked,
          status: rec.status,
          autoLoggedOut: !!rec.autoLoggedOut,
        });
      } catch (e) { /* ignore */ }
    };

    if (action === 'in') {
      const openRecords = await Attendance.find({ userId: user._id, clockIn: { $ne: null }, clockOut: null }).sort({ date: -1 });
      const openRecord = openRecords[0] || null;
      if (openRecord) {
        if (openRecord.date === today) {
          // Idempotent: the open session is the resolved-date record. Return success so page
          // refreshes / double-clicks can't wedge the user, but also close any OTHER orphaned
          // open records from previous attendance dates.
          for (const stale of openRecords) {
            if (stale.date === today) continue;
            await checkAndApplyAutoLogout(stale, now, cfg, shiftDoc, isEmployer(user.role), { force: true });
            await stale.save();
            publishRecordEvent('clockout', stale);
            auditLog('Clock In (Auto-Closed Stale Session)', 'Attendance', user._id, `Auto-closed stale session from ${stale.date} ${stale.clockIn} -> ${stale.clockOut}`, 'medium', ip, null, user._id);
          }
          return ok({ record: openRecord, alreadyClockedIn: true, time: timeStr });
        }
        // The open session belongs to a PREVIOUS attendance date (overnight shift). Force-close
        // it and proceed with today's clock-in — never return the old 400 lockout.
        for (const stale of openRecords) {
          await checkAndApplyAutoLogout(stale, now, cfg, shiftDoc, isEmployer(user.role), { force: true });
          await stale.save();
          publishRecordEvent('clockout', stale);
          auditLog('Clock In (Auto-Closed Stale Session)', 'Attendance', user._id, `Auto-closed stale session from ${stale.date} ${stale.clockIn} -> ${stale.clockOut}`, 'medium', ip, null, user._id);
        }
        record = await Attendance.findOne({ userId: user._id, date: today });
      }

      if (record?.clockIn) {
        auditLog('Clock In Attempted', 'Attendance', user._id, `Already clocked in today (idempotent success)`, 'low', ip, null, user._id);
        return ok({ record, alreadyClockedIn: true, time: timeStr });
      }

      const onLeave = await Leave.findOne({
        userId: user._id,
        status: 'approved',
        from: { $lte: today },
        to:   { $gte: today },
      });
      let isOnLeave = false;
      if (onLeave && user.role !== 'super_admin') {
        isOnLeave = true;
        auditLog('Clock In (Leave Day)', 'Attendance', user._id, `On approved ${onLeave.type} (${onLeave.from} to ${onLeave.to})`, 'medium', ip, null, user._id);
      }
      const holidays = await Holiday.find({ date: today }).lean();
      const isNonWorkingDay = !isWorkingDay(today, config, holidays);
      const nonWorkingDayType = holidays.length ? 'holiday' : (isNonWorkingDay ? 'weekly_off' : 'none');

      let shiftHour = 9, shiftMin = 0;
      let shiftFound = false;
      let clockInPermission = null;
      let permissionUsage = { used: 0, refunded: 0, applied: false, isMidDay: true };
      if (shiftDoc?.startTime) {
        const [sh, sm] = shiftDoc.startTime.split(':').map(Number);
        shiftHour = sh; shiftMin = sm;
        shiftFound = true;
      }
      if (!shiftFound) {
        const parsed = parseShiftStartTime(user.shift);
        if (parsed) {
          const [sh, sm] = parsed.split(':').map(Number);
          shiftHour = sh; shiftMin = sm;
          shiftFound = true;
        }
      }
      // If we still don't know the shift time, default to present (benefit of doubt)

      if (shiftFound) {
        const approvedPermissions = await SelfServiceRequest.find({
          $or: [
            { identityId: user.identityId },
            { profileId: user.profileId }
          ],
          requestType: 'permission',
          status: 'approved',
          'payload.date': today
        });

        // Only one permission per day is allowed. Strict end-inclusive
        // (grace 0): actual at/before permEnd => present; actual at/after
        // permEnd+1m falls through to normal late evaluation.
        // e.g. permission 09:00-11:00: 11:00 = present, 11:01 = late.
        // Mid-day windows (not covering shift start) never affect late.
        const perm = approvedPermissions[0] || null;
        clockInPermission = perm;
        if (perm?.payload?.endTime) {
          const granted = Number(perm.payload?.duration || 0) || 0;
          const shiftStartMins = shiftHour * 60 + shiftMin;
          permissionUsage = computePermissionUsage({
            actualClockIn: timeStr,
            permStart: perm.payload?.startTime,
            permEnd: perm.payload?.endTime,
            grantedDuration: granted,
            shiftStartMins,
            lateThreshold: cfg?.lateThreshold ?? 15,
          });
        }
      }

      if (shiftFound) {
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const shiftStartMins = shiftHour * 60 + shiftMin;
        let earlyDiffMins = nowMins - shiftStartMins;
        if (earlyDiffMins < -720) earlyDiffMins += 1440;
        if (earlyDiffMins > 720) earlyDiffMins -= 1440;

        if (earlyDiffMins < -cfg.earlyWindow) {
          const reqReason = body.reason || '';
          if (!reqReason.trim()) {
            auditLog('Clock In Blocked', 'Attendance', user._id, `Early login by ${Math.abs(earlyDiffMins)} mins without reason`, 'low', ip, null, user._id);
            return fail('Early login by more than 2 hours requires a reason.', 400);
          }
          if (reqReason.trim().length < 10) {
            auditLog('Clock In Blocked', 'Attendance', user._id, `Early login by ${Math.abs(earlyDiffMins)} mins with insufficient reason`, 'low', ip, null, user._id);
            return fail('Please provide a detailed reason (at least 10 characters) for early login.', 400);
          }
        }
      } else {
        // Fallback: assume default shift 09:00 if shift not found
        shiftFound = true;
        shiftHour = 9;
        shiftMin = 0;
      }

      // clockIn always stores the real wall time. Permission never rewrites it;
      // late/present is decided against the permission window instead.
      const attendanceClockIn = timeStr;
      const [h, m] = attendanceClockIn.split(':').map(Number);
      const shiftStartMins = shiftHour * 60 + shiftMin;
      let minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
      if (minutesSinceShiftStart < -720) minutesSinceShiftStart += 1440;
      if (minutesSinceShiftStart > 720) minutesSinceShiftStart -= 1440;
      let lateFlag = false;
      let status = 'present';
      let permissionApplied = false;
      let isMidDayPermission = false;

      if (shiftFound) {
        const result = resolveDayStatus({
          clockIn: timeStr,
          permission: clockInPermission ? {
            startTime: clockInPermission.payload?.startTime,
            endTime: clockInPermission.payload?.endTime,
          } : null,
          approvedHalfDayLeave: !!onLeave?.halfDay,
          nonWorkingDayType,
          leaveOverrideStatus: 'none',
          minutesSinceShiftStart,
          shiftStartMins,
          cfg,
        });
        status = result.status;
        lateFlag = result.lateFlag;
        // Resolver says applied when arrival is inside a covering window;
        // usage calc says applied when time was actually consumed.
        // Trust the stricter of the two so early arrivals (used=0) don't
        // claim applied status.
        permissionApplied = result.permissionApplied && permissionUsage.applied;
        // Early arrival before shift start is on time and consumes nothing.
        const actualMins = h * 60 + m;
        if (clockInPermission && actualMins <= shiftStartMins) {
          permissionApplied = false;
          permissionUsage = {
            ...permissionUsage,
            used: 0,
            refunded: Number(clockInPermission.payload?.duration || 0) || 0,
            applied: false,
          };
        }
        isMidDayPermission = result.isMidDayPermission || permissionUsage.isMidDay;
        // Mid-day permission never flips late; usage already counts full grant.
        if (isMidDayPermission) permissionApplied = false;
      }

      // Approved half-day leave plus a clock-in is a half working day:
      // half_day status (0.5 presence in payroll) + half-day leave credit,
      // with no late/absence consequence.
      if (onLeave?.halfDay) {
        status = 'half_day';
        lateFlag = false;
      }

      // Wraparound-aware: early = clocked before shift start within the same
      // shift day (e.g. shift 22:00, clock 21:00 → early; clock 01:00 next
      // calendar day belongs to the 22:00 shift date, not early).
      const shiftStartMinsForEarly = shiftHour * 60 + shiftMin;
      const clockMinsForEarly = h * 60 + m;
      const earlyGap = (shiftStartMinsForEarly - clockMinsForEarly + 1440) % 1440;
      const isEarlyLogin = shiftFound && earlyGap > 0 && earlyGap < 720;

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        {
          $set: {
            clockIn: attendanceClockIn,
            status,
            lateFlag,
            earlyLogin: isEarlyLogin,
            // Frozen per-day shift snapshot — past rows stay judged by this
            // shift even if the employee's shift is changed later.
            shiftId: shiftDoc?._id || null,
            shiftName: shiftDoc?.name || user.shift || null,
            shiftStartTime: shiftDoc?.startTime || null,
            shiftEndTime: shiftDoc?.endTime || null,
            shiftLateThreshold: cfg?.lateThreshold ?? null,
            note: clockInPermission
              ? `Clocked in at ${timeStr}${permissionApplied ? ` with approved permission ${clockInPermission.payload?.startTime || ''}-${clockInPermission.payload?.endTime || ''} (used ${permissionUsage.used}/${Number(clockInPermission.payload?.duration || 0)} mins)` : isMidDayPermission ? ` (mid-day permission ${clockInPermission.payload?.startTime || ''}-${clockInPermission.payload?.endTime || ''} on file; late judged by shift)` : ` (arrived outside permission window ${clockInPermission.payload?.startTime || ''}-${clockInPermission.payload?.endTime || ''})`}${body.reason ? ` Early login reason: ${body.reason}` : ''}`
              : body.reason ? `Early login reason: ${body.reason}` : '',
            approvedHalfDayLeave: !!onLeave?.halfDay,
            relatedLeaveId: onLeave?._id || null,
            nonWorkingDayType,
            ...(clockInPermission ? (() => {
              const granted = Number(clockInPermission.payload?.duration || 0) || null;
              const effectiveClockIn = permissionApplied
                ? `${String(shiftHour).padStart(2, '0')}:${String(shiftMin).padStart(2, '0')}`
                : timeStr;
              return {
                permission: {
                  requestId: clockInPermission._id,
                  startTime: clockInPermission.payload?.startTime || null,
                  endTime: clockInPermission.payload?.endTime || null,
                  duration: granted,
                  grantedDuration: granted,
                  usedDuration: permissionUsage.used,
                  refundedDuration: permissionUsage.refunded,
                  actualClockIn: timeStr,
                  effectiveClockIn,
                  applied: permissionApplied,
                  isMidDay: isMidDayPermission,
                  status: 'approved',
                },
              };
            })() : {}),
            ...(geo ? { geoLocation: geo } : {}),
          },
          $setOnInsert: {
            workProgress: [{
              type: 'task',
              taskDetails: '',
              startTime: timeStr,
              endTime: null,
              status: 'work_in_progress',
              remarks: '',
              feedback: '',
              duration: null,
            }],
            breaks: [],
            breakDeduction: 0,
            baseHoursWorked: 0,
          },
        },
        { upsert: true, new: true }
      );

      if (((isOnLeave && !onLeave?.halfDay) || isNonWorkingDay) && record) {
        record.leaveOverride = { status: 'pending' };
        await record.save();

        const recipients = [];
        if (user.teamLeadId) recipients.push(user.teamLeadId);
        if (user.teamAdminId) recipients.push(user.teamAdminId);
        const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
        recipients.push(...admins.map(a => a._id));
        if (recipients.length) {
          await notify(
            [...new Set(recipients.map(String))],
            isNonWorkingDay ? 'Non-Working Day Clock-In' : 'Leave Day Clock-In',
            isNonWorkingDay
              ? `${user.name || 'Employee'} clocked in on ${holidays[0]?.name || 'a weekly off'} (${today}). Please review whether this counts as a working day.`
              : `${user.name || 'Employee'} clocked in on approved ${onLeave.type} day (${onLeave.from} to ${onLeave.to}). Please review and approve or reject.`,
            'attendance',
            record._id
          );
        }
        auditLog('Clock In (Leave Day)', 'Attendance', user._id, `Clocked in on approved ${onLeave.type} day`, 'medium', ip, null, user._id);
      }

      // Reconcile used vs granted on the permission request so unused time
      // returns to the monthly allowance (approved counts used, not granted).
      if (clockInPermission) {
        try {
          await SelfServiceRequest.findByIdAndUpdate(clockInPermission._id, {
            $set: {
              'payload.usedDuration': permissionUsage.used,
              'payload.refundedMins': permissionUsage.refunded,
              'payload.applied': permissionApplied,
              'payload.actualClockIn': timeStr,
              'payload.isMidDay': isMidDayPermission,
            },
          });
        } catch (e) { console.error('Permission usage reconcile failed:', e?.message || e); }
      }

      await auditLog('Clock In', 'Attendance', user._id, `Clocked in at ${timeStr}, Status: ${status}${lateFlag ? ' (Late)' : ''}${clockInPermission ? ` (Permission ${clockInPermission.payload?.startTime || ''}-${clockInPermission.payload?.endTime || ''} used ${permissionUsage.used}m)` : ''}`, 'low', ip, null, user._id);

      publishRecordEvent('clockin', record);

      // Late notification
      if (status === 'late' || (lateFlag && status !== 'leave')) {
        const lateMinutes = minutesSinceShiftStart - (cfg?.lateThreshold || 15);
        await notify(
          [user._id],
          'Late Clock-In',
          `You clocked in ${lateMinutes} minutes late today (${today}). Your attendance has been marked as Late.`,
          'attendance',
          record._id
        ).catch(() => {});
      }

    } else if (action === 'out') {
      // Clock-out must find the OPEN record regardless of the resolved date:
      // a night-shift employee clocking out after midnight may belong to a record
      // whose shift-aware date is "yesterday". Prefer the open record, then fall
      // back to the resolved-date record when it is itself open.
      let outRecord = await Attendance.findOne({ userId: user._id, clockIn: { $ne: null }, clockOut: null }).sort({ date: -1 });
      if (!outRecord && record?.clockIn && !record?.clockOut) {
        outRecord = record;
      }
      if (!outRecord) {
        if (record?.clockOut) {
          auditLog('Clock Out Attempted', 'Attendance', user._id, `Already clocked out today`, 'low', ip, null, user._id);
          return fail('Already clocked out today', 400);
        }
        auditLog('Clock Out Attempted', 'Attendance', user._id, `Not clocked in yet`, 'low', ip, null, user._id);
        return fail('You have not clocked in yet', 400);
      }

      const [ih, im] = outRecord.clockIn.split(':').map(Number);
      const [oh, om] = timeStr.split(':').map(Number);
      let elapsedMins = (oh * 60 + om) - (ih * 60 + im);
      if (elapsedMins < 0) elapsedMins += 24 * 60; // overnight support

      let finalClockOut = timeStr;
      let isAutoLogout = false;
      let finalMinutes = elapsedMins;

      // Recalculate break deduction from actual break records
      const updatedBreaks = (outRecord.breaks || []).map(row => (
        row.start && !row.end ? { ...(row.toObject ? row.toObject() : row), end: finalClockOut } : row
      ));
      const deduction = calculateBreakDeduction(updatedBreaks, cfg.breaks);
      const { baseHours, hoursWorked, payableHours, shortHours: rawShortHours } = calculateHoursWorked(finalMinutes, deduction, cfg);
      // Permission day: keep real hours worked for display (highlight Xh Ym / 8h)
      // but never flag shortHours / early clock-out — the excused time has no
      // business impact. Employee may still voluntarily work the full 8 hours.
      const hasPermission = !!(outRecord.permission?.requestId || outRecord.permission?.startTime);
      const shortHours = hasPermission ? false : rawShortHours;
      deductionBreakdown = {
        totalDeduction: deduction,
        breakLog: updatedBreaks.map(b => ({
          type: b.type,
          name: b.name,
          start: b.start,
          end: b.end,
          duration: diffMins(b.start, b.end),
          exceeded: diffMins(b.start, b.end) > getBreakAllowanceForEntry(b, cfg.breaks),
        })),
      };
      let status = outRecord.status;
      if (outRecord.approvedHalfDayLeave) status = 'half_day';

      const finalized = finalizeDayWork(outRecord.workProgress, finalClockOut, outRecord.date);
      record = await Attendance.findOneAndUpdate(
        { _id: outRecord._id },
        {
          clockOut: finalClockOut,
          hoursWorked,
          payableHours,
          shortHours,
          baseHoursWorked: baseHours,
          autoLoggedOut: isAutoLogout,
          regularizationOutOpen: false,
          status,
          workProgress: finalized,
          breaks: updatedBreaks,
        },
        { new: true }
      );

      await auditLog('Clock Out', 'Attendance', user._id, `Clocked out at ${finalClockOut}, Hours worked: ${Math.floor(hoursWorked/60)}h ${hoursWorked%60}m${isAutoLogout ? ' (Auto Clock Out)' : ''}`, 'low', ip, null, user._id);

      publishRecordEvent('clockout', record);

    } else {
      return fail('Invalid action. Use "in" or "out"', 400);
    }

    return ok({
      record,
      time: timeStr,
      hoursWorked: action === 'out' ? record.hoursWorked : undefined,
      deductionBreakdown: action === 'out' ? deductionBreakdown : undefined,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
