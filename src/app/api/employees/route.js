import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog, Employee, Department } from '@/lib/models/index';
import { hasAccess } from '@/lib/rbac';
import { CreateEmployeeSchema, validateRequest } from '@/lib/validation';

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

    const query = {};

    // Scope by role — everyone (except admins) sees their own department
    if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) {
      query.department = user.department;
    } else if (dept) {
      query.department = dept;
    }

    if (role)   query.role = role;
    if (status) query.status = status;
    if (search) query.$or = [
      { name:        { $regex: search, $options: 'i' } },
      { email:       { $regex: search, $options: 'i' } },
      { department:  { $regex: search, $options: 'i' } },
      { designation: { $regex: search, $options: 'i' } },
    ];

    const employees = await Employee.find(query).sort({ department: 1, createdAt: -1 });
    return ok(employees);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'recruiter'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const body = await req.json();
    
    // Validate request against schema
    const validation = validateRequest(CreateEmployeeSchema, body);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }
    
    const validated = validation.data;

    // Check if email already exists
    const existingUser = await User.findOne({ email: validated.email });
    if (existingUser) return fail('Email already exists', 409);

    // Generate temporary password if not provided
    let generatedPassword = null;
    if (!validated.password) {
      const crypto = await import('crypto');
      generatedPassword = crypto.randomBytes(4).toString('hex');
      validated.password = generatedPassword;
    }

    // 1. Create User record for authentication
    const authUser = await User.create({
      name:     validated.name,
      email:    validated.email,
      password: validated.password,
      role:     validated.role, // Already validated by schema
      department:  validated.department,
      designation: validated.designation,
      isFirstLogin: true,
    });

    // Auto-create department if it doesn't exist
    if (validated.department) {
      const exists = await Department.findOne({ name: validated.department });
      if (!exists) {
        await Department.create({ name: validated.department, head: '', members: 0 });
      }
    }

    // 2. Create Employee record
    const employee = await Employee.create({
      userId:      authUser._id,
      name:        validated.name,
      email:       validated.email,
      phone:       validated.phone || '',
      department:  validated.department,
      designation: validated.designation || '',
      role:        validated.role,
      shift:       validated.shift || 'Morning (9AM-6PM)',
      skills:      validated.skills || [],
      joinDate:    validated.joinDate || null,
      status:      validated.status || 'active',
      teamLeadId:  validated.teamLeadId || null,
      teamAdminId: validated.teamAdminId || null,
      smeId:       validated.smeId || null,
    });

    // Update department member count
    if (validated.department) {
      await Department.findOneAndUpdate(
        { name: validated.department },
        { $inc: { members: 1 } }
      );
    }

    // Audit log
    await AuditLog.create({
      action: 'Employee Created',
      module: 'Employees',
      userId: user._id,
      details: `Created: ${employee.name} (${employee.email}), Role: ${employee.role}`,
      severity: 'medium',
      ip: req.headers.get('x-forwarded-for') || '',
    });

    return ok({
      employee,
      tempPassword: generatedPassword,
      message: generatedPassword
        ? 'Employee created. Temporary password: ' + generatedPassword
        : 'Employee created successfully'
    }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Email already exists');
    return fail(e.message, 500);
  }
}
