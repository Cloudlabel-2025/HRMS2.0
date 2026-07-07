import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Shift, Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime } from '@/lib/timezone';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// getTodayStr is removed as we get the timezone-aware date string directly in POST

export async function POST(req) {
  try {
    // Auth: support either super_admin JWT or CRON_SECRET header
    const cronSecret = req.headers.get('x-cron-secret');
    const envCronSecret = process.env.CRON_SECRET;

    if (cronSecret !== envCronSecret) {
      const { user, error } = await requireAuth(req);
      if (error) return error;
      if (user.role !== 'super_admin') {
        return fail('Access denied. super_admin role or valid CRON_SECRET required.', 403);
      }
    }

    await connectDB();

    const now = await getTzTime();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    // Get all shifts
    const shifts = await Shift.find({}).lean();
    const autoLoggedOut = [];

    for (const shift of shifts) {
      if (!shift.startTime || !shift.endTime) continue;

      const endMinutes = parseTimeToMinutes(shift.endTime);
      if (endMinutes === null) continue;

      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      // Check if 5 hours have passed since shift end
      // For overnight shifts (end < start), add 24h to end time
      const startMinutes = parseTimeToMinutes(shift.startTime);
      let effectiveEndMinutes = endMinutes;
      if (startMinutes !== null && endMinutes < startMinutes) {
        effectiveEndMinutes = endMinutes + 24 * 60;
      }

      const effectiveNowMinutes = nowMinutes < effectiveEndMinutes ? nowMinutes + 24 * 60 : nowMinutes;

      if (effectiveNowMinutes < effectiveEndMinutes + 300) continue; // 300 min = 5 hours

      // Resolve attendance date for this shift at the current time
      let attendanceToday;
      try {
        attendanceToday = getAttendanceDate(now, shift.startTime, shift.endTime);
      } catch {
        attendanceToday = todayStr;
      }

      // Also check yesterday (in case of overnight shifts where attendance date might be yesterday)
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');

      const searchDates = [attendanceToday];
      if (attendanceToday !== yesterdayStr) {
        searchDates.push(yesterdayStr);
      }

      // Find users with this shift name who haven't clocked out
      const users = await User.find({ shift: shift.name, status: 'active' }).lean();
      const userIds = users.map(u => u._id);

      if (userIds.length === 0) continue;

      const records = await Attendance.find({
        userId: { $in: userIds },
        date: { $in: searchDates },
        clockIn: { $ne: null },
        clockOut: null,
        autoLoggedOut: { $ne: true },
      }).lean();

      for (const record of records) {
        const nowTimeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

        // Calculate hours worked
        const [ih, im] = record.clockIn.split(':').map(Number);
        const [oh, om] = nowTimeStr.split(':').map(Number);
        let elapsedMins = (oh * 60 + om) - (ih * 60 + im);
        if (elapsedMins < 0) elapsedMins += 24 * 60;

        let finalClockOut = nowTimeStr;
        let finalMinutes = elapsedMins;

        if (elapsedMins >= 600) {
          const clockOutMinutes = ih * 60 + im + 600;
          const foh = Math.floor(clockOutMinutes / 60) % 24;
          const fom = clockOutMinutes % 60;
          finalClockOut = String(foh).padStart(2, '0') + ':' + String(fom).padStart(2, '0');
          finalMinutes = 600;
        }

        const deduction = record.breakDeduction || 0;
        const finalHours = Math.min(480, Math.max(0, finalMinutes - deduction));
        let status = record.status;
        if (finalHours < 240) {
          status = 'absent';
        } else {
          status = 'present';
        }

        await Attendance.findOneAndUpdate(
          { _id: record._id },
          {
            $set: {
              clockOut: finalClockOut,
              hoursWorked: finalHours,
              baseHoursWorked: record.baseHoursWorked || finalMinutes,
              autoLoggedOut: true,
              status,
              workProgress: (record.workProgress || []).map(row => (
                row.startTime && !row.endTime
                  ? { ...row, endTime: finalClockOut, status: row.status === 'work_in_progress' ? 'stopped' : row.status }
                  : row
              )),
              breaks: (record.breaks || []).map(row => (
                row.start && !row.end ? { ...row, end: finalClockOut } : row
              )),
            },
          }
        );

        autoLoggedOut.push({
          userId: record.userId,
          date: record.date,
          clockIn: record.clockIn,
          clockOut: nowTimeStr,
        });
      }
    }

    return ok({
      message: `Auto-logout completed. ${autoLoggedOut.length} employee(s) were auto-logged out.`,
      count: autoLoggedOut.length,
      records: autoLoggedOut,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
