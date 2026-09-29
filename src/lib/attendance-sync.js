import { Holiday, Leave } from './models/index';
import mongoose from 'mongoose';
import User from './models/User';
import Attendance from './models/Attendance';
import { isWorkingDay } from './payroll-cycle';
import { isWorkedDay } from './attendance-stats';

// UTC day part of a Date (join-guard errs toward inclusion).
function fmtDay(d) {
  const n = d instanceof Date ? d : new Date(d);
  return n.getUTCFullYear() + '-' + String(n.getUTCMonth() + 1).padStart(2, '0') + '-' + String(n.getUTCDate()).padStart(2, '0');
}

function eachDateStr(fromDate, toDate) {  const out = [];
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

/**
 * Classify one calendar date against the working-day calendar.
 * The calendar (Holiday docs + Sunday + Saturday policy) is authoritative:
 * every date is exactly one of 'working' | 'holiday' | 'weekly_off'.
 */
export function classifyCalendarDate(dateStr, config = {}, holidaySet = new Set()) {
  if (holidaySet.has(dateStr)) return 'holiday';
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() === 0) return 'weekly_off';
  // Saturday policy lives in isWorkingDay; pass no holidays since the
  // explicit Holiday check above already ran.
  if (!isWorkingDay(dateStr, config, [])) return 'weekly_off';
  return 'working';
}

export async function getHolidaySet(fromDate, toDate) {
  const docs = await Holiday.find({ date: { $gte: fromDate, $lte: toDate } })
    .select('date')
    .lean()
    .catch(() => []);
  return new Set((docs || []).map(h => h.date));
}

/**
 * Materialise the attendance register for one employee over a date range.
 *
 * Every elapsed calendar date ends with exactly one Attendance row:
 *  - non-working date            -> { status: 'holiday', nonWorkingDayType }
 *  - working date, no record     -> { status: 'absent', absentSource: 'system' }
 *  - working date, approved leave-> { status: 'leave' | 'half_day' }
 *  - any date with a clock-in    -> never touched (except relabelling a stale
 *                                   non-working flag left by a deleted holiday)
 *  - stale label with no work and no covering leave (phantom 'present' from
 *    the old permission mirror, orphaned leave, deleted-holiday residue)
 *    -> corrected to 'absent' (explicit admin overrides are never touched)
 *
 * Future dates are never written. Existing rows with clockIn/importedPresence
 * are never overwritten, so this is safe to run from payroll, cron, scripts
 * and the read path of the attendance report.
 *
 * @returns {{ inserted, updated, skipped }}
 */
export async function syncEmployeeCalendarRows({
  userId,
  fromDate,
  toDate,
  config = {},
  holidays = [],
  todayStr = null,
  allowTodayAbsent = false,
  leaves = null,
  now = null,
}) {
  return syncCalendarRowsForUsers({
    userIds: [userId],
    fromDate,
    toDate,
    config,
    holidays,
    todayStr,
    allowTodayAbsent,
    leavesByUser: leaves ? { [String(userId?._id || userId)]: leaves } : null,
    now,
  });
}

/**
 * Batched variant: one Attendance.find + one Leave.find + one bulkWrite for
 * the whole roster. Used by the attendance report read path, the daily sweep
 * and payroll backfills.
 */
