import { connectDB } from '@/lib/db';
import { Absence, Employee, Leave } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month');
    const query = {};
    if (month) query.date = { $regex: `^${month}` };
    if (!['super_admin','admin_full','team_admin','team_lead'].includes(user.role)) query.userId = user._id;

    const absences = await Absence.find(query)
      .populate('userId', 'name avatar department')
      .sort({ date: -1 });

    // Attach pattern count per user
    const withPattern = await Promise.all(absences.map(async (a) => {
      const count = await Absence.countDocuments({ userId: a.userId._id });
      return { ...a.toObject(), pattern: count };
    }));

    // Also include employees with no clock-in today as absent (virtual entries)
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const isCurrentMonth = !month || month === today.slice(0, 7);

    if (isCurrentMonth && ['super_admin', 'admin_full'].includes(user.role)) {
      const activeEmployees = await Employee.find({ status: 'active' }).select('userId name department').lean();
      const todayAttendance = await Attendance.find({ date: today }).select('userId status').lean();
      const todayAbsenceDates = new Set(withPattern.filter(a => a.date === today).map(a => a.userId?._id?.toString()));
      const attendedIds = new Set(todayAttendance.map(a => a.userId.toString()));

      const todayLeaves = await Leave.find({
        status: 'approved',
        from: { $lte: today },
        to: { $gte: today },
      }).select('userId').lean();
      const onLeaveIds = new Set(todayLeaves.map(l => l.userId.toString()));

      for (const emp of activeEmployees) {
        const uid = emp.userId?.toString();
        if (!uid) continue;
        // Skip if they already have an Absence record for today
        if (todayAbsenceDates.has(uid)) continue;
        // Skip if they are on approved leave
        if (onLeaveIds.has(uid)) continue;
        // If they have no attendance record for today, they are absent
        if (!attendedIds.has(uid)) {
          const totalAbs = await Absence.countDocuments({ userId: uid });
          withPattern.push({
            _id: 'absent_' + uid + '_' + today,
            userId: { _id: uid, name: emp.name, avatar: '', department: emp.department || '' },
            date: today,
            reason: 'Absent (no clock-in)',
            flagged: false,
            pattern: totalAbs + 1,
            _virtual: true,
          });
        }
      }
    }

    return ok({ absences: withPattern });
  } catch (e) {
    return fail(e.message, 500);
  }
}
