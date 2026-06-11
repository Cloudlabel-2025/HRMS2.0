import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CORE_HR_WRITE_ROLES, CORE_HR_ADMIN_ROLES, CORE_HR_MANAGER_ROLES } from '@/lib/core/constants';
import { buildChangeSet, sanitizeProfileRecord } from '@/lib/core/privacy';
import { recordLifecycleHistory } from '@/lib/core/history';
import { CreateEmploymentProfileSchema, validateRequest } from '@/lib/validation';

function syncAuthUserFromProfile(identity, profile) {
  if (!identity?.authUserId) return null;
  return User.findByIdAndUpdate(identity.authUserId, {
    identityId: identity._id,
    profileId: profile._id,
    department: profile.department,
    designation: profile.designation,
    shift: profile.shift,
    status: profile.employmentStatus === 'retired' ? 'alumni' : profile.employmentStatus === 'resigned' || profile.employmentStatus === 'terminated' ? 'inactive' : 'active',
  });
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    const canReadCoreHr = CORE_HR_ADMIN_ROLES.includes(user.role) || CORE_HR_MANAGER_ROLES.includes(user.role);
    if (!canReadCoreHr) return fail('Access denied', 403);

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const department = searchParams.get('department') || '';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 25)));

    const query = {};
    if (status) query.employmentStatus = status;
    if (department) query.department = department;

    const filters = [];

    if (!CORE_HR_ADMIN_ROLES.includes(user.role)) {
      const userIdentityId = (user.identityId || user._id).toString();
      if (user.role === 'team_lead') {
        filters.push({ $or: [
          { department: user.department },
          { 'reportingLine.teamLeadIdentityId': userIdentityId },
        ]});
      } else if (user.role === 'team_admin') {
        filters.push({ $or: [
          { department: user.department },
          { 'reportingLine.teamAdminIdentityId': userIdentityId },
          { 'reportingLine.teamLeadIdentityId': userIdentityId },
        ]});
      }
    }

    if (search) {
      filters.push({ $or: [
        { employeeNumber: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { designation: { $regex: search, $options: 'i' } },
        { workLocation: { $regex: search, $options: 'i' } },
        { 'identityId.legalName': { $regex: search, $options: 'i' } },
        { 'identityId.primaryEmail': { $regex: search, $options: 'i' } },
      ]});
    }

    if (filters.length) query.$and = filters;

    const [items, total] = await Promise.all([
      EmpProfile.find(query)
        .populate('identityId', 'identityCode legalName primaryEmail preferredName recordStatus authUserId')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      EmpProfile.countDocuments(query),
    ]);

    return ok({
      items: items.map(sanitizeProfileRecord),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_WRITE_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const body = await req.json();
    const validation = validateRequest(CreateEmploymentProfileSchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const identity = await UsrIdentity.findById(validation.data.identityId);
    if (!identity) return fail('Identity not found', 404);

    const existing = await EmpProfile.findOne({ identityId: identity._id });
    if (existing) return fail('Employment profile already exists for this identity', 409);

    const employeeNumber = await EmpProfile.generateEmployeeNumber(validation.data.hireDate);
    const profile = await EmpProfile.create({
      ...validation.data,
      employeeNumber,
      identityId: identity._id,
      employmentStatus: validation.data.employmentStatus || 'onboarding',
      compensationSnapshot: validation.data.compensationSnapshot || { currency: 'INR', grade: '', payGroup: '', band: '' },
      reportingLine: validation.data.reportingLine || {},
      separation: validation.data.separation || undefined,
    });

    await syncAuthUserFromProfile(identity, profile);

    const requestId = req.headers.get('x-request-id') || '';
    const ip = req.headers.get('x-forwarded-for') || '';

    await recordLifecycleHistory({
      entityType: 'profile',
      entityId: profile._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'create',
      action: 'Create employment profile',
      toState: profile.employmentStatus,
      changes: buildChangeSet({}, profile.toObject(), ['employeeNumber', 'employmentType', 'employmentStatus', 'department', 'designation', 'businessUnit', 'workLocation', 'shift']),
      reason: 'Initial employment profile creation',
      actorUserId: user._id,
      actorRole: user.role,
      ip,
      requestId,
      metadata: { source: 'core.profile.create' },
    });

    await auditLog('Core Profile Created', 'EmploymentProfile', user._id, `Created profile ${profile.employeeNumber} for ${identity.legalName}`, 'medium', ip);

    return ok({ profile: sanitizeProfileRecord(profile) }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Employment profile already exists', 409);
    return fail(e.message, 500);
  }
}