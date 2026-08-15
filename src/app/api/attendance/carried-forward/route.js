import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getTzTime } from '@/lib/timezone';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const now = await getTzTime();
    now.setDate(now.getDate() - 14);
    const startStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    const records = await Attendance.find({ userId: user._id, date: { $gte: startStr } })
      .select('date workProgress')
      .sort({ date: -1 })
      .lean();

    const carriedSeen = new Set();
    const latestState = new Map();
    (records || []).forEach(rec => {
      [...(rec.workProgress || [])].reverse().forEach(row => {
        if (row.type !== 'task' || !row.taskDetails) return;
        const title = String(row.taskDetails).trim();
        if (!title) return;
        if (row.carriedForward) carriedSeen.add(title);
        if (!latestState.has(title)) {
          latestState.set(title, { status: row.status, carriedForward: !!row.carriedForward });
        }
      });
    });

    const titles = [...carriedSeen].filter(title => {
      const latest = latestState.get(title);
      return !(latest?.status === 'completed' && !latest.carriedForward);
    });

    return ok(titles);
  } catch (e) {
    return fail(e.message, 500);
  }
}
