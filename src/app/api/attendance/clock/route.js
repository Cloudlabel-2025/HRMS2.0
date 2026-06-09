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

    if (action === 'in') {
      if (record?.clockIn) return fail('Already clocked in today', 400);

      // Block clock-in if employee has an approved leave covering today
      const onLeave = await Leave.findOne({
        userId: user._id,
        status: 'approved',
        from: { $lte: today },
        to:   { $gte: today },
      });
      if (onLeave) return fail(`You are on approved ${onLeave.type} today (${onLeave.from} to ${onLeave.to}). Clock-in is not allowed.`, 400);

      // Late detection: compare against 09:00
      const [h, m] = timeStr.split(':').map(Number);
      const minutesSince9 = (h - 9) * 60 + m;
      const lateFlag = minutesSince9 > LATE_THRESHOLD_MINUTES;
      const status   = lateFlag ? 'late' : 'present';

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        { clockIn: timeStr, status, lateFlag },
        { upsert: true, new: true }
      );

      // Audit log
      await auditLog(
        'Clock In',
        'Attendance',
        user._id,
        `Clocked in at ${timeStr}, Status: ${status}`,
        'low',
        req.headers.get('x-forwarded-for') || ''
      );

    } else if (action === 'out') {
      if (!record?.clockIn) return fail('You have not clocked in yet', 400);
      if (record?.clockOut) return fail('Already clocked out today', 400);

      // Calculate hours worked
      const [ih, im] = record.clockIn.split(':').map(Number);
      const [oh, om] = timeStr.split(':').map(Number);
      const minutes  = (oh * 60 + om) - (ih * 60 + im);

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        { clockOut: timeStr, hoursWorked: minutes },
        { new: true }
      );

      // Audit log
      await auditLog(
        'Clock Out',
        'Attendance',
        user._id,
        `Clocked out at ${timeStr}, Hours worked: ${Math.round(minutes/60)} hrs`,
        'low',
        req.headers.get('x-forwarded-for') || ''
      );

    } else {
      return fail('Invalid action. Use "in" or "out"', 400);
    }

    return ok({ record, time: timeStr });
  } catch (e) {
    return fail(e.message, 500);
  }
}
