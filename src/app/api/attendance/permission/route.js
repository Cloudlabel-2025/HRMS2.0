import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getShiftAwareToday } from '@/lib/shift-today';
import { getTzTime } from '@/lib/timezone';
import { closePermissionEarly, reconcilePermissionWorkProgress } from '@/lib/permission-work';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const body = await req.json();
    const endTime = body.endTime;
    if (!endTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) return fail('Valid endTime HH:MM is required', 400);

    let today = await getShiftAwareToday(user._id);
    if (!today) {
      const now = await getTzTime();
      today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    }
    let record = await Attendance.findOne({ userId: user._id, date: today });
    if (!record) return fail('No attendance record for today. Clock in first.', 400);

    const fresh = record.toObject ? record.toObject() : { ...record };
    fresh.permission = fresh.permission || {};
    const result = closePermissionEarly(fresh, endTime);
    if (result.error && !result.already) return fail(result.error, 400);
    if (result.already) {
      const latest = await Attendance.findOne({ userId: user._id, date: today });
      return ok({ record: latest, alreadyEnded: true });
    }

    await Attendance.collection.updateOne(
      { _id: record._id },
      { $set: { workProgress: fresh.workProgress, permission: fresh.permission } }
    );

    // Allowance settlement: only the requested time is ever deducted.
    if (result.touchedRequest && fresh.permission?.requestId) {
      const { SelfServiceRequest } = await import('@/lib/models/index');
      await SelfServiceRequest.updateOne(
        { _id: fresh.permission.requestId },
        { $set: { 'payload.usedDuration': result.usedDuration, 'payload.refundedMins': result.refundedDuration } }
      ).catch(() => {});
    }

    record = await Attendance.findOne({ userId: user._id, date: today });
    if (!record) return fail('Failed to persist permission end', 500);

    const now = await getTzTime();
    const nowStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const reconObj = record.toObject ? record.toObject() : { ...record, workProgress: [...record.workProgress], permission: { ...record.permission } };
    if (reconcilePermissionWorkProgress(reconObj, nowStr)) {
      await Attendance.collection.updateOne(
        { _id: record._id },
        { $set: { workProgress: reconObj.workProgress, permission: reconObj.permission } }
      );
      record = await Attendance.findOne({ userId: user._id, date: today });
    }

    // A late end marks the day Late immediately (the GET recompute is the
    // backstop on subsequent reads). An overrun also drives shortHours
    // (informational, never LOP).
    if (result.endedLate && record && !['leave', 'holiday'].includes(record.status)) {
      await Attendance.collection.updateOne(
        { _id: record._id },
{ $set: { status: 'late', lateFlag: true, shortHours: false, shortfallMins: 0, breakExcessMins: 0 } }
      );
      record = await Attendance.findOne({ userId: user._id, date: today });
    }

    return ok({ record, endedLate: !!result.endedLate, overrunMins: result.overrunMins || 0 });
  } catch (e) {
    return fail(e.message, 500);
  }
}
