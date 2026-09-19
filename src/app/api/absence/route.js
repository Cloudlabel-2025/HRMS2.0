import { connectDB } from '@/lib/db';
import { Absence, Employee, Leave, Holiday, Shift, SelfServiceRequest } from '@/lib/models/index';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getDepartmentUserIds, getAccessibleDepartments } from '@/lib/rbac';
import { getGlobalConfig, isWorkingDay } from '@/lib/payroll-cycle';
import { getTzTime } from '@/lib/timezone';
import { deriveAbsenceKind } from '@/lib/absence-status';

function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

function eachDate(from, to) {
  const out = [];
  for (let c = new Date(`${from}T00:00:00`), e = new Date(`${to}T00:00:00`); c <= e; c.setDate(c.getDate() + 1)) {
    out.push(
      c.getFullYear() + '-' + String(c.getMonth() + 1).padStart(2, '0') + '-' + String(c.getDate()).padStart(2, '0')
    );
  }
  return out;
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const now = await getTzTime();
    const calToday = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const month = searchParams.get('month') || calToday.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return fail('Invalid month format (YYYY-MM)', 400);
    const from = `${month}-01`;
    const to = lastDayOfMonth(month);

    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
    const isManager = ['team_lead', 'team_admin'].includes(user.role);
    const allowedIds = isAdmin ? null : isManager ? await getDepartmentUserIds(user) : [user._id];
    const allowedIdSet = allowedIds ? new Set(allowedIds.map(String)) : null;

    // ── Roster: Employee primary + User fallback (mirrors /api/employees) ──
    let employees = await Employee.find({ status: 'active' })
      .populate({ path: 'userId', match: { status: 'active', role: { $ne: 'super_admin' } }, select: '_id name role shift shiftId identityId profileId department' })
      .select('userId name department designation shift shiftId')
      .lean();
    let roster = employees.filter((e) => e.userId).map((e) => ({
      uid: String(e.userId._id),
      name: e.name || e.userId?.name || '',
      avatar: '',
      department: e.department || e.userId?.department || '',
      designation: e.designation || '',
      shift: e.shift || e.userId?.shift || '',
      shiftId: e.shiftId || e.userId?.shiftId || null,
      identityId: e.userId?.identityId ? String(e.userId.identityId) : null,
      profileId: e.userId?.profileId ? String(e.userId.profileId) : null,
    }));

    const rosterIds = new Set(roster.map((r) => r.uid));
    // Merge active users missing from Employee collection so nobody is invisible.
    const extraUsers = await User.find({ status: 'active', role: { $ne: 'super_admin' } })
      .select('_id name avatar department designation shift shiftId identityId profileId')
      .lean();
    for (const u of extraUsers) {
      const uid = String(u._id);
      if (rosterIds.has(uid)) continue;
      roster.push({
        uid,
        name: u.name || '',
        avatar: u.avatar || '',
        department: u.department || '',
        designation: u.designation || '',
        shift: u.shift || '',
        shiftId: u.shiftId || null,
        identityId: u.identityId ? String(u.identityId) : null,
        profileId: u.profileId ? String(u.profileId) : null,
      });
      rosterIds.add(uid);
    }

    // RBAC filter: admins see all, managers see their departments, rest see self.
    if (allowedIdSet) {
      roster = roster.filter((r) => allowedIdSet.has(r.uid));
    }
    if (isManager) {
      const depts = await getAccessibleDepartments(user);
      if (depts) roster = roster.filter((r) => depts.includes(r.department));
    }
    if (roster.length === 0) {
      return ok({ absences: [], summary: { totalAbsences: 0, notArrived: 0, onLeave: 0, onPermission: 0, late: 0, halfDay: 0, withoutLeave: 0 } });
    }

    const rosterIdObjs = roster.map((r) => r.uid);
    const rosterById = new Map(roster.map((r) => [r.uid, r]));

    // ── Batch loads (no N+1) ──
    const config = await getGlobalConfig().catch(() => ({}));
    const [attendanceRows, leaveRows, permRows, legacyAbsences, holidays, shifts] = await Promise.all([
      Attendance.find({ userId: { $in: rosterIdObjs }, date: { $gte: from, $lte: to } }).lean(),
      Leave.find({ userId: { $in: rosterIdObjs }, status: 'approved', from: { $lte: to }, to: { $gte: from } })
        .select('userId type typeCode from to halfDay').lean(),
      SelfServiceRequest.find({
        requestType: 'permission',
        status: { $in: ['approved', 'pending'] },
        'payload.date': { $gte: from, $lte: to },
      }).select('identityId profileId status payload reason').lean(),
      Absence.find({ userId: { $in: rosterIdObjs }, date: { $gte: from, $lte: to } })
        .populate('userId', 'name avatar department')
        .lean()
        .catch(() => []),
      Holiday.find({ date: { $gte: from, $lte: to } }).lean().catch(() => []),
      Shift.find({}).lean().catch(() => []),
    ]);

    const shiftById = new Map((shifts || []).map((s) => [String(s._id), s]));
    const shiftByName = new Map((shifts || []).map((s) => [s.name, s]));
    const shiftFor = (r) => {
      if (r.shiftId && shiftById.has(String(r.shiftId))) return shiftById.get(String(r.shiftId));
      if (r.shift && shiftByName.has(r.shift)) return shiftByName.get(r.shift);
      return null;
    };

    const attByKey = new Map();
    for (const a of attendanceRows || []) attByKey.set(`${String(a.userId)}|${a.date}`, a);

    const leaveByKey = new Map();
    for (const l of leaveRows || []) {
      const uid = String(l.userId);
      const s = l.from < from ? from : l.from;
      const e = l.to > to ? to : l.to;
      for (const d of eachDate(s, e)) {
        if (!leaveByKey.has(`${uid}|${d}`)) {
          leaveByKey.set(`${uid}|${d}`, { type: l.type, typeCode: l.typeCode, halfDay: !!l.halfDay, from: l.from, to: l.to });
        }
      }
    }

    // Map permission requests (identityId/profileId) -> userId.
    const permByKey = new Map();
    for (const p of permRows || []) {
      const d = p?.payload?.date;
      if (!d) continue;
      let uid = null;
      if (p.identityId) {
        for (const r of roster) {
          if (r.identityId && r.identityId === String(p.identityId)) { uid = r.uid; break; }
        }
      }
      if (!uid && p.profileId) {
        for (const r of roster) {
          if (r.profileId && r.profileId === String(p.profileId)) { uid = r.uid; break; }
        }
      }
      if (!uid) continue;
      const key = `${uid}|${d}`;
      if (!permByKey.has(key)) {
        permByKey.set(key, {
          status: p.status,
          startTime: p?.payload?.startTime || '',
          endTime: p?.payload?.endTime || '',
          duration: Number(p?.payload?.duration || 0) || 0,
          requestId: String(p._id),
          reason: p.reason || '',
        });
      }
    }

    // ── Derive per user × working date ──
    const dates = eachDate(from, to);
    const records = [];
    const seen = new Set(); // `${uid}|${date}` dedupe

    for (const r of roster) {
      const shiftDoc = shiftFor(r);
      for (const date of dates) {
        if (date > calToday) continue; // future dates are never absent/not-arrived
        if (!isWorkingDay(date, config, holidays || [])) continue;
        const key = `${r.uid}|${date}`;
        const attendance = attByKey.get(key) || null;
        const leave = leaveByKey.get(key) || null;
        const permission = permByKey.get(key) || null;

        const derived = deriveAbsenceKind({
          date,
          attendance,
          leave,
          permission,
          shiftDoc,
          fallbackShiftName: r.shift,
          now,
        });

        // Only absence-relevant rows: skip plain present / holiday.
        // Present rows WITH a permission are kept so the badge is visible.
        if (derived.kind === 'present' && !derived.permissionStatus) continue;
        if (derived.kind === 'holiday') continue;

        seen.add(key);
        const isLate = derived.kind === 'late';
        records.push({
          _id: attendance?._id ? String(attendance._id) : `derived_${r.uid}_${date}`,
          userId: { _id: r.uid, name: r.name, avatar: r.avatar || '', department: r.department || '' },
          date,
          kind: derived.kind === 'present' && derived.permissionStatus ? 'on_permission' : derived.kind,
          statusLabel:
            derived.kind === 'absent' ? 'Absent'
            : derived.kind === 'not_arrived' ? 'Not Arrived'
            : derived.kind === 'on_leave' ? 'On Leave'
            : derived.kind === 'half_day' ? 'Half Day'
            : derived.kind === 'late' ? 'Late'
            : derived.permissionStatus ? 'On Permission' : 'Present',
          reason: derived.reason,
          hasLeave: !!leave,
          leave: leave ? { type: leave.type, typeCode: leave.typeCode, halfDay: leave.halfDay } : null,
          permission: permission
            ? { status: permission.status, startTime: permission.startTime, endTime: permission.endTime, requestId: permission.requestId }
            : derived.permissionStatus
              ? { status: derived.permissionStatus, startTime: attendance?.permission?.startTime || '', endTime: attendance?.permission?.endTime || '' }
              : null,
          permissionStatus: derived.permissionStatus,
          clockIn: attendance?.clockIn || null,
          clockOut: attendance?.clockOut || null,
          lateFlag: isLate || !!attendance?.lateFlag,
          flagged: false,
          _virtual: !attendance?._id,
          _attendanceId: attendance?._id ? String(attendance._id) : null,
        });
      }
    }

    // ── Merge legacy Absence docs (dedupe: derived wins) ──
    for (const a of legacyAbsences || []) {
      const uid = String(a.userId?._id || a.userId);
      if (!rosterById.has(uid)) continue;
      const key = `${uid}|${a.date}`;
      if (seen.has(key)) continue; // dedupe: derived row already covers this date
      if (a.date > calToday) continue;
      seen.add(key);
      const r = rosterById.get(uid);
      records.push({
        _id: String(a._id),
        userId: { _id: uid, name: r?.name || a.userId?.name || '', avatar: r?.avatar || a.userId?.avatar || '', department: r?.department || a.userId?.department || '' },
        date: a.date,
        kind: 'absent',
        statusLabel: 'Absent',
        reason: a.reason || 'No notification',
        hasLeave: false,
        leave: null,
        permission: null,
        permissionStatus: null,
        clockIn: null,
        clockOut: null,
        lateFlag: false,
        flagged: !!a.flagged,
        _virtual: false,
        _legacy: true,
      });
    }

    // Sort newest first, then name.
    records.sort((x, y) => (y.date < x.date ? -1 : y.date > x.date ? 1 : String(x.userId?.name || '').localeCompare(String(y.userId?.name || ''))));

    // Pattern: absent-day count per user within this month (derived + legacy merged).
    const absentCount = new Map();
    for (const rec of records) {
      if (rec.kind === 'absent') absentCount.set(String(rec.userId?._id), (absentCount.get(String(rec.userId?._id)) || 0) + 1);
    }
    for (const rec of records) {
      rec.pattern = absentCount.get(String(rec.userId?._id)) || 0;
      if (rec.pattern >= 3) rec.flagged = true;
    }

    const summary = {
      totalAbsences: records.filter((r) => r.kind === 'absent').length,
      notArrived: records.filter((r) => r.kind === 'not_arrived').length,
      onLeave: records.filter((r) => r.kind === 'on_leave').length,
      onPermission: records.filter((r) => r.kind === 'on_permission' || r.permissionStatus === 'approved').length,
      late: records.filter((r) => r.kind === 'late').length,
      halfDay: records.filter((r) => r.kind === 'half_day').length,
      withoutLeave: records.filter((r) => r.kind === 'absent' && !r.hasLeave).length,
    };

    return ok({ absences: records, summary });
  } catch (e) {
    return fail(e.message, 500);
  }
}
