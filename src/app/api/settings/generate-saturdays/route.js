import { connectDB } from '@/lib/db';
import { Holiday } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getPayrollDayNumber, countSaturdaysFromCycleStart } from '@/lib/saturday-cycle';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);

    const { year } = await req.json();
    const targetYear = year || new Date().getFullYear();

    const config = await getGlobalConfig();
    if (String(config.saturdayWorking || 'alternate').toLowerCase() !== 'alternate') {
      return fail('Set Saturday working to Alternate Saturdays in General config first', 400);
    }

    await connectDB();

    // Cycle-aware: 1st & 3rd Saturdays counted from each date's owning
    // payroll cycle start (follows Settings → payrollStartDay). This matches
    // the calendar highlight and payroll isWorkingDay exactly.
    const startDay = getPayrollDayNumber(config.payrollStartDay, 26);
    let count = 0;
    const from = new Date(targetYear, 0, 1);
    const to = new Date(targetYear, 11, 31);
    for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
      if (dt.getDay() !== 6) continue;
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const satCount = countSaturdaysFromCycleStart(dateStr, startDay);
      if (satCount === 1 || satCount === 3) {
        const name = satCount === 1 ? 'First Saturday' : 'Third Saturday';
        const res = await Holiday.findOneAndUpdate(
          { date: dateStr },
          { $setOnInsert: { date: dateStr, name, type: 'Company' } },
          { upsert: true, rawResult: true }
        );
        if (!res?.lastErrorObject?.updatedExisting) count++;
      }
    }

    return ok({ generated: count, year: targetYear, payrollStartDay: startDay });
  } catch (e) {
    return fail(e.message, 500);
  }
}
