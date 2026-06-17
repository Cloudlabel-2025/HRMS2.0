import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import { Leave, Shift, Absence } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ClockInOutSchema, validateRequest } from '@/lib/validation';
import { getGlobalConfig, parseShiftStartTime } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';

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
    const now   = new Date();
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
      if (onLeave) {
        auditLog('Clock In Blocked', 'Attendance', user._id, `On approved ${onLeave.type} (${onLeave.from} to ${onLeave.to})`, 'low', ip, null, user._id);
        return fail(`You are on approved ${onLeave.type} today (${onLeave.from} to ${onLeave.to}). Clock-in is not allowed.`, 400);
      }

      const config = await getGlobalConfig();
      const LATE_THRESHOLD_MINUTES = Number(config.lateThreshold) || 15;

      // Determine shift start time from the user's assigned shift
      let shiftHour = 9, shiftMin = 0;
      let shiftFound = false;
      try {
        const shiftDoc = await Shift.findOne({ name: user.shift || 'Morning (9AM-6PM)' }).lean();
        if (shiftDoc?.startTime) {
          const [sh, sm] = shiftDoc.startTime.split(':').map(Number);
          shiftHour = sh; shiftMin = sm;
          shiftFound = true;
        }
      } catch (e) { /* fall through to parser */ }
      if (!shiftFound) {
        const parsed = parseShiftStartTime(user.shift);
        if (parsed) {
          const [sh, sm] = parsed.split(':').map(Number);
          shiftHour = sh; shiftMin = sm;
          shiftFound = true;
        }
      }
      // If we still don't know the shift time, default to present (benefit of doubt)

      const [h, m] = timeStr.split(':').map(Number);
      const minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
      const FIVE_HOURS  = 300;
      const THREE_HOURS = 180;
      let lateFlag = false;
      let status = 'present';

      if (shiftFound) {
        if (minutesSinceShiftStart > FIVE_HOURS) {
          status = 'leave';
          lateFlag = true;
        } else if (minutesSinceShiftStart > THREE_HOURS) {
          status = 'half_day';
          lateFlag = true;
        } else if (minutesSinceShiftStart > LATE_THRESHOLD_MINUTES) {
          status = 'late';
          lateFlag = true;
        }
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

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        {
          $set: {
            clockIn: timeStr,
            status,
            lateFlag,
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

      const [ih, im] = record.clockIn.split(':').map(Number);
      const [oh, om] = timeStr.split(':').map(Number);
      const minutes  = (oh * 60 + om) - (ih * 60 + im);
      const deduction = record.breakDeduction || 0;

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        {
          clockOut: timeStr,
          hoursWorked: Math.max(0, minutes - deduction),
          baseHoursWorked: record.baseHoursWorked || minutes,
          workProgress: (record.workProgress || []).map(row => (
            row.startTime && !row.endTime
              ? { ...(row.toObject ? row.toObject() : row), endTime: timeStr, status: row.status === 'work_in_progress' ? 'stopped' : row.status }
              : row
          )),
          breaks: (record.breaks || []).map(row => (
            row.start && !row.end ? { ...(row.toObject ? row.toObject() : row), end: timeStr } : row
          )),
        },
        { new: true }
      );

      await auditLog('Clock Out', 'Attendance', user._id, `Clocked out at ${timeStr}, Hours worked: ${Math.floor(minutes/60)}h ${minutes%60}m`, 'low', ip, null, user._id);

    } else {
      return fail('Invalid action. Use "in" or "out"', 400);
    }

    return ok({ record, time: timeStr });
  } catch (e) {
    return fail(e.message, 500);
  }
}
