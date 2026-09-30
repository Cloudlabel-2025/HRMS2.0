import dbConnect from '@/lib/db';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getPermissionBalance } from '@/lib/permission-allowance';
import { addDaysStr, MAX_PERMISSION_ADVANCE_DAYS, DATE_RE } from '@/lib/permission-window';
import { getShiftDayInfo } from '@/lib/shift-today';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await dbConnect();
    const { searchParams } = new URL(req.url);
    // Bookable window shared with the request validator: earliest date is
    // the earlier of calendar/shift-aware today, latest is +30 days.
    // Shift times are returned so the UI can anchor overnight windows.
    const dayInfo = await getShiftDayInfo(user._id);
    const { minDate } = dayInfo;
    const maxDate = addDaysStr(minDate, MAX_PERMISSION_ADVANCE_DAYS);
    const date = searchParams.get('date') || dayInfo.calToday;
    const identityId = user.identityId;
    if (!identityId) return fail('Identity link not found', 404);
    const identity = await UsrIdentity.findById(identityId);
    if (!identity) return fail('Identity not found', 404);
    const profile = await EmpProfile.findOne({ identityId: identity._id });
    if (!profile) return fail('Employment profile not found', 404);
    if (!DATE_RE.test(String(date)) || String(date) < minDate || String(date) > maxDate) {
      return fail('Permission date is outside the bookable window', 400);
    }
    const config = await getGlobalConfig();
    const balance = await getPermissionBalance(profile._id, date, config);
    return ok({ balance, minDate, maxDate, shiftStart: dayInfo.shiftStart, shiftEnd: dayInfo.shiftEnd });
  } catch (e) {
    return fail(e.message, 500);
  }
}
