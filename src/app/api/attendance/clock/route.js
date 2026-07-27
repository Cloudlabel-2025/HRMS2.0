import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Leave, Shift, Absence, SelfServiceRequest } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ClockInOutSchema, validateRequest } from '@/lib/validation';
import { getGlobalConfig, parseShiftStartTime } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime } from '@/lib/timezone';
import { checkAndApplyAutoLogout } from '@/lib/attendance-utils';
import { getShiftConfig, calculateHoursWorked, determineStatus, calculateBreakDeduction } from '@/lib/attendance-constants';
import { notify } from '@/lib/notify';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    
    // Validate request
    const validation = validateRequest(ClockInOutSchema, body);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }
    
    const { action } = validation.data; // 'in' | 'out'
    const now   = await getTzTime();
    const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0'); // 'HH:MM'

    // Resolve shift-aware attendance date
    let today;
    try {
      const shiftDoc = await Shift.findOne({ name: user.shift || 'Morning (9AM-6PM)' }).lean();
      today = getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
    } catch {
      today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    }

    let record = await Attendance.findOne({ userId: user._id, date: today });

    const ip = req.headers.get('x-forwarded-for') || '';

    if (action === 'in') {
      const openRecord = await Attendance.findOne({ userId: user._id, clockIn: { $ne: null }, clockOut: null });
      if (openRecord) {
        if (checkAndApplyAutoLogout(openRecord, now)) {
          await openRecord.save();
        } else {
          auditLog('Clock In Attempted', 'Attendance', user._id, `Already clocked in and active`, 'low', ip, null, user._id);
          return fail('You are already clocked in and have an active session.', 400);
        }
      }

      if (record?.clockIn) {
        auditLog('Clock In Attempted', 'Attendance', user._id, `Already clocked in today`, 'low', ip, null, user._id);
        return fail('Already clocked in today', 400);
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

      const config = await getGlobalConfig();
      const shiftDoc = await Shift.findOne({ name: user.shift || 'Morning (9AM-6PM)' }).lean();
      const cfg = getShiftConfig(shiftDoc, config);

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
                auditLog('Clock In Blocked', 'Attendance', user._id, `Block due to active morning permission (${startTime} to ${endTime})`, 'low', ip, null, user._id);
                return fail(`You have an approved permission request today from ${startTime} to ${endTime}. You cannot clock in until the permission is over.`, 400);
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
      }

      const [h, m] = timeStr.split(':').map(Number);
      const minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
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

    } else if (action === 'out') {
      if (!record?.clockIn) {
        auditLog('Clock Out Attempted', 'Attendance', user._id, `Not clocked in yet`, 'low', ip, null, user._id);
        return fail('You have not clocked in yet', 400);
      }
      if (record?.clockOut) {
        auditLog('Clock Out Attempted', 'Attendance', user._id, `Already clocked out today`, 'low', ip, null, user._id);
        return fail('Already clocked out today', 400);
      }

      const outConfig = await getGlobalConfig();
      const outShiftDoc = await Shift.findOne({ name: user.shift || 'Morning (9AM-6PM)' }).lean();
      const outCfg = getShiftConfig(outShiftDoc, outConfig);

      const [ih, im] = record.clockIn.split(':').map(Number);
      const [oh, om] = timeStr.split(':').map(Number);
      let elapsedMins = (oh * 60 + om) - (ih * 60 + im);
      if (elapsedMins < 0) elapsedMins += 24 * 60; // overnight support

      let finalClockOut = timeStr;
      let isAutoLogout = false;
      let finalMinutes = elapsedMins;

      if (elapsedMins >= outCfg.hardCapHours) {
        const clockOutMinutes = ih * 60 + im + outCfg.hardCapHours;
        const foh = Math.floor(clockOutMinutes / 60) % 24;
        const fom = clockOutMinutes % 60;
        finalClockOut = String(foh).padStart(2, '0') + ':' + String(fom).padStart(2, '0');
        isAutoLogout = true;
        finalMinutes = outCfg.hardCapHours;
      }

      const deduction = record.breakDeduction || 0;
      const { baseHours, hoursWorked } = calculateHoursWorked(finalMinutes, deduction, outCfg);
      let status = record.status;
      if (hoursWorked < outCfg.absentThreshold) {
        status = 'absent';
      }

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        {
          clockOut: finalClockOut,
          hoursWorked,
          baseHoursWorked: record.baseHoursWorked || baseHours,
          autoLoggedOut: isAutoLogout,
          status,
          workProgress: (record.workProgress || []).map(row => (
            row.startTime && !row.endTime
              ? { ...(row.toObject ? row.toObject() : row), endTime: finalClockOut, status: row.status === 'work_in_progress' ? 'stopped' : row.status }
              : row
          )),
          breaks: (record.breaks || []).map(row => (
            row.start && !row.end ? { ...(row.toObject ? row.toObject() : row), end: finalClockOut } : row
          )),
        },
        { new: true }
      );

      await auditLog('Clock Out', 'Attendance', user._id, `Clocked out at ${finalClockOut}, Hours worked: ${Math.floor(hoursWorked/60)}h ${hoursWorked%60}m${isAutoLogout ? ' (Auto Clock Out)' : ''}`, 'low', ip, null, user._id);

    } else {
      return fail('Invalid action. Use "in" or "out"', 400);
    }

    return ok({ record, time: timeStr });
  } catch (e) {
    return fail(e.message, 500);
  }
}
