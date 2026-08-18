import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { Employee, Shift } from '@/lib/models/index';
import { UpdateEmployeeSchema, validateRequest } from '@/lib/validation';
import { canAccessDepartment } from '@/lib/rbac';
import { notify } from '@/lib/notify';

export async function GET(req, { params }) {
  const { id } = await params;
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();

  const emp = await Employee.findById(id);
  if (!emp) return fail('Employee not found', 404);

  // Everyone (except admins) can view anyone in their permitted departments
  if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) {
    if (!await canAccessDepartment(user, emp.department)) {
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
  const ip = req.headers.get('x-forwarded-for') || '';

  let validated;
  if (isAdmin) {
    const validation = validateRequest(UpdateEmployeeSchema, body);
    if (!validation.valid) {
      auditLog('Employee Update Failed', 'Employees', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, existing.userId);
      return fail('Validation failed: ' + validation.error, 400);
    }
    validated = validation.data;
  } else {
    const allowedFields = ['phone', 'avatar', 'skills', 'designation'];
    const filtered = {};
    allowedFields.forEach(field => { if (field in body) filtered[field] = body[field]; });
    const validation = validateRequest(UpdateEmployeeSchema.partial(), filtered);
    if (!validation.valid) {
      auditLog('Employee Update Failed', 'Employees', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, existing.userId);
      return fail('Validation failed: ' + validation.error, 400);
    }
    validated = validation.data;
  }

  if (validated.role === 'super_admin' && user.role !== 'super_admin') {
    auditLog('Employee Update Failed', 'Employees', user._id, 'Attempted to set role to super_admin', 'medium', ip, null, existing.userId);
    return fail('Only the employer can create employer accounts', 403);
  }

  // Track changes for audit log
  const changes = [];
  Object.keys(validated).forEach(key => {
    if (existing[key] !== validated[key]) {
      changes.push(`${key}: ${existing[key]} → ${validated[key]}`);
    }
  });

  const emp = await Employee.findByIdAndUpdate(id, validated, { new: true });
  if (!emp) return fail('Employee not found', 404);

  if (validated.shift !== undefined || validated.shiftId !== undefined) {
    const shiftChanged =
      (validated.shift !== undefined && validated.shift !== existing.shift) ||
      (validated.shiftId && validated.shiftId.toString() !== existing.shiftId?.toString());
    if (shiftChanged) {
      await notify(existing.userId, 'Shift Changed', `Your shift has been changed to ${validated.shift || 'the new shift'}.`, 'shift', existing.shiftId || validated.shiftId || null);
    }
  }

  // Sync key fields back to User for auth/display consistency
  const syncFields = {};
  if ('name' in validated) syncFields.name = validated.name;
  if ('department' in validated) syncFields.department = validated.department;
  if ('designation' in validated) syncFields.designation = validated.designation;
  if ('role' in validated) syncFields.role = validated.role;
  if ('status' in validated) syncFields.status = validated.status;
  if ('shift' in validated) syncFields.shift = validated.shift;
  if ('shiftId' in validated) syncFields.shiftId = validated.shiftId;
  if ('joinDate' in validated) syncFields.joinDate = validated.joinDate;
  if ('shift' in validated && !('shiftId' in validated)) {
    const shiftDoc = await Shift.findOne({ name: validated.shift || 'Morning (9AM-6PM)' }).lean();
    if (shiftDoc) syncFields.shiftId = shiftDoc._id;
  }
  if (Object.keys(syncFields).length > 0) {
    await User.findByIdAndUpdate(emp.userId, syncFields);
  }

  // Audit log
  await auditLog(
    'Employee Updated',
    'Employees',
    user._id,
    `Updated employee ${emp.name} (ID: ${id}). Changes: ${changes.join('; ')}`,
    'low',
    req.headers.get('x-forwarded-for') || '',
    changes,
    emp.userId
  );

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

  // Audit log with high severity
  await auditLog(
    'Employee Deleted',
    'Employees',
    user._id,
    `Deleted employee ${emp.name} (${emp.email})`,
    'high',
    req.headers.get('x-forwarded-for') || '',
    null,
    emp.userId
  );

  return ok({ deleted: true });
}
