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
import { UpdateCoreIdentitySchema, validateRequest } from '@/lib/validation';

function isSelf(identity, user) {
  return identity?.authUserId && identity.authUserId.toString() === user._id.toString();
}

function buildUpdatePayload(existing, body) {
  const next = {
    legalFirstName: body.legalFirstName ?? existing.legalFirstName,
    legalMiddleName: body.legalMiddleName ?? existing.legalMiddleName,
    legalLastName: body.legalLastName ?? existing.legalLastName,
    preferredName: body.preferredName ?? existing.preferredName,
    primaryEmail: body.primaryEmail ?? existing.primaryEmail,
    personalPhone: body.personalPhone ?? existing.personalPhone,
    secondaryPhone: body.secondaryPhone ?? existing.secondaryPhone,
    dateOfBirth: body.dateOfBirth ?? existing.dateOfBirth,
    gender: body.gender ?? existing.gender,
    maritalStatus: body.maritalStatus ?? existing.maritalStatus,
    nationality: body.nationality ?? existing.nationality,
    bloodGroup: body.bloodGroup ?? existing.bloodGroup,
    addressHistory: body.addressHistory ?? existing.addressHistory,
    emergencyContacts: body.emergencyContacts ?? existing.emergencyContacts,
    recordStatus: body.recordStatus ?? existing.recordStatus,
    sourceSystem: body.sourceSystem ?? existing.sourceSystem,
    notes: body.notes ?? existing.notes,
  };

  if (body.identifiers) {
    next.identifiers = { ...existing.identifiers };
    if (body.identifiers.panNumber !== undefined) {
      next.identifiers.pan = buildSensitiveIdentifierPayload('pan', body.identifiers.panNumber);
    }
    if (body.identifiers.aadhaarNumber !== undefined) {
      next.identifiers.aadhaar = buildSensitiveIdentifierPayload('aadhaar', body.identifiers.aadhaarNumber);
    }
  } else {
    next.identifiers = existing.identifiers;
  }

  return next;
}

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const identity = await UsrIdentity.findById(id);
    if (!identity) return fail('Identity not found', 404);

    if (!CORE_HR_ADMIN_ROLES.includes(user.role) && !isSelf(identity, user)) {
      return fail('Access denied', 403);
    }

    return ok({ identity: sanitizeIdentityRecord(identity) });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const existing = await UsrIdentity.findById(id);
    if (!existing) return fail('Identity not found', 404);

    const body = await req.json();
    const validation = validateRequest(UpdateCoreIdentitySchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const canWriteAll = CORE_HR_WRITE_ROLES.includes(user.role);
    const selfUpdate = isSelf(existing, user);

    if (!canWriteAll && !selfUpdate) {
      return fail('Access denied', 403);
    }

    const restrictedFieldsForSelf = ['legalFirstName', 'legalMiddleName', 'legalLastName', 'primaryEmail', 'gender', 'maritalStatus', 'identifiers', 'recordStatus', 'sourceSystem'];
    if (selfUpdate && !canWriteAll) {
      const touchedRestricted = restrictedFieldsForSelf.some(field => field in body);
      if (touchedRestricted) return fail('Self-service updates cannot change protected identity fields', 403);
    }

    const updatePayload = buildUpdatePayload(existing.toObject(), validation.data);

    if (validation.data.authUserId && validation.data.authUserId !== existing.authUserId?.toString()) {
      const linkedUser = await User.findById(validation.data.authUserId);
      if (!linkedUser) return fail('Linked auth user not found', 404);
      if (linkedUser.identityId && linkedUser.identityId.toString() !== existing._id.toString()) {
        return fail('Auth user already linked to another identity', 409);
      }
      updatePayload.authUserId = validation.data.authUserId;
    }

    const before = existing.toObject();
    Object.assign(existing, updatePayload);
    await existing.save();

    if (existing.authUserId) {
      await User.findByIdAndUpdate(existing.authUserId, {
        identityId: existing._id,
        name: existing.displayName,
        email: existing.primaryEmail,
      });
    }

    const changes = buildChangeSet(before, existing.toObject(), [
      'legalFirstName',
      'legalMiddleName',
      'legalLastName',
      'preferredName',
      'primaryEmail',
      'personalPhone',
      'secondaryPhone',
      'dateOfBirth',
      'gender',
      'maritalStatus',
      'nationality',
      'bloodGroup',
      'addressHistory',
      'emergencyContacts',
      'recordStatus',
      'sourceSystem',
      'notes',
      'identifiers',
    ], ['identifiers']);

    const requestId = req.headers.get('x-request-id') || '';
    const ip = req.headers.get('x-forwarded-for') || '';

    await recordLifecycleHistory({
      entityType: 'identity',
      entityId: existing._id,
      identityId: existing._id,
      eventType: 'update',
      action: 'Update core identity',
      fromState: before.recordStatus || '',
      toState: existing.recordStatus || '',
      changes,
      reason: 'Identity profile updated',
      actorUserId: user._id,
      actorRole: user.role,
      ip,
      requestId,
      metadata: { source: 'core.identity.update' },
    });

    await auditLog('Core Identity Updated', 'Identity', user._id, `Updated identity ${existing.legalName} (${existing.primaryEmail})`, 'low', ip);

    return ok({ identity: sanitizeIdentityRecord(existing) });
  } catch (e) {
    if (e.code === 11000) return fail('Identity already exists', 409);
    return fail(e.message, 500);
  }
}