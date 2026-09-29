import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
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
        `Swept ${months.join(', ')} for ${users.length} employee(s): ${inserted} inserted, ${updated} updated.`,
        'low', req.headers.get('x-forwarded-for') || '', null, null
      );
    } catch { /* non-fatal */ }

    return ok({ swept, employees: users.length, months, inserted, updated, today: todayStr });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function GET(req) {
  return POST(req);
}
