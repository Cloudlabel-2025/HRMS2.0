import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getTzTime } from '@/lib/timezone';
import { getAttendanceDate } from '@/lib/attendance-date';
import { resolveShift } from '@/lib/shift-utils';
import { computeWorkRowDuration } from '@/lib/attendance-constants';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    let body = {};
    try {
      body = await req.json();
    } catch {
      // fall through to validation below
    }
    const taskDetails = typeof body.taskDetails === 'string' ? body.taskDetails.trim() : '';
    if (!taskDetails) {
      return fail('Task details are required', 400);
    }

    const now = await getTzTime();
    const targetUser = await User.findById(user._id).select('shift shiftId').lean();
    const shiftDoc = targetUser ? await resolveShift(targetUser) : null;
    const today = getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);

    const record = await Attendance.findOne({ userId: user._id, date: today });
    if (!record || !record.clockIn) {
      return fail('Please clock in first to continue a task.', 400);
    }

    const workProgress = (record.workProgress || []).map(row => (row && typeof row.toObject === 'function' ? row.toObject() : { ...row }));

    const activeBreak = workProgress.find(row => row.type !== 'task' && row.startTime && !row.endTime);
    if (activeBreak) {
      return fail('Please end your current break before continuing a task.', 400);
    }

    const startTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const activeIdx = workProgress.findIndex(row => row.type === 'task' && row.startTime && !row.endTime);
    if (activeIdx !== -1) {
      const active = workProgress[activeIdx];
      workProgress[activeIdx] = { ...active, endTime: startTime, status: 'stopped', duration: computeWorkRowDuration({ ...active, endTime: startTime }) };
    }

    workProgress.push({ type: 'task', taskDetails, startTime, endTime: null, status: 'work_in_progress', remarks: '', feedback: '', duration: null });

    await Attendance.updateOne(
      { _id: record._id },
      { $set: { workProgress } }
    );

    return ok({ added: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
