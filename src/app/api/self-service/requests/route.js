import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { SelfServiceRequest } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CORE_HR_ADMIN_ROLES } from '@/lib/core/constants';
import { CreateSelfServiceRequestSchema, validateRequest } from '@/lib/validation';
import { notify } from '@/lib/notify';

function normalizePayload(requestType, payload) {
  if (requestType === 'profile_update') {
    return {
      preferredName: payload.preferredName || '',
      personalPhone: payload.personalPhone || '',
      secondaryPhone: payload.secondaryPhone || '',
    };
  }

  if (requestType === 'address_update') {
    return {
      addressHistory: Array.isArray(payload.addressHistory) ? payload.addressHistory : [],
    };
  }

  if (requestType === 'emergency_contact_update') {
    return {
      emergencyContacts: Array.isArray(payload.emergencyContacts) ? payload.emergencyContacts : [],
    };
  }

  if (requestType === 'resignation') {
    return {
      separationType: 'resignation',
      noticePeriodDays: Number(payload.noticePeriodDays || 0),
      lastWorkingDate: payload.lastWorkingDate || null,
      settlementStatus: payload.settlementStatus || 'pending',
      exitInterviewComplete: !!payload.exitInterviewComplete,
    };
  }

  return payload;
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope') || 'my';
    const status = searchParams.get('status') || '';

    const query = {};
    if (status) query.status = status;

    if (CORE_HR_ADMIN_ROLES.includes(user.role)) {
      const profileId = searchParams.get('profileId');
      if (profileId) query.profileId = profileId;
    } else {
      query.identityId = user.identityId || null;
    }

    const requests = await SelfServiceRequest.find(query).sort({ createdAt: -1 }).limit(50);
    return ok({ requests });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const body = await req.json();
    const validation = validateRequest(CreateSelfServiceRequestSchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const identityId = user.identityId;
    if (!identityId) return fail('Identity link not found for this user', 404);

    const identity = await UsrIdentity.findById(identityId);
    if (!identity) return fail('Identity not found', 404);

    const profile = await EmpProfile.findOne({ identityId: identity._id });
    if (!profile) return fail('Employment profile not found', 404);

    if (body.requestType === 'resignation' && ['resigned', 'terminated', 'retired', 'alumni'].includes(profile.employmentStatus)) {
      return fail('This profile is already separated', 400);
    }

    const existingPending = await SelfServiceRequest.findOne({ identityId: identity._id, status: 'pending', requestType: body.requestType });
    if (existingPending) return fail('You already have a pending request of this type', 409);

    const request = await SelfServiceRequest.create({
      identityId: identity._id,
      profileId: profile._id,
      requestType: body.requestType,
      payload: normalizePayload(body.requestType, body.payload || {}),
      reason: body.reason,
      requestSource: 'employee',
    });

    await auditLog('Self-Service Request Created', 'SelfService', user._id, `Created ${body.requestType} request`, 'low', req.headers.get('x-forwarded-for') || '');

    // Notify all HR admins
    const hrAdmins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id');
    const typeLabel = body.requestType.replace(/_/g, ' ');
    await notify(
      hrAdmins.map(a => a._id),
      `New Self-Service Request — ${typeLabel}`,
      `${identity.legalName} has submitted a ${typeLabel} request. Reason: ${body.reason}`,
      'self_service',
      request._id
    );

    return ok({ request }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}