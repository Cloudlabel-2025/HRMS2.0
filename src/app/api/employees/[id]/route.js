import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog, Employee } from '@/lib/models/index';

export async function GET(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const emp = await Employee.findById(id);
  if (!emp) return fail('Employee not found', 404);

  // Everyone (except admins) can view anyone in their own department
  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) {
    if (emp.department !== user.department) {
      return fail('Access denied', 403);
    }
  }

  return ok(emp);
}

export async function PUT(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const isAdmin = ['super_admin', 'admin_full'].includes(user.role);

  // Find the employee record first
  const existing = await Employee.findById(id);
  if (!existing) return fail('Employee not found', 404);

  const isSelf = existing.userId.toString() === user._id.toString();

  if (!isAdmin && !isSelf) return fail('Access denied', 403);

  const body = await req.json();
  delete body.password;
  delete body.userId; // cannot change linked user

  // Non-admins can only update safe personal fields
  if (!isAdmin) {
    const allowed = ['phone', 'avatar', 'skills', 'designation'];
    Object.keys(body).forEach(k => { if (!allowed.includes(k)) delete body[k]; });
  }

  const emp = await Employee.findByIdAndUpdate(id, body, { new: true });
  if (!emp) return fail('Employee not found', 404);

  // Sync key fields back to User for auth/display consistency
  const syncFields = {};
  if (body.name) syncFields.name = body.name;
  if (body.department) syncFields.department = body.department;
  if (body.designation) syncFields.designation = body.designation;
  if (body.role) syncFields.role = body.role;
  if (body.status) syncFields.status = body.status;
  if (Object.keys(syncFields).length > 0) {
    await User.findByIdAndUpdate(emp.userId, syncFields);
  }

  await AuditLog.create({
    action: `Employee Updated: ${emp.name}`, module: 'Employees',
    userId: user._id, severity: 'low',
  });
  return ok(emp);
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (user.role !== 'super_admin') return fail('Access denied', 403);
  await dbConnect();

  const emp = await Employee.findByIdAndDelete(id);
  if (!emp) return fail('Employee not found', 404);

  // Also deactivate or delete the associated User auth record
  await User.findByIdAndUpdate(emp.userId, { status: 'inactive' });

  await AuditLog.create({
    action: `Employee Deleted: ${emp.name}`, module: 'Employees',
    userId: user._id, severity: 'high',
  });
  return ok({ deleted: true });
}
