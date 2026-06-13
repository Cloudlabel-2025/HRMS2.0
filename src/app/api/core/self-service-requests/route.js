import dbConnect from '@/lib/db';
import { requireAuth, auditLog, } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { notify } from '@/lib/notify';
import { CORE_HR_WRITE_ROLES } from '@/lib/core/constants';
import { SelfServiceRequest, EmpProfile, UsrIdentity, Employee } from '@/lib/models/index';
import User from '@/lib/models/User';
import { recordLifecycleHistory } from '@/lib/core/history';
import { ReviewSelfServiceRequestSchema, validateRequest } from '@/lib/validation';

function syncLegacy(identity, profile, userStatus) {
  return Promise.all([
    identity.authUserId ? User.findByIdAndUpdate(identity.authUserId, {
      identityId: identity._id,
      profileId: profile._id,
      name: identity.displayName || identity.legalName,
      email: identity.primaryEmail,
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      status: userStatus,
    }) : null,
    Employee.findOneAndUpdate({ userId: identity.authUserId }, {
      name: identity.displayName || identity.legalName,
      email: identity.primaryEmail,
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      status: userStatus,
    }),
  ]);
}

async function applyApprovedRequest(request, reviewer) {
  const profile = await EmpProfile.findById(request.profileId);
  if (!profile) throw new Error('Employment profile not found');
  const identity = await UsrIdentity.findById(request.identityId);
  if (!identity) throw new Error('Identity not found');

  if (request.requestType === 'profile_update') {
    identity.preferredName = request.payload.preferredName || identity.preferredName;
    identity.personalPhone = request.payload.personalPhone || identity.personalPhone;
    identity.secondaryPhone = request.payload.secondaryPhone || identity.secondaryPhone;
    await identity.save();
    await syncLegacy(identity, profile, profile.employmentStatus === 'active' ? 'active' : 'inactive');
    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service profile update',
      fromState: identity.recordStatus || '',
      toState: identity.recordStatus || '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-profile-update' },
    });
  }

  if (request.requestType === 'address_update') {
    identity.addressHistory = request.payload.addressHistory || [];
    await identity.save();
    await recordLifecycleHistory({
      entityType: 'address',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service address update',
      fromState: '',
      toState: '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-address-update' },
    });
  }

  if (request.requestType === 'emergency_contact_update') {
    identity.emergencyContacts = request.payload.emergencyContacts || [];
    await identity.save();
    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: identity._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'update',
      action: 'Approved self-service emergency contact update',
      fromState: '',
      toState: '',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-emergency-contact-update' },
    });
  }

  if (request.requestType === 'resignation') {
    profile.employmentStatus = 'resigned';
    profile.separation = {
      separationType: 'resignation',
      reason: request.reason,
      noticePeriodDays: request.payload.noticePeriodDays || 0,
      lastWorkingDate: request.payload.lastWorkingDate || null,
      settlementStatus: request.payload.settlementStatus || 'pending',
      exitInterviewComplete: !!request.payload.exitInterviewComplete,
      approvedByUserId: reviewer._id,
      approvedAt: new Date(),
      clearedAt: request.payload.settlementStatus === 'settled' ? new Date() : null,
    };
    await profile.save();
    identity.recordStatus = 'archived';
    await identity.save();
    const userStatus = 'inactive';
    await syncLegacy(identity, profile, userStatus);
    if (identity.authUserId) {
      await User.findByIdAndUpdate(identity.authUserId, { status: userStatus, identityId: identity._id, profileId: profile._id });
    }
    await recordLifecycleHistory({
      entityType: 'separation',
      entityId: profile._id,
      identityId: identity._id,
      profileId: profile._id,
      eventType: 'separation',
      action: 'Approved self-service resignation',
      fromState: 'active',
      toState: 'resigned',
      changes: [],
      reason: request.reason,
      actorUserId: reviewer._id,
      actorRole: reviewer.role,
      metadata: { requestId: request._id.toString(), source: 'self-service-resignation' },
    });
  }
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_WRITE_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    const requestType = searchParams.get('requestType') || '';
    const query = { status };
    if (requestType) query.requestType = requestType;

    const requests = await SelfServiceRequest.find(query)
      .populate('identityId', 'legalName primaryEmail displayName')
      .populate('profileId', 'employeeNumber employmentStatus department designation')
      .populate('reviewerUserId', 'name')
      .sort({ createdAt: -1 })
      .limit(100);
    return ok({ requests });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_WRITE_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const body = await req.json();
    const validation = validateRequest(ReviewSelfServiceRequestSchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const request = await SelfServiceRequest.findById(body.id);
    if (!request) return fail('Request not found', 404);
    if (request.status !== 'pending') return fail('Request already processed', 400);

    request.status = validation.data.action;
    request.reviewerUserId = user._id;
    request.reviewedAt = new Date();
    request.reviewNote = validation.data.reviewNote || '';
    await request.save();

    if (validation.data.action === 'approved') {
      await applyApprovedRequest(request, user);
    }

    // Notify the employee
    const identity = await (await import('@/lib/models/Identity')).default.findById(request.identityId).select('authUserId legalName');
    if (identity?.authUserId) {
      const typeLabel = request.requestType.replace(/_/g, ' ');
      const approved = validation.data.action === 'approved';
      await notify(
        identity.authUserId,
        approved ? `Request Approved — ${typeLabel}` : `Request Rejected — ${typeLabel}`,
        approved
          ? `Your ${typeLabel} request has been approved.${validation.data.reviewNote ? ' Note: ' + validation.data.reviewNote : ''}`
          : `Your ${typeLabel} request was rejected.${validation.data.reviewNote ? ' Reason: ' + validation.data.reviewNote : ''}`,
        'general',
        request._id
      );
    }

    await auditLog('Self-Service Request Reviewed', 'SelfService', user._id, `${validation.data.action} ${request.requestType} request`, validation.data.action === 'approved' ? 'medium' : 'low', req.headers.get('x-forwarded-for') || '', null, identity?.authUserId || null);
    return ok({ request });
  } catch (e) {
    return fail(e.message, 500);
  }
}