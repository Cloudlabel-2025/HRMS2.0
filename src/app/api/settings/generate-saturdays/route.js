import { connectDB } from '@/lib/db';
import { Holiday } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getPayrollDayNumber, countSaturdaysFromCycleStart, isSaturdayOff, getSaturdayPattern } from '@/lib/saturday-cycle';

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];

function cycleOrdinal(dateStr, startDay) {
  const n = countSaturdaysFromCycleStart(dateStr, startDay);
  return n >= 1 && n <= 5 ? ORDINALS[n - 1] : `#${n}`;
}

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
    const pattern = getSaturdayPattern(config);

    await connectDB();

    // Continuous alternation via the shared helper (same rule the calendar
    // highlights and payroll isWorkingDay enforces). Never resets at a
    // cycle boundary, so a 5-Saturday cycle is L W L W L / W L W L W.
    // 'legacy' reproduces the old per-cycle 1st & 3rd rule verbatim.
    const startDay = getPayrollDayNumber(config.payrollStartDay, 26);
    let count = 0;
    const from = new Date(targetYear, 0, 1);
    const to = new Date(targetYear, 11, 31);
    for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
      if (dt.getDay() !== 6) continue;
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      if (!isSaturdayOff(dateStr, config)) continue;
      const name = `Saturday Holiday (${cycleOrdinal(dateStr, startDay)} of cycle)`;
      const res = await Holiday.findOneAndUpdate(
        { date: dateStr },
        { $setOnInsert: { date: dateStr, name, type: 'Company', source: 'saturday_alternate' } },
        // includeResultMetadata (Mongoose 7+; rawResult was removed) so the
        // generated count only includes newly inserted rows.
        { upsert: true, includeResultMetadata: true }
      );
      if (!res?.lastErrorObject?.updatedExisting) count++;
    }

    return ok({ generated: count, year: targetYear, pattern, payrollStartDay: startDay });
  } catch (e) {
    return fail(e.message, 500);
  }
}