export async function syncCalendarRowsForUsers({
  userIds,
  fromDate,
  toDate,
  config = {},
  holidays = [],
  todayStr = null,
  allowTodayAbsent = false,
  leavesByUser = null,
  now = null,
}) {
  const uids = [...new Set((userIds || []).map(u => String(u?._id || u)).filter(Boolean))];
  const today =
    todayStr ||
    (() => {
      const n = new Date();
      return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    })();
  const holidaySet = new Set((holidays || []).map(h => (typeof h === 'string' ? h : h.date)));
  const dates = eachDateStr(fromDate, toDate).filter(d => d <= today);
  if (!dates.length || !uids.length) return { inserted: 0, updated: 0, skipped: 0 };

  const [rows, approvedLeaves] = await Promise.all([
    Attendance.find({ userId: { $in: uids }, date: { $gte: fromDate, $lte: toDate } })
      .select('userId date clockIn status importedPresence nonWorkingDayType leaveOverride approvedHalfDayLeave relatedLeaveId')
      .lean(),
    leavesByUser ??
      Leave.find({ userId: { $in: uids }, status: 'approved', from: { $lte: toDate }, to: { $gte: fromDate } })
        .select('userId type typeCode from to halfDay')
        .lean()
        .catch(() => []),
  ]);

  // Group rows by user.
  const rowsByUser = new Map();
  for (const r of rows || []) {
    const k = String(r.userId);
    if (!rowsByUser.has(k)) rowsByUser.set(k, []);
    rowsByUser.get(k).push(r);
  }
  // Group leaves by user. Callers may pass { uid: leaves[] } (single-user
  // path) or leave the DB query above to supply a flat array.
  const leavesGrouped = new Map();
  if (leavesByUser && !Array.isArray(leavesByUser)) {
    for (const [k, v] of Object.entries(leavesByUser)) leavesGrouped.set(String(k), v || []);
  } else {
    for (const l of approvedLeaves || []) {
      const k = String(l.userId);
      if (!leavesGrouped.has(k)) leavesGrouped.set(k, []);
      leavesGrouped.get(k).push(l);
    }
  }

  // Employment-start guard: never materialise rows before the employee
  // existed, so pre-joining dates can never become phantom absences.
  // startDate = earliest of (account creation, first clock-in, first leave).
  const startByUser = new Map();
  try {
    const objectIds = uids.map(id => {
      try { return new mongoose.Types.ObjectId(id); } catch { return null; }
    }).filter(Boolean);
    const [users, firstClocks, firstLeaves] = await Promise.all([
      User.find({ _id: { $in: uids } }).select('createdAt').lean().catch(() => []),
      objectIds.length
        ? Attendance.aggregate([
            { $match: { userId: { $in: objectIds }, clockIn: { $ne: null } } },
            { $group: { _id: '$userId', first: { $min: '$date' } } },
          ]).catch(() => [])
        : [],
      Leave.aggregate([
        { $match: { userId: { $in: uids }, status: 'approved' } },
        { $group: { _id: '$userId', first: { $min: '$from' } } },
      ]).catch(() => []),
    ]);
    const firstClockByUser = new Map((firstClocks || []).map(r => [String(r._id), r.first]));
    const firstLeaveByUser = new Map((firstLeaves || []).map(r => [String(r._id), r.first]));
    for (const u of users || []) {
      const k = String(u._id);
      const candidates = [
        u.createdAt ? fmtDay(u.createdAt) : null,
        firstClockByUser.get(k) || null,
        firstLeaveByUser.get(k) || null,
      ].filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
      if (candidates.length) startByUser.set(k, candidates.sort()[0]);
    }
  } catch { /* guard is best-effort; missing start date = no restriction */ }

  const ops = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const stamp = now || new Date();
  const pushUpsert = (uid, date, set) => {
    ops.push({
      updateOne: {
        filter: { userId: uid, date },
        update: { $set: set, $setOnInsert: { userId: uid, date } },
        upsert: true,
      },
    });
  };

  for (const uid of uids) {
    const byDate = new Map(((rowsByUser.get(uid)) || []).map(r => [r.date, r]));
    const startDate = startByUser.get(uid) || null;

    // Approved-leave coverage for this user: date -> leave doc (first wins).
    const leaveByDate = new Map();
    for (const l of leavesGrouped.get(uid) || []) {
      const s = l.from < fromDate ? fromDate : l.from;
      const e = l.to > toDate ? toDate : l.to;
      for (const d of eachDateStr(s, e)) {
        if (!leaveByDate.has(d)) leaveByDate.set(d, l);
      }
    }

    for (const d of dates) {
      // Pre-joining dates are never materialised — no phantom absences.
      if (startDate && d < startDate) { skipped++; continue; }
      const kind = classifyCalendarDate(d, config, holidaySet);
      const ex = byDate.get(d);
      // Source-aware: the schema materialises an empty importedPresence
      // object (all nulls) on every row, which is truthy — only a real
      // source counts as work.
      const hasWork = isWorkedDay(ex);
      const lv = leaveByDate.get(d);

      if (kind !== 'working') {
        const nwd = kind === 'holiday' ? 'holiday' : 'weekly_off';
        if (!ex) {
          pushUpsert(uid, d, { status: 'holiday', nonWorkingDayType: nwd });
          inserted++;
        } else if (hasWork) {
          // Worked the off day: keep the clock-in, label the day truthfully.
          if (ex.status !== 'holiday' || ex.nonWorkingDayType !== nwd) {
            pushUpsert(uid, d, { status: 'holiday', nonWorkingDayType: nwd });
            updated++;
          } else skipped++;
        } else if (ex.status === 'absent' || (ex.status === 'holiday' && ex.nonWorkingDayType !== nwd)) {
          // Holiday added after the fact (or type corrected): relabel.
          pushUpsert(uid, d, { status: 'holiday', nonWorkingDayType: nwd, absentMarkedAt: null, absentSource: null });
          updated++;
        } else skipped++; // leave rows and correct holiday rows stay untouched
        continue;
      }

      // ── Working day ──
      if (hasWork) {
        // Stale non-working label on a real working day (holiday doc deleted
        // later, or approved-then-cancelled leave): reset to a neutral present.
        // Late is recomputed on read paths from the frozen shift snapshot.
        if (
          ex.status === 'holiday' ||
          (ex.status === 'leave' && !lv && ex.leaveOverride?.status !== 'rejected')
        ) {
          pushUpsert(uid, d, { status: 'present', nonWorkingDayType: 'none', lateFlag: false });
          updated++;
        } else skipped++;
        continue;
      }
      if (lv) {
        const want = lv.halfDay ? 'half_day' : 'leave';
        if (!ex) {
          pushUpsert(uid, d, {
            status: want,
            relatedLeaveId: lv._id,
            approvedHalfDayLeave: !!lv.halfDay,
            nonWorkingDayType: 'none',
          });
          inserted++;
        } else if (ex.status === 'absent' || ex.status === 'holiday') {
          pushUpsert(uid, d, {
            status: want,
            relatedLeaveId: lv._id,
            approvedHalfDayLeave: !!lv.halfDay,
            nonWorkingDayType: 'none',
            absentMarkedAt: null,
            absentSource: null,
          });
          updated++;
        } else skipped++;
        continue;
      }
    // No work, no leave -> absent.
    if (d === today && !allowTodayAbsent) {
      skipped++; // still "not arrived" territory; the sweep/cron owns today
      continue;
    }
    if (!ex) {
      pushUpsert(uid, d, {
        status: 'absent',
        absenceReason: 'No clock-in',
        nonWorkingDayType: 'none',
        absentMarkedAt: stamp,
        absentSource: 'system',
      });
      inserted++;
    } else if (ex.status === 'absent') {
      skipped++; // already absent — nothing to do
    } else if (ex.leaveOverride?.status === 'approved' || ex.leaveOverride?.status === 'rejected') {
      skipped++; // explicit admin override decision stands, even without a clock-in
    } else {
      // Stale label with no work and no covering leave: phantom 'present'
      // from the old permission mirror, orphaned leave after cancellation,
      // or deleted-holiday residue. Correct to absent; the permission
      // subdoc (if any) is kept for context.
      pushUpsert(uid, d, {
        status: 'absent',
        absenceReason: 'No clock-in',
        nonWorkingDayType: 'none',
        absentMarkedAt: stamp,
        absentSource: 'system',
      });
      updated++;
    }
    }
  }

  if (ops.length) await Attendance.bulkWrite(ops, { ordered: false });
  return { inserted, updated, skipped };
}
