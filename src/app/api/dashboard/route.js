import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Task } from '@/lib/models/Task';
import { Payroll } from '@/lib/models/Payroll';
import { Announcement, Employee } from '@/lib/models/index';
import { getAccessibleDepartments } from '@/lib/rbac';
import { getTzTime } from '@/lib/timezone';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  await dbConnect();

  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const role = user.role;

  // Scope team member IDs for team_lead / team_admin
  let teamIds = null;
  if (role === 'team_lead')  teamIds = (await Employee.find({ teamLeadId:  user._id }).select('userId')).map(e => e.userId);
  if (role === 'team_admin') teamIds = (await Employee.find({ teamAdminId: user._id }).select('userId')).map(e => e.userId);

  const isSelfRole  = ['employee', 'intern'].includes(role);
  const isAdminRole = ['super_admin', 'admin_full'].includes(role);
  const isTeamRole  = ['team_lead', 'team_admin'].includes(role);

  // Build announcement filter before the parallel queries
  let announcementFilter = {};
  if (!isAdminRole) {
    const accessibleDepts = await getAccessibleDepartments(user);
    announcementFilter = {
      $or: [
        { audience: 'Company-wide' },
        ...(accessibleDepts ? [{ departments: { $in: accessibleDepts } }] : []),
        ...(accessibleDepts ? [{ audience: { $in: accessibleDepts } }] : []),
        ...(teamIds ? [{ audience: 'My Team', author: { $in: teamIds } }] : []),
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
      : isTeamRole ? Employee.countDocuments({ [role === 'team_lead' ? 'teamLeadId' : 'teamAdminId']: user._id, status: 'active' })
      : Promise.resolve(0),
    isAdminRole ? Attendance.countDocuments({ date: today, status: 'present' })
      : isTeamRole ? Attendance.countDocuments({ date: today, status: 'present', userId: { $in: teamIds } })
      : Promise.resolve(0),
    isAdminRole ? Leave.countDocuments({ status: 'pending' })
      : role === 'team_lead'  ? Leave.countDocuments({ teamAdminApproval: 'approved', tlApproval: 'pending', userId: { $in: teamIds } })
      : role === 'team_admin' ? Leave.countDocuments({ teamAdminApproval: 'pending', userId: { $in: teamIds } })
      : Leave.countDocuments({ userId: user._id, status: 'pending' }),
    isSelfRole
      ? Attendance.countDocuments({ userId: user._id, status: 'present', date: { $gte: monthStart } })
      : Promise.resolve(0),
    Task.countDocuments(
      isAdminRole ? { status: { $in: ['To Do', 'In Progress'] } }
        : isTeamRole ? { assignedTo: { $in: teamIds }, status: { $in: ['To Do', 'In Progress'] } }
        : { assignedTo: user._id, status: { $in: ['To Do', 'In Progress'] } }
    ),
    Announcement.find(announcementFilter).sort({ createdAt: -1 }).limit(3),
  ]);

  let monitoring = null;
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
  }

  const myLeaveBalance = isSelfRole
    ? 12 - await Leave.countDocuments({ userId: user._id, status: 'approved', typeCode: 'CL' })
    : 0;

  let pendingTasks = null;
  if (!isAdminRole) {
    const now = await getTzTime();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const incompleteStatuses = ['pending', 'work_in_progress', 'stopped'];

    let worksheetRecords = [];
    if (isTeamRole) {
      worksheetRecords = await Attendance.find({ userId: { $in: teamIds }, date: todayStr })
        .populate('userId', 'name')
        .select('userId workProgress')
        .lean();
    } else {
      const rec = await Attendance.findOne({ userId: user._id, date: todayStr }).select('userId workProgress').lean();
      if (rec) worksheetRecords = [rec];
    }

    const rows = [];
    for (const rec of worksheetRecords) {
      const assignee = rec.userId?.name || '';
      for (const row of rec.workProgress || []) {
        if (row.type === 'task' && incompleteStatuses.includes(row.status) && row.taskDetails && String(row.taskDetails).trim()) {
          rows.push({ _id: row._id, text: String(row.taskDetails).trim(), status: row.status, assignee });
        }
      }
    }
    pendingTasks = rows.slice(0, 8);
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
    pendingTasks,
    announcements: announcements.map(a => ({
      id: a._id, title: a.title, body: a.body, tag: a.tag, tagColor: a.tagColor, date: a.createdAt, attachment: a.attachment,
    })),
  });
}
