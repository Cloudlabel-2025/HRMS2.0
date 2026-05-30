import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog, Employee, Department } from '@/lib/models/index';
import { hasAccess } from '@/lib/rbac';

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
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const body = await req.json();
    
    // Generate temporary password if not provided
    let generatedPassword = null;
    if (!body.password) {
      const crypto = await import('crypto');
      generatedPassword = crypto.randomBytes(4).toString('hex');
      body.password = generatedPassword;
    }

    // 1. Create User record for authentication
    const authUser = await User.create({
      name:     body.name,
      email:    body.email,
      password: body.password,
      role:     body.role || 'employee',
      department:  body.department,
      designation: body.designation,
      isFirstLogin: true,
    });

    // Auto-create department if it doesn't exist
    if (body.department) {
      const exists = await Department.findOne({ name: body.department });
      if (!exists) {
        await Department.create({ name: body.department, head: '', members: 0 });
      }
    }

    // 2. Create Employee record for employee data (organized by department)
    const employee = await Employee.create({
      userId:      authUser._id,
      name:        body.name,
      email:       body.email,
      phone:       body.phone || '',
      department:  body.department,
      designation: body.designation || '',
      role:        body.role || 'employee',
      shift:       body.shift || 'Morning (9AM-6PM)',
      skills:      body.skills || [],
      joinDate:    body.joinDate || null,
      status:      body.status || 'active',
      teamLeadId:  body.teamLeadId || null,
      teamAdminId: body.teamAdminId || null,
      smeId:       body.smeId || null,
    });

    // Update department member count
    await Department.findOneAndUpdate(
      { name: body.department },
      { $inc: { members: 1 } }
    );

    if (generatedPassword) {
      console.log('\n\n===========================================');
      console.log(`NEW EMPLOYEE CREATED: ${employee.email}`);
      console.log(`DEPARTMENT: ${employee.department}`);
      console.log(`TEMPORARY PASSWORD: ${generatedPassword}`);
      console.log('===========================================\n\n');
    }

    await AuditLog.create({
      action: `Employee Added: ${employee.name} (${employee.department})`, module: 'Employees',
      userId: user._id, severity: 'medium',
    });
    return ok({ employee, tempPassword: generatedPassword }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Email already exists');
    return fail(e.message, 500);
  }
}
