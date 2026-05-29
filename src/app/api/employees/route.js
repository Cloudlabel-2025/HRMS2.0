import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';
import { employeeScopeFilter, hasAccess } from '@/lib/rbac';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'employees')) return fail('Access denied', 403);
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const dept   = searchParams.get('department');
    const role   = searchParams.get('role');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    // Base scope — enforced by role
    const query = employeeScopeFilter(user);

    if (dept)   query.department = dept;
    if (role)   query.role = role;
    if (status) query.status = status;
    if (search) query.$or = [
      { name:        { $regex: search, $options: 'i' } },
      { email:       { $regex: search, $options: 'i' } },
      { department:  { $regex: search, $options: 'i' } },
      { designation: { $regex: search, $options: 'i' } },
    ];

    const employees = await User.find(query)
      .select('-password -loginAttempts -lockUntil')
      .sort({ createdAt: -1 });
    return ok(employees);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const body = await req.json();
    if (!body.password) return fail('Password is required');

    const employee = await User.create(body);

    await AuditLog.create({
      action: `Employee Added: ${employee.name}`, module: 'Employees',
      userId: user._id, severity: 'medium',
    });
    return ok(employee, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Email already exists');
    return fail(e.message, 500);
  }
}
