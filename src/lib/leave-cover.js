import Leave from '@/lib/models/Leave';

/**
 * Single source of truth for the "leave wins" rule:
 * an approved FULL-DAY leave covering `date` means the day counts as leave,
 * no matter what any attendance writer sees (clock-in/out, regularization
 * approval, permission mirror, sync, payroll).
 *
 * Every writer that assigns Attendance.status must consult this helper
 * before flipping a row away from `leave`. Half-day leaves are excluded —
 * they have their own 0.5 + 0.5 handling via `approvedHalfDayLeave`.
 *
 * @param {ObjectId|string} userId - leave applicant
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<Object|null>} the covering approved full-day leave, or null
 */
export async function getFullDayLeaveCover(userId, date) {
  if (!userId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const cover = await Leave.findOne({
    userId,
    status: 'approved',
    halfDay: { $ne: true },
    from: { $lte: date },
    to: { $gte: date },
  }).select('_id userId type typeCode from to halfDay').lean();
  return cover || null;
}

/**
 * Boolean convenience wrapper around getFullDayLeaveCover.
 */
export async function isFullDayLeaveCovered(userId, date) {
  return !!(await getFullDayLeaveCover(userId, date));
}
