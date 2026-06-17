import { connectDB } from '@/lib/db';
import { Holiday } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, getSaturdayOrdinal } from '@/lib/payroll-cycle';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);

    const { year } = await req.json();
    const targetYear = year || new Date().getFullYear();

    const config = await getGlobalConfig();
    if (config.saturdayWorking !== 'alternate') {
      return fail('Set Saturday working to Alternate (2nd & 4th working) in General config first', 400);
    }

    await connectDB();

    let count = 0;
    for (let month = 0; month < 12; month++) {
      const daysInMonth = new Date(targetYear, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(targetYear, month, day);
        if (d.getDay() !== 6) continue;
        const ordinal = getSaturdayOrdinal(targetYear, month, day);
        if (ordinal === 1 || ordinal === 3) {
          const dateStr = `${targetYear}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const name = ordinal === 1 ? 'First Saturday' : 'Third Saturday';
          await Holiday.findOneAndUpdate(
            { date: dateStr },
            { $setOnInsert: { date: dateStr, name, type: 'Company' } },
            { upsert: true }
          );
          count++;
        }
      }
    }

    return ok({ generated: count, year: targetYear });
  } catch (e) {
    return fail(e.message, 500);
  }
}
