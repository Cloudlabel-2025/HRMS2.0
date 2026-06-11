import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CORE_HR_WRITE_ROLES, CORE_HR_ADMIN_ROLES, CORE_HR_MANAGER_ROLES } from '@/lib/core/constants';
import { buildChangeSet, sanitizeProfileRecord } from '@/lib/core/privacy';
import { recordLifecycleHistory } from '@/lib/core/history';
import { UpdateEmploymentProfileSchema, validateRequest } from '@/lib/validation';

function syncAuthUserFromProfile(identity, profile) {
  if (!identity?.authUserId) return null;
  const mappedStatus = profile.employmentStatus === 'retired' ? 'alumni' : profile.employmentStatus === 'resigned' || profile.employmentStatus === 'terminated' ? 'inactive' : 'active';
  return User.findByIdAndUpdate(identity.authUserId, {
    identityId: identity._id,
    profileId: profile._id,
    department: profile.department,
    designation: profile.designation,
    shift: profile.shift,
    status: mappedStatus,
  });
}

function isManagedByUser(profile, user) {
  if (CORE_HR_ADMIN_ROLES.includes(user.role)) return true;
  const userIdentityId = (user.identityId || user._id).toString();
  const teamLeadId = profile?.reportingLine?.teamLeadIdentityId?.toString?.() || '';
  const teamAdminId = profile?.reportingLine?.teamAdminIdentityId?.toString?.() || '';
  const sameDepartment = !!user.department && user.department === profile.department;
  return user.role === 'team_lead'
    ? sameDepartment || teamLeadId === userIdentityId || teamAdminId === userIdentityId
    : user.role === 'team_admin'
      ? sameDepartment || teamAdminId === userIdentityId || teamLeadId === userIdentityId
      : false;
}

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const profile = await EmpProfile.findById(id).populate('identityId', 'identityCode legalName primaryEmail preferredName recordStatus authUserId');
    if (!profile) return fail('Employment profile not found', 404);

    const identity = profile.identityId;
    const self = identity?.authUserId && identity.authUserId.toString() === user._id.toString();
    if (!CORE_HR_ADMIN_ROLES.includes(user.role) && !CORE_HR_MANAGER_ROLES.includes(user.role) && !self) return fail('Access denied', 403);
    if (!CORE_HR_ADMIN_ROLES.includes(user.role) && !self && !isManagedByUser(profile, user)) return fail('Access denied', 403);

    return ok({ profile: sanitizeProfileRecord(profile) });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_WRITE_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const profile = await EmpProfile.findById(id).populate('identityId');
    if (!profile) return fail('Employment profile not found', 404);

    const body = await req.json();
    const validation = validateRequest(UpdateEmploymentProfileSchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const before = profile.toObject();
    const next = {
      ...before,
      ...validation.data,
      reportingLine: validation.data.reportingLine || before.reportingLine,
      compensationSnapshot: validation.data.compensationSnapshot || before.compensationSnapshot,
      separation: validation.data.separation || before.separation,
    };

    if (validation.data.identityId && validation.data.identityId !== profile.identityId?._id?.toString()) {
      const newIdentity = await UsrIdentity.findById(validation.data.identityId);
      if (!newIdentity) return fail('Identity not found', 404);
      const existingProfile = await EmpProfile.findOne({ identityId: newIdentity._id });
      if (existingProfile && existingProfile._id.toString() !== profile._id.toString()) {
        return fail('Another profile already exists for this identity', 409);
      }
      profile.identityId = newIdentity._id;
      next.identityId = newIdentity._id;
    }

    Object.assign(profile, next);
    await profile.save();

    const identity = profile.identityId?.authUserId ? profile.identityId : await UsrIdentity.findById(profile.identityId);
    if (identity) {
      await syncAuthUserFromProfile(identity, profile);
    }

    const updated = profile.toObject();
    const changes = buildChangeSet(before, updated, [
      'employmentType',
      'employmentStatus',
      'department',
      'designation',
      'businessUnit',
      'workLocation',
      'shift',
      'hireDate',
      'probationStartDate',
      'probationEndDate',
      'confirmationDate',
      'rehireCount',
      'originalHireDate',
      'reportingLine',
      'compensationSnapshot',
      'separation',
      'sourceSystem',
      'notes',
    ]);

    const requestId = req.headers.get('x-request-id') || '';
    const ip = req.headers.get('x-forwarded-for') || '';

    const statusChanged = before.employmentStatus !== updated.employmentStatus;
    await recordLifecycleHistory({
      entityType: 'profile',
      entityId: profile._id,
      identityId: profile.identityId?._id || profile.identityId || null,
      profileId: profile._id,
      eventType: statusChanged ? 'status_change' : 'update',
      action: statusChanged ? 'Update employment status' : 'Update employment profile',
      fromState: before.employmentStatus || '',
      toState: updated.employmentStatus || '',
      changes,
      reason: statusChanged ? 'Employment lifecycle transition' : 'Employment profile updated',
      actorUserId: user._id,
      actorRole: user.role,
      ip,
      requestId,
      metadata: { source: 'core.profile.update' },
    });

    await auditLog('Core Profile Updated', 'EmploymentProfile', user._id, `Updated profile ${profile.employeeNumber}`, 'low', ip);

    return ok({ profile: sanitizeProfileRecord(profile) });
  } catch (e) {
    if (e.code === 11000) return fail('Employment profile already exists', 409);
    return fail(e.message, 500);
  }
}