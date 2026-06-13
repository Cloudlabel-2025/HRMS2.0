import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import { Leave } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ClockInOutSchema, validateRequest } from '@/lib/validation';

const LATE_THRESHOLD_MINUTES = 15; // minutes after 9:00 AM

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
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const timeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0'); // 'HH:MM'

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

      const [h, m] = timeStr.split(':').map(Number);
      const minutesSince9 = (h - 9) * 60 + m;
      const lateFlag = minutesSince9 > LATE_THRESHOLD_MINUTES;
      const status   = lateFlag ? 'late' : 'present';

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
