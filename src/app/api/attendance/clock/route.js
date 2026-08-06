import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Leave, Absence, SelfServiceRequest } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ClockInOutSchema, validateRequest } from '@/lib/validation';
import { getGlobalConfig, parseShiftStartTime } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime } from '@/lib/timezone';
import { checkAndApplyAutoLogout } from '@/lib/attendance-utils';
import { resolveShift } from '@/lib/shift-utils';
import { getShiftConfig, calculateHoursWorked, determineStatus, diffMins } from '@/lib/attendance-constants';
import { calculateBreakDeduction, getBreakAllowanceForEntry } from '@/lib/attendance-breaks';
import { isEmployer } from '@/lib/permissions';
import { notify } from '@/lib/notify';

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
    const now   = await getTzTime();
    const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0'); // 'HH:MM'

    const shiftDoc = await resolveShift(user);
    const config = await getGlobalConfig();
    const cfg = getShiftConfig(shiftDoc, config);

    // Resolve shift-aware attendance date
    let today;
    try {
      today = getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
    } catch {
      today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    }

    let record = await Attendance.findOne({ userId: user._id, date: today });

    const ip = req.headers.get('x-forwarded-for') || '';

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
            auditLog('Clock In (Auto-Closed Stale Session)', 'Attendance', user._id, `Auto-closed stale session from ${stale.date} ${stale.clockIn} -> ${stale.clockOut}`, 'medium', ip, null, user._id);
          }
          return ok({ record: openRecord, alreadyClockedIn: true, time: timeStr });
        }
        // The open session belongs to a PREVIOUS attendance date (overnight shift). Force-close
        // it and proceed with today's clock-in — never return the old 400 lockout.
        for (const stale of openRecords) {
          await checkAndApplyAutoLogout(stale, now, cfg, shiftDoc, isEmployer(user.role), { force: true });
          await stale.save();
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

      let shiftHour = 9, shiftMin = 0;
      let shiftFound = false;
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

        const shiftStartMins = shiftHour * 60 + shiftMin;
        const limitMins = shiftStartMins + 120;
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const fmtTime = t => {
          if (!t) return t;
          const tf = config?.timeFormat;
          if (tf !== '12h') return t;
          const [h, m] = t.split(':').map(Number);
          if (isNaN(h) || isNaN(m)) return t;
          const ampm = h >= 12 ? 'PM' : 'AM';
          return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
        };

        for (const perm of approvedPermissions) {
          const startTime = perm.payload?.startTime;
          const endTime = perm.payload?.endTime;
          if (startTime && endTime) {
            const [psh, psm] = startTime.split(':').map(Number);
            const [peh, pem] = endTime.split(':').map(Number);
            const permStartMins = psh * 60 + psm;
            let permEndMins = peh * 60 + pem;
            if (permEndMins < permStartMins) permEndMins += 24 * 60;

            if (permStartMins <= limitMins) {
              if (nowMins < permEndMins) {
                auditLog('Clock In Blocked', 'Attendance', user._id, `Block due to active morning permission (${fmtTime(startTime)} to ${fmtTime(endTime)})`, 'low', ip, null, user._id);
                return fail(`You have an approved permission request today from ${fmtTime(startTime)} to ${fmtTime(endTime)}. You cannot clock in until the permission is over.`, 400);
              }
            }
          }
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

      const [h, m] = timeStr.split(':').map(Number);
      let minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
      if (minutesSinceShiftStart < -720) minutesSinceShiftStart += 1440;
      if (minutesSinceShiftStart > 720) minutesSinceShiftStart -= 1440;
      let lateFlag = false;
      let status = 'present';

      if (shiftFound) {
        const result = determineStatus(minutesSinceShiftStart, cfg);
        status = result.status;
        lateFlag = result.lateFlag;
      }

      // Create absence record for half-day or full-day leave due to late clock-in
      if (status === 'half_day' || status === 'leave') {
        await Absence.findOneAndUpdate(
          { userId: user._id, date: today },
          {
            $set: {
              userId: user._id,
              date: today,
              reason: status === 'half_day' ? 'Half day - late clock-in' : 'Full day - very late clock-in',
              flagged: status === 'leave',
            },
          },
          { upsert: true }
        );
      }

      const isEarlyLogin = shiftFound && shiftHour * 60 + shiftMin > (h * 60 + m);

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        {
          $set: {
            clockIn: timeStr,
            status,
            lateFlag,
            earlyLogin: isEarlyLogin,
            note: body.reason ? `Early login reason: ${body.reason}` : '',
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
            }],
            breaks: [],
            breakDeduction: 0,
            baseHoursWorked: 0,
          },
        },
        { upsert: true, new: true }
      );

      if (isOnLeave && record) {
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
            'Leave Day Clock-In',
            `${user.name || 'Employee'} clocked in on approved ${onLeave.type} day (${onLeave.from} to ${onLeave.to}). Please review and approve or reject.`,
            'attendance',
            record._id
          );
        }
        auditLog('Clock In (Leave Day)', 'Attendance', user._id, `Clocked in on approved ${onLeave.type} day`, 'medium', ip, null, user._id);
      }

      await auditLog('Clock In', 'Attendance', user._id, `Clocked in at ${timeStr}, Status: ${status}${lateFlag ? ' (Late)' : ''}`, 'low', ip, null, user._id);

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
      const { baseHours, hoursWorked } = calculateHoursWorked(finalMinutes, deduction, cfg);
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
      if (hoursWorked < cfg.absentThreshold) {
        status = 'absent';
      }

      record = await Attendance.findOneAndUpdate(
        { _id: outRecord._id },
        {
          clockOut: finalClockOut,
          hoursWorked,
          baseHoursWorked: outRecord.baseHoursWorked ?? baseHours,
          autoLoggedOut: isAutoLogout,
          status,
          workProgress: (outRecord.workProgress || []).map(row => (
            row.startTime && !row.endTime
              ? { ...(row.toObject ? row.toObject() : row), endTime: finalClockOut, status: row.status === 'work_in_progress' ? 'stopped' : row.status }
              : row
          )),
          breaks: updatedBreaks,
        },
        { new: true }
      );

      await auditLog('Clock Out', 'Attendance', user._id, `Clocked out at ${finalClockOut}, Hours worked: ${Math.floor(hoursWorked/60)}h ${hoursWorked%60}m${isAutoLogout ? ' (Auto Clock Out)' : ''}`, 'low', ip, null, user._id);

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
