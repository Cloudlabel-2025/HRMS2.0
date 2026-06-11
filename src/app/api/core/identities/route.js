import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CORE_HR_ADMIN_ROLES, CORE_HR_WRITE_ROLES } from '@/lib/core/constants';
import {
  buildChangeSet,
  buildSensitiveIdentifierPayload,
  sanitizeIdentityRecord,
} from '@/lib/core/privacy';
import { recordLifecycleHistory } from '@/lib/core/history';
import { CreateCoreIdentitySchema, validateRequest } from '@/lib/validation';

function buildIdentityPayload(body) {
  const identifiers = {};
  if (body.identifiers?.panNumber !== undefined) {
    identifiers.pan = buildSensitiveIdentifierPayload('pan', body.identifiers.panNumber);
  }
  if (body.identifiers?.aadhaarNumber !== undefined) {
    identifiers.aadhaar = buildSensitiveIdentifierPayload('aadhaar', body.identifiers.aadhaarNumber);
  }

  return {
    authUserId: body.authUserId || null,
    legalFirstName: body.legalFirstName,
    legalMiddleName: body.legalMiddleName || '',
    legalLastName: body.legalLastName || '',
    preferredName: body.preferredName || '',
    primaryEmail: body.primaryEmail,
    personalPhone: body.personalPhone || '',
    secondaryPhone: body.secondaryPhone || '',
    dateOfBirth: body.dateOfBirth || null,
    gender: body.gender,
    maritalStatus: body.maritalStatus,
    nationality: body.nationality || 'Indian',
    bloodGroup: body.bloodGroup || '',
    identifiers: {
      pan: identifiers.pan || { maskedValue: '', last4: '', hashValue: '', encryptedValue: null, isVerified: false, verifiedAt: null, source: 'manual' },
      aadhaar: identifiers.aadhaar || { maskedValue: '', last4: '', hashValue: '', encryptedValue: null, isVerified: false, verifiedAt: null, source: 'manual' },
    },
    addressHistory: Array.isArray(body.addressHistory) ? body.addressHistory : [],
    emergencyContacts: Array.isArray(body.emergencyContacts) ? body.emergencyContacts : [],
    recordStatus: body.recordStatus || 'active',
    sourceSystem: body.sourceSystem || 'manual',
    notes: body.notes || '',
  };
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 25)));

    const query = {};
    if (status) query.recordStatus = status;
    if (search) {
      query.$or = [
        { legalName: { $regex: search, $options: 'i' } },
        { primaryEmail: { $regex: search, $options: 'i' } },
        { identityCode: { $regex: search, $options: 'i' } },
        { preferredName: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      UsrIdentity.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      UsrIdentity.countDocuments(query),
    ]);

    return ok({
      items: items.map(i => sanitizeIdentityRecord(i, user.role)),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
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
    const validation = validateRequest(CreateCoreIdentitySchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const payload = buildIdentityPayload(validation.data);

    const duplicateIdentity = await UsrIdentity.findOne({ primaryEmail: payload.primaryEmail });
    if (duplicateIdentity) return fail('Identity with this email already exists', 409);

    if (payload.authUserId) {
      const authUser = await User.findById(payload.authUserId);
      if (!authUser) return fail('Linked auth user not found', 404);
      if (authUser.identityId) return fail('Auth user already linked to an identity', 409);
    }

    const identity = await UsrIdentity.create(payload);

    if (payload.authUserId) {
      await User.findByIdAndUpdate(payload.authUserId, {
        identityId: identity._id,
        name: identity.displayName,
        email: identity.primaryEmail,
      });
    }

    const requestId = req.headers.get('x-request-id') || '';
    const ip = req.headers.get('x-forwarded-for') || '';

    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: identity._id,
      identityId: identity._id,
      eventType: 'create',
      action: 'Create core identity',
      toState: identity.recordStatus,
      changes: buildChangeSet({}, identity.toObject(), ['legalName', 'primaryEmail', 'personalPhone', 'secondaryPhone', 'recordStatus', 'sourceSystem']),
      reason: 'Initial identity creation',
      actorUserId: user._id,
      actorRole: user.role,
      ip,
      requestId,
      metadata: { source: 'core.identity.create' },
    });

    await auditLog('Core Identity Created', 'Identity', user._id, `Created identity ${identity.legalName} (${identity.primaryEmail})`, 'medium', ip);

    return ok({ identity: sanitizeIdentityRecord(identity, user.role) }, 201);
  } catch (e) {
    if (e.code === 11000) return fail('Identity already exists', 409);
    return fail(e.message, 500);
  }
}