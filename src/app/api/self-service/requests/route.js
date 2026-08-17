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
import { getGlobalConfig, getCycleMonth, getCycleRange } from '@/lib/payroll-cycle';

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
    };
  }

  if (requestType === 'permission') {
    return {
      date: payload.date || '',
      startTime: payload.startTime || '',
      endTime: payload.endTime || '',
      duration: Number(payload.duration || 0),
      permissionCountInCycle: Number(payload.permissionCountInCycle || 1),
      isThirdOrMore: !!payload.isThirdOrMore,
      cycleRange: payload.cycleRange || null,
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
    const ip = req.headers.get('x-forwarded-for') || '';
    const validation = validateRequest(CreateSelfServiceRequestSchema, body);
    if (!validation.valid) {
      auditLog('Self-Service Request Failed', 'SelfService', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail(`Validation failed: ${validation.error}`, 400);
    }

    if (user.role === 'super_admin' && body.requestType === 'permission') {
      return fail('Super administrators cannot submit permission requests', 403);
    }

    const identityId = user.identityId;
    if (!identityId) {
      auditLog('Self-Service Request Failed', 'SelfService', user._id, 'Identity link not found', 'low', ip, null, user._id);
      return fail('Identity link not found for this user', 404);
    }

    const identity = await UsrIdentity.findById(identityId);
    if (!identity) {
      auditLog('Self-Service Request Failed', 'SelfService', user._id, 'Identity record not found', 'low', ip, null, user._id);
      return fail('Identity not found', 404);
    }

    const profile = await EmpProfile.findOne({ identityId: identity._id });
    if (!profile) {
      auditLog('Self-Service Request Failed', 'SelfService', user._id, 'Employment profile not found', 'low', ip, null, user._id);
      return fail('Employment profile not found', 404);
    }

    if (body.requestType === 'resignation' && ['notice_period', 'resigned', 'terminated', 'retired', 'alumni'].includes(profile.employmentStatus)) {
      auditLog('Self-Service Request Failed', 'SelfService', user._id, 'Resignation request failed: profile already separated', 'low', ip, null, user._id);
      return fail('This profile is already separated', 400);
    }

    if (body.requestType === 'resignation') {
      const noticePeriodDays = Number(body.payload?.noticePeriodDays || 0);
      const lastWorkingDate = body.payload?.lastWorkingDate;
      if (!Number.isInteger(noticePeriodDays) || noticePeriodDays < 0 || noticePeriodDays > 365) {
        return fail('Notice period must be between 0 and 365 days', 400);
      }
      if (!lastWorkingDate || Number.isNaN(new Date(lastWorkingDate).getTime())) {
        return fail('A valid last working date is required', 400);
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(lastWorkingDate) < today) return fail('Last working date cannot be in the past', 400);
    }

    if (body.requestType === 'permission') {
      const { date, startTime, endTime } = body.payload || {};
      if (!date || !startTime || !endTime) {
        return fail('Date, start time, and end time are required for permission requests', 400);
      }
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) {
        return fail('Invalid start or end time format', 400);
      }
      let durationMins = (eh * 60 + em) - (sh * 60 + sm);
      if (durationMins < 0) durationMins += 24 * 60;

      if (durationMins > 120) {
        return fail('Permission request cannot exceed 2 hours', 400);
      }

      const config = await getGlobalConfig();
      const startDay = config.payrollStartDay || 26;
      const endDay = config.payrollEndDay || 25;
      const { year, month } = getCycleMonth(date, startDay);
      const { fromDate, toDate } = getCycleRange(startDay, endDay, year, month);

      const count = await SelfServiceRequest.countDocuments({
        profileId: profile._id,
        requestType: 'permission',
        status: { $in: ['approved', 'pending'] },
        'payload.date': { $gte: fromDate, $lte: toDate },
      });

      body.payload.duration = durationMins;
      body.payload.permissionCountInCycle = count + 1;
      body.payload.isThirdOrMore = (count + 1) >= 3;
      body.payload.cycleRange = { fromDate, toDate };
    }

    const pendingQuery = { identityId: identity._id, status: 'pending', requestType: body.requestType };
    if (body.requestType === 'permission') {
      pendingQuery['payload.date'] = body.payload?.date;
    }
    const existingPending = await SelfServiceRequest.findOne(pendingQuery);
    if (existingPending) {
      auditLog('Self-Service Request Failed', 'SelfService', user._id, `Already has pending ${body.requestType} request`, 'low', ip, null, user._id);
      return fail(body.requestType === 'permission' ? 'You already have a pending permission request for this date' : 'You already have a pending request of this type', 409);
    }

    const request = await SelfServiceRequest.create({
      identityId: identity._id,
      profileId: profile._id,
      requestType: body.requestType,
      payload: normalizePayload(body.requestType, body.payload || {}),
      reason: body.reason,
      requestSource: 'employee',
    });

    await auditLog('Self-Service Request Created', 'SelfService', user._id, `Created ${body.requestType} request`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);

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
