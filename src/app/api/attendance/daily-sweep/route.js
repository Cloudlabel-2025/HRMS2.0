import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, getPayrollDay, getCycleRange } from '@/lib/payroll-cycle';
import { getHolidaySet, syncEmployeeCalendarRows } from '@/lib/attendance-sync';
import { getTzTime } from '@/lib/timezone';

function prevMonthStr(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Daily calendar sweep: materialise the attendance register (absent + holiday
 * + leave rows) for every active employee over the current and previous
 * payroll cycles. Runs end-of-day via Vercel cron so the register — and any
 * payroll run — always counts stored rows, never an inferred gap.
 */
export async function POST(req) {
  try {
    // Auth: super_admin JWT or CRON_SECRET header (Vercel cron).
    const cronSecret = req.headers.get('x-cron-secret');
    const envCronSecret = process.env.CRON_SECRET;
    let actorId = null;
    if (cronSecret !== envCronSecret) {
      const { user, error } = await requireAuth(req);
      if (error) return error;
      if (user.role !== 'super_admin') {
        return fail('Access denied. super_admin role or valid CRON_SECRET required.', 403);
      }
      actorId = user._id;
    }

    await connectDB();

    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const now = await getTzTime();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const thisMonth = body.month && /^\d{4}-\d{2}$/.test(body.month) ? body.month : todayStr.slice(0, 7);
    // Sweep the current cycle (elapsed dates only) plus the previous cycle
    // (complete — catches any rows the run-day sync missed).
    const months = [prevMonthStr(thisMonth), thisMonth];

    const config = await getGlobalConfig();
    const startDay = getPayrollDay(config.payrollStartDay, 26);
    const endDay = getPayrollDay(config.payrollEndDay, 25);

    const users = await User.find({ status: 'active', role: { $ne: 'super_admin' } })
      .select('_id')
      .lean();

    let inserted = 0;
    let updated = 0;
    let swept = 0;
    let permsClosed = 0;

    // Auto-close forgotten permissions on past dates. An open permission
    // whose day is over is settled with endedBy 'sweep_overdue': the
    // requested time stays as permission time, the excess becomes overrun
    // (Late + Short Hours), and the allowance is capped at the grant.
    // Today's mid-window permissions are never touched — the employee may
    // still end them.
    try {
      const { settlePermissionOverrun } = await import('@/lib/permission-work');
      const { getShiftEndMinutes } = await import('@/lib/shift-utils');
      const { SelfServiceRequest } = await import('@/lib/models/index');
      const stale = await Attendance.find({
        date: { $lt: todayStr },
        clockIn: { $ne: null },
        'permission.requestId': { $ne: null },
        'permission.endedAt': null,
      }).lean();
      for (const rec of stale) {
        try {
          const draft = {
            ...rec,
            workProgress: (rec.workProgress || []).map(r => ({ ...r })),
            permission: { ...(rec.permission || {}) },
          };
          // Open session that was never closed: assume the shift end.
          let endTimeStr = null;
          if (!rec.clockOut && rec.shiftStartTime && rec.shiftEndTime) {
            const endM = getShiftEndMinutes({ startTime: rec.shiftStartTime, endTime: rec.shiftEndTime });
            const wall = ((endM % 1440) + 1440) % 1440;
            endTimeStr = `${String(Math.floor(wall / 60)).padStart(2, '0')}:${String(wall % 60).padStart(2, '0')}`;
          }
          const res = settlePermissionOverrun(draft, { endedBy: 'sweep_overdue', endTimeStr });
          if (res.error || res.already) continue;
          const set = { workProgress: draft.workProgress, permission: draft.permission };
          if (res.endedLate) {
            set.status = 'late';
            set.lateFlag = true;
            set.shortHours = (Number(res.overrunMins) || 0) > 0;
          }
          await Attendance.updateOne({ _id: rec._id }, { $set: set });
          if (res.touchedRequest && draft.permission?.requestId) {
            await SelfServiceRequest.updateOne(
              { _id: draft.permission.requestId },
              { $set: { 'payload.usedDuration': res.usedDuration, 'payload.refundedMins': res.refundedDuration } }
            ).catch(() => {});
          }
          permsClosed++;
        } catch (e) { console.error(`sweep permission settle failed for ${rec._id}:`, e?.message || e); }
      }
    } catch (e) { console.error('sweep permission settle pass failed:', e?.message || e); }

    for (const month of months) {
      const [y, m] = month.split('-').map(Number);
      const { fromDate, toDate } = getCycleRange(startDay, endDay, y, m - 1);
      const holidays = await getHolidaySet(fromDate, toDate);
      // The sweep runs end-of-day, so today may be marked absent; a previous
      // (completed) cycle is always fully materialised.
      const allowTodayAbsent = toDate <= todayStr;
      for (const u of users) {
        try {
          const r = await syncEmployeeCalendarRows({
            userId: u._id,
            fromDate,
            toDate,
            config,
            holidays: [...holidays],
            todayStr,
            allowTodayAbsent,
            now,
          });
          inserted += r.inserted;
          updated += r.updated;
          swept++;
        } catch (e) {
          console.error(`daily-sweep failed for ${u._id} ${month}:`, e?.message || e);
        }
      }
    }

    try {
      const { auditLog } = await import('@/lib/middleware');
      await auditLog(
        'Attendance Daily Sweep', 'Attendance', actorId,
        `Swept ${months.join(', ')} for ${users.length} employee(s): ${inserted} inserted, ${updated} updated, ${permsClosed} overdue permission(s) closed.`,
        'low', req.headers.get('x-forwarded-for') || '', null, null
      );
    } catch { /* non-fatal */ }

    return ok({ swept, employees: users.length, months, inserted, updated, permsClosed, today: todayStr });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function GET(req) {
  return POST(req);
}
