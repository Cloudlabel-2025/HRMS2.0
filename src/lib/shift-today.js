import User from './models/User';
import { resolveShift } from './shift-utils';
import { getAttendanceDate } from './attendance-date';
import { getTzTime, formatDateStr } from './timezone';

/**
 * SERVER-ONLY helper: resolve a user's shift-aware attendance "today".
 * Previously duplicated verbatim in api/attendance/route.js and
 * api/attendance/permission/route.js. Lives here (not in attendance-date.js)
 * because this module imports mongoose models and must never be bundled
 * into a client component.
 *
 * @param {string|ObjectId} userId
 * @returns {Promise<string|null>} "YYYY-MM-DD" or null when unresolvable
 */
export async function getShiftAwareToday(userId) {
  const info = await getShiftDayInfo(userId);
  return info.shiftToday;
}

/**
 * SERVER-ONLY: full day context for permission booking rules — calendar
 * today, shift-aware today, the bookable floor (earlier of the two) and
 * the shift window used for overnight time anchoring.
 */
export async function getShiftDayInfo(userId) {
  const now = await getTzTime();
  const calToday = formatDateStr(now);
  let shiftToday = null;
  let shiftStart = null;
  let shiftEnd = null;
  try {
    const u = await User.findById(userId).select('shift shiftId').lean();
    if (u) {
      const shiftDoc = await resolveShift(u);
      shiftStart = shiftDoc?.startTime || null;
      shiftEnd = shiftDoc?.endTime || null;
      shiftToday = getAttendanceDate(now, shiftStart, shiftEnd);
    }
  } catch { /* fall through with calendar today */ }
  const minDate = shiftToday && shiftToday < calToday ? shiftToday : calToday;
  return { now, calToday, shiftToday, minDate, shiftStart, shiftEnd };
}
