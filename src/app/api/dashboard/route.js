import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Task } from '@/lib/models/Task';
import { Payroll } from '@/lib/models/Payroll';
import { AuditLog, Announcement, Employee } from '@/lib/models/index';

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

  const [
    totalEmployees,
    presentToday,
    pendingLeaves,
    myAttendanceThisMonth,
    myPendingTasks,
    recentActivity,
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
    AuditLog.find().sort({ createdAt: -1 }).limit(5).populate('userId', 'name'),
    Announcement.find(
      isAdminRole
        ? {}
        : {
            $or: [
              { audience: 'Company-wide' },
              ...(user.department ? [{ departments: user.department }] : []),
              ...(user.department ? [{ audience: user.department }] : []),
              ...(teamIds ? [{ audience: 'My Team', author: { $in: teamIds } }] : []),
            ],
          }
    ).sort({ createdAt: -1 }).limit(3),
  ]);

  const myLeaveBalance = isSelfRole
    ? 12 - await Leave.countDocuments({ userId: user._id, status: 'approved', type: 'Casual Leave' })
    : 0;

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
    recentActivity: recentActivity.map(a => ({
      text: a.action, module: a.module, time: a.createdAt, severity: a.severity,
    })),
    announcements: announcements.map(a => ({
      id: a._id, title: a.title, body: a.body, tag: a.tag, tagColor: a.tagColor, date: a.createdAt,
    })),
  });
}
