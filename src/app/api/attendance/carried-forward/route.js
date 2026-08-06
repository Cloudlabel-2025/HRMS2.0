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

    const titles = [];
    const seen = new Set();
    (records || []).forEach(rec => {
      (rec.workProgress || []).forEach(row => {
        if (row.carriedForward && row.type === 'task' && row.taskDetails) {
          const t = String(row.taskDetails).trim();
          if (t && !seen.has(t)) {
            seen.add(t);
            titles.push(t);
          }
        }
      });
    });

    return ok(titles);
  } catch (e) {
    return fail(e.message, 500);
  }
}
