import { Asset, Document, AuditLog } from '@/lib/models/index';
import Leave from '@/lib/models/Leave';
import Attendance from '@/lib/models/Attendance';
import { Payroll } from '@/lib/models/Payroll';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { sanitizeIdentityRecord, sanitizeProfileRecord } from '@/lib/core/privacy';

export async function buildSelfProfilePayload(user, emp) {
  const authUser = await User.findById(emp.userId).select('identityId profileId firstLoginAt');

  const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
  const isSelf = !!emp.userId && emp.userId.toString() === user._id.toString();
  const canViewAudit = isAdmin && !isSelf;

  const [leaves, attendance, assets, documents, payslips, identity, profile, auditLogs] = await Promise.all([
    Leave.find({ userId: emp.userId }).sort({ createdAt: -1 }).limit(10),
    Attendance.find({ userId: emp.userId }).sort({ date: -1 }).limit(30),
    Asset.find({ assignedTo: emp.userId }),
    Document.find({ $or: [{ employeeId: emp.userId }, { uploadedBy: emp.userId }] }).sort({ createdAt: -1 }),
    ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role) || isSelf
      ? Payroll.find({ userId: emp.userId }).sort({ year: -1, month: -1 }).limit(12)
      : Promise.resolve([]),
    authUser?.identityId ? UsrIdentity.findById(authUser.identityId) : Promise.resolve(null),
    authUser?.profileId  ? EmpProfile.findById(authUser.profileId)   : Promise.resolve(null),
    canViewAudit
      ? AuditLog.find({ $or: [{ userId: emp.userId }, { targetUserId: emp.userId }] })
          .populate('userId', 'name')
          .sort({ createdAt: -1 }).limit(200)
      : Promise.resolve([]),
  ]);

  return {
    employee: emp,
    identity: sanitizeIdentityRecord(identity, user.role, { isOwner: isSelf }),
    profile:  sanitizeProfileRecord(profile),
    leaves,
    attendance,
    assets,
    documents,
    payslips,
    auditLogs,
    firstLoginAt: authUser?.firstLoginAt || null,
  };
}