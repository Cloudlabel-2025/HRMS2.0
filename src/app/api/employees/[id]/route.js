import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';
import { employeeScopeFilter } from '@/lib/rbac';

export async function GET(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const emp = await User.findById(params.id).select('-password -loginAttempts -lockUntil');
  if (!emp) return fail('Employee not found', 404);

  // Employees/interns can only view themselves
  if (['employee', 'intern'].includes(user.role) && emp._id.toString() !== user._id.toString()) {
    return fail('Access denied', 403);
  }

  return ok(emp);
}

export async function PUT(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const isAdmin = ['super_admin', 'admin_full'].includes(user.role);
  const isSelf  = params.id === user._id.toString();

  // Employees can update their own profile (limited fields); admins can update anyone
  if (!isAdmin && !isSelf) return fail('Access denied', 403);

  const body = await req.json();
  delete body.password;
  delete body.role;       // role changes only via dedicated endpoint
  delete body.status;     // status changes only via admin

  // Non-admins can only update safe personal fields
  if (!isAdmin) {
    const allowed = ['phone', 'avatar', 'skills', 'designation'];
    Object.keys(body).forEach(k => { if (!allowed.includes(k)) delete body[k]; });
  }

  const emp = await User.findByIdAndUpdate(params.id, body, { new: true })
    .select('-password -loginAttempts -lockUntil');
  if (!emp) return fail('Employee not found', 404);

  await AuditLog.create({
    action: `Employee Updated: ${emp.name}`, module: 'Employees',
    userId: user._id, severity: 'low',
  });
  return ok(emp);
}

export async function DELETE(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (user.role !== 'super_admin') return fail('Access denied', 403);
  await dbConnect();

  const emp = await User.findByIdAndDelete(params.id);
  if (!emp) return fail('Employee not found', 404);

  await AuditLog.create({
    action: `Employee Deleted: ${emp.name}`, module: 'Employees',
    userId: user._id, severity: 'high',
  });
  return ok({ deleted: true });
}
