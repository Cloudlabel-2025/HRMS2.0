import dbConnect from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Employee, Asset, Document } from '@/lib/models/index';
import Leave from '@/lib/models/Leave';
import Attendance from '@/lib/models/Attendance';
import { Payroll } from '@/lib/models/Payroll';

export async function GET(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  // 1. Fetch Employee and populate managers
  const emp = await Employee.findById(id)
    .populate('teamLeadId', 'name email avatar')
    .populate('teamAdminId', 'name email avatar');

  if (!emp) return fail('Employee not found', 404);

  // RBAC: If employee/intern, can only view people in their own department
  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) {
    if (emp.department !== user.department) {
      return fail('Access denied', 403);
    }
  }

  // 2. Parallel fetch for all related data
  // Limit to recent data where appropriate
  const [leaves, attendance, assets, documents, payslips] = await Promise.all([
    Leave.find({ userId: emp.userId }).sort({ createdAt: -1 }).limit(10),
    Attendance.find({ userId: emp.userId }).sort({ date: -1 }).limit(30),
    Asset.find({ assignedTo: emp.userId }),
    Document.find({ $or: [{ employeeId: emp.userId }, { uploadedBy: emp.userId }] }).sort({ createdAt: -1 }),
    // Payroll is sensitive; only self or admin/mgmt can view
    ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role) || user._id.toString() === emp.userId.toString()
      ? Payroll.find({ userId: emp.userId }).sort({ year: -1, month: -1 }).limit(12)
      : Promise.resolve([])
  ]);

  return ok({
    employee: emp,
    leaves,
    attendance,
    assets,
    documents,
    payslips,
  });
}
