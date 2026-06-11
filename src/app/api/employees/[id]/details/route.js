import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Employee, Asset, Document } from '@/lib/models/index';
import Leave from '@/lib/models/Leave';
import Attendance from '@/lib/models/Attendance';
import { Payroll } from '@/lib/models/Payroll';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { sanitizeIdentityRecord, sanitizeProfileRecord } from '@/lib/core/privacy';

export async function GET(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const emp = await Employee.findById(id)
    .populate('teamLeadId', 'name email avatar')
    .populate('teamAdminId', 'name email avatar');

  if (!emp) return fail('Employee not found', 404);

  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) {
    if (emp.department !== user.department) return fail('Access denied', 403);
  }

  // Fetch auth user to get identityId
  const authUser = await User.findById(emp.userId).select('identityId profileId');

  const [leaves, attendance, assets, documents, payslips, identity, profile] = await Promise.all([
    Leave.find({ userId: emp.userId }).sort({ createdAt: -1 }).limit(10),
    Attendance.find({ userId: emp.userId }).sort({ date: -1 }).limit(30),
    Asset.find({ assignedTo: emp.userId }),
    Document.find({ $or: [{ employeeId: emp.userId }, { uploadedBy: emp.userId }] }).sort({ createdAt: -1 }),
    ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role) || user._id.toString() === emp.userId.toString()
      ? Payroll.find({ userId: emp.userId }).sort({ year: -1, month: -1 }).limit(12)
      : Promise.resolve([]),
    authUser?.identityId ? UsrIdentity.findById(authUser.identityId) : Promise.resolve(null),
    authUser?.profileId  ? EmpProfile.findById(authUser.profileId)   : Promise.resolve(null),
  ]);

  return ok({
    employee: emp,
    identity: sanitizeIdentityRecord(identity),
    profile:  sanitizeProfileRecord(profile),
    leaves,
    attendance,
    assets,
    documents,
    payslips,
  });
}
