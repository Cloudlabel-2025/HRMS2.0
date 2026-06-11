import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog, Employee, Department } from '@/lib/models/index';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { hasAccess } from '@/lib/rbac';
import { CreateEmployeeSchema, validateRequest } from '@/lib/validation';
import { recordLifecycleHistory } from '@/lib/core/history';

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

    const ip = req.headers.get('x-forwarded-for') || '';

    // 3-5. Auto-create Core Identity + Profile (non-blocking — employee already saved)
    try {
      const nameParts = validated.name.trim().replace(/\s+/g, ' ').split(' ');
      const identity = await UsrIdentity.create({
        authUserId:      authUser._id,
        legalFirstName:  nameParts[0] || validated.name,
        legalMiddleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '',
        legalLastName:   nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
        preferredName:   validated.name,
        primaryEmail:    validated.email,
        personalPhone:   validated.phone || '',
        gender:          'prefer_not_to_say',
        maritalStatus:   'prefer_not_to_say',
        nationality:     'Indian',
        sourceSystem:    'manual',
      });

      const year = validated.joinDate ? new Date(validated.joinDate).getFullYear() : new Date().getFullYear();
      const count = await EmpProfile.countDocuments();
      const employeeNumber = `CHC-${year}-${String(count + 1).padStart(4, '0')}`;

      const profile = await EmpProfile.create({
        identityId:       identity._id,
        employeeNumber,
        employmentType:   'full_time',
        employmentStatus: 'onboarding',
        department:       validated.department,
        designation:      validated.designation || '',
        shift:            validated.shift || 'Morning (9AM-6PM)',
        hireDate:         validated.joinDate || null,
        sourceSystem:     'manual',
      });

      await User.findByIdAndUpdate(authUser._id, {
        identityId: identity._id,
        profileId:  profile._id,
      });

      await recordLifecycleHistory({
        entityType:  'profile',
        entityId:    profile._id,
        identityId:  identity._id,
        profileId:   profile._id,
        eventType:   'create',
        action:      'Create employment profile',
        toState:     profile.employmentStatus,
        changes:     [],
        reason:      'Auto-created on employee registration',
        actorUserId: user._id,
        actorRole:   user.role,
        ip,
        metadata:    { source: 'employee.register.auto' },
      });
    } catch (coreErr) {
      console.error('Core profile auto-creation failed (non-fatal):', coreErr.message);
      // Still return success — employee login works, core profile can be created manually from Core HR
    }

    // Audit log
    await auditLog('Employee Created', 'Employees', user._id, `Created: ${employee.name} (${employee.email}), Role: ${employee.role}`, 'medium', ip);

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
