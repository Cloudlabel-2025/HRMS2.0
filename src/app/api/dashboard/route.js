import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok } from '@/lib/jwt';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import User from '@/lib/models/User';
import { Task } from '@/lib/models/Task';
import { Payroll } from '@/lib/models/Payroll';
import { Announcement, Employee, Shift, SelfServiceRequest } from '@/lib/models/index';
import { getAccessibleDepartments, getDepartmentUserIds } from '@/lib/rbac';
import { computeWorkRowDuration } from '@/lib/attendance-constants';
import { getAttendanceDate } from '@/lib/attendance-date';
import { deriveAbsenceKind } from '@/lib/absence-status';
import { getTzTime } from '@/lib/timezone';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  await dbConnect();

  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const role = user.role;
  const isSuperAdmin = role === 'super_admin';

  const isSelfRole  = ['employee', 'intern'].includes(role);
  const isAdminRole = ['super_admin', 'admin_full'].includes(role);
  const isTeamRole  = ['team_lead', 'team_admin'].includes(role);
  const teamIds = isTeamRole
    ? (await getDepartmentUserIds(user)).filter(id => id.toString() !== user._id.toString())
    : [];

  // Build announcement filter before the parallel queries
  let announcementFilter = {};
  if (!isAdminRole) {
    const accessibleDepts = await getAccessibleDepartments(user);
    announcementFilter = {
      $or: [
        { audience: 'Company-wide' },
        ...(accessibleDepts ? [{ departments: { $in: accessibleDepts } }] : []),
        ...(accessibleDepts ? [{ audience: { $in: accessibleDepts } }] : []),
        ...(isTeamRole ? [{ audience: 'My Team', author: { $in: teamIds } }] : []),
      ],
    };
  }

  const [
    totalEmployees,
    presentToday,
    pendingLeaves,
    myAttendanceThisMonth,
    myPendingTasks,
    announcements,
  ] = await Promise.all([
    isAdminRole ? Employee.countDocuments({ status: 'active' })
      : isTeamRole ? Promise.resolve(teamIds.length)
      : Promise.resolve(0),
    isAdminRole ? Attendance.countDocuments({ date: today, status: 'present' })
      : isTeamRole ? Attendance.countDocuments({ date: today, status: 'present', userId: { $in: teamIds } })
      : Promise.resolve(0),
    isAdminRole ? Leave.countDocuments({ status: 'pending' })
      : isTeamRole ? Leave.countDocuments({ status: 'pending', userId: { $in: teamIds } })
      : Leave.countDocuments({ userId: user._id, status: 'pending' }),
    isSelfRole
      ? Attendance.countDocuments({ userId: user._id, status: 'present', date: { $gte: monthStart } })
      : Promise.resolve(0),
    Task.countDocuments(
      isAdminRole ? { status: { $in: ['To Do', 'In Progress'] } }
        : isTeamRole ? { assignedTo: { $in: [...teamIds, user._id] }, status: { $in: ['To Do', 'In Progress'] } }
        : { assignedTo: user._id, status: { $in: ['To Do', 'In Progress'] } }
    ),
    Announcement.find(announcementFilter).sort({ createdAt: -1 }).limit(3),
  ]);

  let monitoring = null;
  let overview = null;
  if (isAdminRole) {
    const employeeFilter = isAdminRole
      ? { status: 'active', role: { $ne: 'super_admin' } }
      : { [role === 'team_lead' ? 'teamLeadId' : 'teamAdminId']: user._id, status: 'active', role: { $ne: 'super_admin' } };
    const monitoredEmployees = await Employee.find(employeeFilter)
      .populate('userId', 'shift shiftId identityId profileId')
      .select('userId name department shift shiftId')
      .lean();
    const monitoredIds = monitoredEmployees
      .map((employee) => employee.userId?._id || employee.userId)
      .filter(Boolean);

    // Timezone-aware "now" so shift math matches the monitoring page
    // (client-local) and the clock-in writer (getTzTime). Attendance rows
    // for both the shift-aware today and yesterday are loaded because a
    // night-shift employee's "today" may be the previous calendar date.
    const nowTz = await getTzTime().catch(() => new Date());
    const tzToday = nowTz.getFullYear() + '-' + String(nowTz.getMonth() + 1).padStart(2, '0') + '-' + String(nowTz.getDate()).padStart(2, '0');
    const tzYestD = new Date(nowTz); tzYestD.setDate(tzYestD.getDate() - 1);
    const tzYest = tzYestD.getFullYear() + '-' + String(tzYestD.getMonth() + 1).padStart(2, '0') + '-' + String(tzYestD.getDate()).padStart(2, '0');

    const [attendanceRecords, approvedLeaves, shiftDocs, permDocs] = await Promise.all([
      Attendance.find({ userId: { $in: monitoredIds }, date: { $in: [tzToday, tzYest] } }).select('userId date status clockIn lateFlag permission pendingPermission approvedHalfDayLeave').lean(),
      Leave.find({ userId: { $in: monitoredIds }, status: 'approved', from: { $lte: tzToday }, to: { $gte: tzYest } }).select('userId type typeCode from to halfDay').lean(),
      Shift.find({}).select('name startTime endTime halfDayThreshold lateThreshold').lean().catch(() => []),
      SelfServiceRequest.find({ requestType: 'permission', status: { $in: ['approved', 'pending'] }, 'payload.date': { $in: [tzToday, tzYest] } }).select('identityId profileId status payload').lean().catch(() => []),
    ]);
    const shiftById = new Map((shiftDocs || []).map((s) => [String(s._id), s]));
    const shiftByName = new Map((shiftDocs || []).map((s) => [s.name, s]));

    const attByKey = new Map();
    for (const record of attendanceRecords || []) attByKey.set(`${String(record.userId)}|${record.date}`, record);

    const leaveByKey = new Map();
    for (const leave of approvedLeaves || []) {
      const uid = String(leave.userId);
      for (const d of [tzYest, tzToday]) {
        if (leave.from <= d && d <= leave.to && !leaveByKey.has(`${uid}|${d}`)) {
          leaveByKey.set(`${uid}|${d}`, { type: leave.type, typeCode: leave.typeCode, halfDay: !!leave.halfDay });
        }
      }
    }

    // Map permission requests (identityId/profileId) -> user + date.
    const permByKey = new Map();
    for (const p of permDocs || []) {
      const d = p?.payload?.date;
      if (!d) continue;
      let uid = null;
      for (const e of monitoredEmployees) {
        const eu = e.userId || {};
        if ((p.identityId && eu.identityId && String(eu.identityId) === String(p.identityId)) ||
            (p.profileId && eu.profileId && String(eu.profileId) === String(p.profileId))) {
          uid = String(eu._id || e.userId);
          break;
        }
      }
      if (!uid) continue;
      const key = `${uid}|${d}`;
      if (!permByKey.has(key)) {
        permByKey.set(key, { status: p.status, startTime: p?.payload?.startTime || '', endTime: p?.payload?.endTime || '' });
      }
    }

    // Same rule as the monitoring page and /api/absence: a missing clock-in
    // is 'not_arrived' until the employee's halfDayThreshold elapses, then
    // 'absent'. Permission badge persists on both states.
    const counts = { present: 0, late: 0, absent: 0, leave: 0, not_arrived: 0 };
    const alerts = [];
    for (const employee of monitoredEmployees) {
      const rawId = employee.userId?._id || employee.userId;
      if (!rawId) continue;
      const id = String(rawId);
      const uDoc = employee.userId || {};
      const sid = uDoc.shiftId || employee.shiftId;
      const sname = employee.shift || uDoc.shift;
      const shiftDoc = (sid && shiftById.get(String(sid))) || (sname && shiftByName.get(sname)) || null;
      const empToday = getAttendanceDate(nowTz, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
      const record = attByKey.get(`${id}|${empToday}`) || null;
      const leave = leaveByKey.get(`${id}|${empToday}`) || null;
      const perm = permByKey.get(`${id}|${empToday}`)
        || (record?.pendingPermission ? { status: 'pending', startTime: record.pendingPermission.startTime || '', endTime: record.pendingPermission.endTime || '' } : null);

      const derived = deriveAbsenceKind({
        date: empToday,
        attendance: record,
        leave,
        permission: perm,
        shiftDoc,
        fallbackShiftName: sname || '',
        now: nowTz,
      });
      let status;
      if (derived.kind === 'on_leave') status = 'leave';
      else if (derived.kind === 'not_arrived') status = 'not_arrived';
      else if (derived.kind === 'late') status = 'late';
      else if (derived.kind === 'absent') status = 'absent';
      else status = 'present'; // present | half_day | on_permission
      const permBadge = derived.permissionStatus === 'approved' ? 'approved' : derived.permissionStatus === 'pending' ? 'pending' : null;
      counts[status] = (counts[status] || 0) + 1;
      if (status === 'late') alerts.push({ name: employee.name, department: employee.department, status: permBadge === 'pending' ? 'Late + Permission pending' : 'Late', time: record?.clockIn || '', permission: permBadge });
      else if (status === 'present' && permBadge === 'approved') alerts.push({ name: employee.name, department: employee.department, status: 'Present + Permission', time: record?.clockIn || '', permission: 'approved' });
      // Absent stays red-styled: permission context goes into the text, not
      // the badge field (which the card uses for blue/amber styling).
      else if (status === 'absent') alerts.push({ name: employee.name, department: employee.department, status: permBadge ? `Absent · Permission ${permBadge}` : 'Absent', time: '', permission: null });
      // not_arrived and leave are not exceptions — no alert.
    }
    monitoring = { counts, alerts: alerts.slice(0, 5) };

    if (isSuperAdmin) {
      const allRecords = await Attendance.find({ userId: { $in: monitoredIds } }).select('userId date workProgress').sort({ date: -1 }).lean();
      const empInfo = new Map(monitoredEmployees.map(e => [String(e.userId?._id || e.userId), { name: e.name, department: e.department }]));

      const computeOverview = (records) => {
        const byUser = new Map();
        for (const rec of records) {
          const uid = rec.userId.toString();
          if (!byUser.has(uid)) byUser.set(uid, { latest: new Map(), attemptDates: new Map(), completedDates: new Map(), totalMins: new Map() });
          const { latest, attemptDates, completedDates, totalMins } = byUser.get(uid);
          for (const row of [...(rec.workProgress || [])].reverse()) {
            if (row.type !== 'task') continue;
            const text = row.taskDetails ? String(row.taskDetails).trim() : '';
            if (!text) continue;
            let dates = attemptDates.get(text);
            if (!dates) { dates = new Set(); attemptDates.set(text, dates); }
            dates.add(rec.date);
            totalMins.set(text, (totalMins.get(text) || 0) + (typeof row.duration === 'number' ? row.duration : (computeWorkRowDuration(row) || 0)));
            if (!latest.has(text)) {
              latest.set(text, { status: row.status, carriedForward: !!row.carriedForward, date: rec.date, remarks: row.remarks || '' });
            }
            if (row.status === 'completed' && !row.carriedForward && !completedDates.has(text)) {
              completedDates.set(text, rec.date);
            }
          }
        }
        const rows = [];
        for (const [uid, { latest, attemptDates, completedDates, totalMins }] of byUser) {
          const info = empInfo.get(uid);
          if (!info) continue;
          const tasks = [];
          for (const [text, l] of latest) {
            if (l.carriedForward === true || ['pending', 'stopped', 'work_in_progress'].includes(l.status)) {
              const attempts = attemptDates.get(text).size;
              tasks.push({
                text,
                status: l.status,
                carriedForward: l.carriedForward,
                attempts,
                completedDate: completedDates.get(text) || null,
                date: l.date,
                remarks: l.remarks,
                high: attempts > 1,
                durationMins: totalMins.get(text) || 0,
              });
            }
          }
          const totalTries = tasks.reduce((sum, t) => sum + t.attempts, 0);
          rows.push({
            userId: uid,
            name: info.name,
            department: info.department,
            pendingCount: tasks.length,
            high: tasks.some(t => t.high),
            totalTries,
            highTasks: tasks.filter(t => t.high),
            tasks,
          });
        }
        rows.sort((a, b) => {
          if (a.high !== b.high) return a.high ? -1 : 1;
          if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
          return a.name.localeCompare(b.name);
        });
        return rows;
      };

      overview = computeOverview(allRecords);
    }
  }

  const isLeaveBalanceVisible = ['employee', 'intern', 'team_lead', 'team_admin'].includes(role);
  const myLeaveBalance = isLeaveBalanceVisible
    ? 12 - await Leave.countDocuments({ userId: user._id, status: 'approved', typeCode: 'CL' })
    : 0;

  let pendingTasks = null;
  const buildPendingRows = (worksheetRecords) => {
    const latest = new Map();
    const attemptDates = new Map();

    for (const rec of worksheetRecords) {
      const assignee = rec.userId?.name || '';
      const assigneeId = (rec.userId?._id || '').toString();
      for (const row of [...(rec.workProgress || [])].reverse()) {
        if (row.type !== 'task') continue;
        const text = row.taskDetails ? String(row.taskDetails).trim() : '';
        if (!text) continue;
        const key = assigneeId + '::' + text;

        let dates = attemptDates.get(key);
        if (!dates) {
          dates = new Set();
          attemptDates.set(key, dates);
        }
        dates.add(rec.date);

        if (!latest.has(key)) {
          latest.set(key, { text, status: row.status, carriedForward: !!row.carriedForward, date: rec.date, _id: row._id, duration: row.duration ?? null, remarks: row.remarks || '', assignee, assigneeId, startTime: row.startTime });
        }
      }
    }

    const rows = [];
    for (const [key, l] of latest) {
      if (l.status === 'completed' && l.carriedForward === false) continue;
      rows.push({
        _id: l._id,
        text: l.text,
        status: l.status,
        carriedForward: l.carriedForward,
        assignee: l.assignee,
        assigneeId: l.assigneeId,
        duration: l.duration,
        remarks: l.remarks,
        date: l.date,
        attempts: attemptDates.get(key).size,
      });
    }
    return rows;
  };

  if (role === 'admin_full') {
    // Worksheet tasks: own + all employees, excluding other admin_full / super_admin.
    // super_admin remains unrestricted via overview and can see everything there.
    const others = await User.find({ status: 'active', role: { $nin: ['super_admin', 'admin_full'] } }).select('_id').lean().catch(() => []);
    const ownerFilter = { $in: [user._id, ...others.map(o => o._id)] };
    const worksheetRecords = await Attendance.find({ userId: ownerFilter })
      .populate('userId', 'name')
      .select('userId date workProgress')
      .sort({ date: -1 })
      .lean();
    pendingTasks = buildPendingRows(worksheetRecords);
  }

  if (!isAdminRole) {
    const ownerFilter = isTeamRole ? { $in: [...teamIds, user._id] } : user._id;
    const worksheetRecords = await Attendance.find({ userId: ownerFilter })
      .populate('userId', 'name')
      .select('userId date workProgress')
      .sort({ date: -1 })
      .lean();
    pendingTasks = buildPendingRows(worksheetRecords);
  }

  const lastPayslip = isSelfRole
    ? await Payroll.findOne({ userId: user._id }).sort({ createdAt: -1 })
    : null;

  // Recruiter-specific: open jobs count
  const openJobs = role === 'recruiter'
    ? await (await import('@/lib/models/index')).JobPosting.countDocuments({ status: 'active' })
    : 0;

  return ok({
    totalEmployees,
    presentToday,
    pendingLeaves,
    myAttendanceThisMonth,
    myPendingTasks,
    myLeaveBalance,
    openJobs,
    lastPayslip: lastPayslip ? { net: lastPayslip.netPay, month: lastPayslip.month } : null,
    monitoring,
    overview: isSuperAdmin ? overview : null,
    pendingTasks,
    announcements: announcements.map(a => ({
      id: a._id, title: a.title, body: a.body, tag: a.tag, tagColor: a.tagColor, date: a.createdAt, attachment: a.attachment,
    })),
  });
}
