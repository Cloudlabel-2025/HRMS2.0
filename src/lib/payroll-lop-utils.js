import mongoose from 'mongoose';
import User from './models/User';
import Attendance from './models/Attendance';
import { Holiday, Leave } from './models/index';
import { isWorkingDay } from './payroll-cycle';

// UTC day part of a Date (join-guard errs toward inclusion — same as sync).
function fmtDayUTC(d) {
  const n = d instanceof Date ? d : new Date(d);
  return n.getUTCFullYear() + '-' + String(n.getUTCMonth() + 1).padStart(2, '0') + '-' + String(n.getUTCDate()).padStart(2, '0');
}

export function eachDateStr(fromDate, toDate) {
  const out = [];
  if (!fromDate || !toDate || fromDate > toDate) return out;
  for (
    let c = new Date(`${fromDate}T00:00:00`), e = new Date(`${toDate}T00:00:00`);
    c <= e;
    c.setDate(c.getDate() + 1)
  ) {
    out.push(
      c.getFullYear() + '-' + String(c.getMonth() + 1).padStart(2, '0') + '-' + String(c.getDate()).padStart(2, '0')
    );
  }
  return out;
}

/** A leave is unpaid ONLY when its own type is explicitly unpaid (Loss of Pay). */
export function isUnpaidLeaveDoc(leave) {
  if (!leave) return false;
  return leave.typeCode === 'LOP' || leave.type === 'Loss of Pay' || leave.isPaid === false;
}

/**
 * Employment-start guard: earliest of (account creation, first clock-in,
 * first approved leave). Mirrors attendance-sync so pre-joining dates can
 * never become phantom absences / LOP in payroll counts.
 *
 * @returns {string|null} 'YYYY-MM-DD' or null when unknown (no restriction).
 */
export async function getEmploymentStartDate(userId) {
  try {
    const uid = String(userId?._id || userId);
    let objectId = null;
    try { objectId = new mongoose.Types.ObjectId(uid); } catch { objectId = null; }
    const [userDoc, firstClocks, firstLeaves] = await Promise.all([
      User.findById(objectId || uid).select('createdAt').lean().catch(() => null),
      objectId
        ? Attendance.aggregate([
            { $match: { userId: objectId, clockIn: { $ne: null } } },
            { $group: { _id: null, first: { $min: '$date' } } },
          ]).catch(() => [])
        : [],
      Leave.aggregate([
          { $match: { userId: uid, status: 'approved' } },
          { $group: { _id: null, first: { $min: '$from' } } },
        ]).catch(() => []),
    ]);
    const candidates = [
      userDoc?.createdAt ? fmtDayUTC(userDoc.createdAt) : null,
      firstClocks?.[0]?.first || null,
      firstLeaves?.[0]?.first || null,
    ].filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!candidates.length) return null;
    return candidates.sort()[0];
  } catch {
    return null; // guard is best-effort; unknown start = no restriction
  }
}

/**
 * Working-day count of a leave's UNPAID portion on the payroll calendar.
 * This is what the in-cycle payroll loop would have counted had the leave
 * fallen inside the cycle — so retro deductions use the same denominator as
 * in-cycle LOP instead of the stored span days (which may include
 * weekends/holidays per leave-policy flags, or legacy bulk values).
 *
 * Mirrors the engine's leave loop exactly: per working date credit
 * (0.5 half-day / 1.0, or 1.0 when countHalfDay is false), skipped when the
 * day was worked (except half-day splits), plus the 0.5 remainder for an
 * unpaid half-day leave on a day never clocked in.
 *
 * @returns {number} unpaid working days rounded to 2dp.
 */
export async function countUnpaidWorkingDays(leave, config = {}, lopConfig = {}) {
  try {
    if (!leave || !isUnpaidLeaveDoc(leave)) return 0;
    if (!leave.from || !leave.to || leave.from > leave.to) return 0;
    const [holidays, clocked] = await Promise.all([
      Holiday.find({ date: { $gte: leave.from, $lte: leave.to } }).lean().catch(() => []),
      Attendance.find({ userId: leave.userId, date: { $gte: leave.from, $lte: leave.to }, clockIn: { $ne: null } })
        .select('date')
        .lean()
        .catch(() => []),
    ]);
    const clockedDates = new Set((clocked || []).map((r) => r.date));
    const halfDayCountsAsFull = leave.halfDay && lopConfig.countHalfDay === false;
    let unpaid = 0;
    for (const d of eachDateStr(leave.from, leave.to)) {
      if (!isWorkingDay(d, config, holidays || [])) continue;
      const workedThatDay = clockedDates.has(d);
      if (workedThatDay && !leave.halfDay) continue;
      const credit = leave.halfDay && !halfDayCountsAsFull ? 0.5 : 1;
      unpaid += credit;
      // Unpaid half-day leave on a day never clocked in: the remaining half
      // of the working day is neither worked nor covered — LOP remainder.
      if (leave.halfDay && !workedThatDay && !halfDayCountsAsFull) unpaid += 0.5;
    }
    return Math.round(unpaid * 100) / 100;
  } catch {
    return 0;
  }
}
