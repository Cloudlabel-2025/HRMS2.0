import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const LATE_THRESHOLD_MINUTES = 15; // minutes after 9:00 AM

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { action } = await req.json(); // 'in' | 'out'
    const today = new Date().toISOString().split('T')[0];
    const now   = new Date();
    const timeStr = now.toTimeString().slice(0, 5); // 'HH:MM'

    let record = await Attendance.findOne({ userId: user._id, date: today });

    if (action === 'in') {
      if (record?.clockIn) return fail('Already clocked in today');

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
    } else if (action === 'out') {
      if (!record?.clockIn) return fail('You have not clocked in yet');
      if (record?.clockOut) return fail('Already clocked out today');

      // Calculate hours worked
      const [ih, im] = record.clockIn.split(':').map(Number);
      const [oh, om] = timeStr.split(':').map(Number);
      const minutes  = (oh * 60 + om) - (ih * 60 + im);

      record = await Attendance.findOneAndUpdate(
        { userId: user._id, date: today },
        { clockOut: timeStr, hoursWorked: minutes },
        { new: true }
      );
    } else {
      return fail('Invalid action. Use "in" or "out"');
    }

    return ok({ record, time: timeStr });
  } catch (e) {
    return fail(e.message, 500);
  }
}
