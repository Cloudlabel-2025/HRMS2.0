import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok } from '@/lib/jwt';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Task } from '@/lib/models/Task';
import { Payroll } from '@/lib/models/Payroll';
import { Announcement, Employee } from '@/lib/models/index';
import { getAccessibleDepartments, getDepartmentUserIds } from '@/lib/rbac';
import { computeWorkRowDuration } from '@/lib/attendance-constants';

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
    const monitoredEmployees = await Employee.find(employeeFilter).select('userId name department').lean();
    const monitoredIds = monitoredEmployees.map(employee => employee.userId);
    const [attendanceRecords, approvedLeaves] = await Promise.all([
      Attendance.find({ userId: { $in: monitoredIds }, date: today }).select('userId status clockIn lateFlag').lean(),
      Leave.find({ userId: { $in: monitoredIds }, status: 'approved', from: { $lte: today }, to: { $gte: today } }).select('userId').lean(),
    ]);
    const attendanceByUser = new Map(attendanceRecords.map(record => [record.userId.toString(), record]));
    const leaveUserIds = new Set(approvedLeaves.map(leave => leave.userId.toString()));
    const counts = { present: 0, late: 0, absent: 0, leave: 0 };
    const alerts = [];
    for (const employee of monitoredEmployees) {
      const id = employee.userId.toString();
      const record = attendanceByUser.get(id);
      const status = leaveUserIds.has(id) ? 'leave' : (record?.status === 'late' || record?.lateFlag ? 'late' : record?.status === 'present' ? 'present' : 'absent');
      counts[status]++;
      if (status === 'late') alerts.push({ name: employee.name, department: employee.department, status: 'Late', time: record?.clockIn || '' });
      if (status === 'absent') alerts.push({ name: employee.name, department: employee.department, status: 'Absent', time: '' });
    }
    monitoring = { counts, alerts: alerts.slice(0, 5) };

    if (isSuperAdmin) {
      const allRecords = await Attendance.find({ userId: { $in: monitoredIds } }).select('userId date workProgress').sort({ date: -1 }).lean();
      const empInfo = new Map(monitoredEmployees.map(e => [e.userId.toString(), { name: e.name, department: e.department }]));

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

  const myLeaveBalance = isSelfRole
    ? 12 - await Leave.countDocuments({ userId: user._id, status: 'approved', typeCode: 'CL' })
    : 0;

  let pendingTasks = null;
  if (!isAdminRole) {
    const ownerFilter = isTeamRole ? { $in: [...teamIds, user._id] } : user._id;
    const worksheetRecords = await Attendance.find({ userId: ownerFilter })
      .populate('userId', 'name')
      .select('userId date workProgress')
      .sort({ date: -1 })
      .lean();

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
    pendingTasks = rows;
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
