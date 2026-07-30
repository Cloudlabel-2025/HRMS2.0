import { connectDB } from '@/lib/db';
import { Goal } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

function currentCycle(date = new Date()) {
  return `C${Math.floor(date.getMonth() / 3) + 1}${date.getFullYear()}`;
}

function latestFriday(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - ((value.getDay() + 2) % 7));
  return value.toISOString().slice(0, 10);
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const weekEnding = latestFriday();
    const hasClockedOut = await Attendance.exists({ userId: user._id, date: weekEnding, clockOut: { $ne: null } });
    if (!hasClockedOut) return ok({ weekEnding, goals: [] });
    const goals = await Goal.find({ userId: user._id, cycle: currentCycle(), status: 'in_progress', approvalStatus: 'approved', 'weeklyUpdates.weekEnding': { $ne: weekEnding } }).select('title progress cycle');
    return ok({ weekEnding, goals });
  } catch (e) { return fail(e.message, 500); }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { goalId, progress, remark } = await req.json();
    const weekEnding = latestFriday();
    if (!remark?.trim()) return fail('Please describe the work completed this week');
    if (!Number.isFinite(Number(progress)) || Number(progress) < 0 || Number(progress) > 100) return fail('Progress must be between 0 and 100');
    const goal = await Goal.findOne({ _id: goalId, userId: user._id, cycle: currentCycle(), status: 'in_progress', approvalStatus: 'approved', 'weeklyUpdates.weekEnding': { $ne: weekEnding } });
    if (!goal) return fail('This goal is not available for a weekly update', 404);
    goal.progress = Number(progress);
    goal.weeklyUpdates.push({ weekEnding, progress: Number(progress), remark: remark.trim() });
    if (goal.progress === 100) goal.status = 'achieved';
    await goal.save();
    return ok({ goal });
  } catch (e) { return fail(e.message, 500); }
}
