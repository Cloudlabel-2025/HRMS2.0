import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { SelfServiceRequest } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { sanitizeIdentityRecord, sanitizeProfileRecord } from '@/lib/core/privacy';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const identityId = user.identityId || null;
    if (!identityId) return fail('Identity link not found for this user', 404);

    const identity = await UsrIdentity.findById(identityId);
    if (!identity) return fail('Identity not found', 404);

    const profile = await EmpProfile.findOne({ identityId: identity._id }).populate('identityId');
    const requests = await SelfServiceRequest.find({ identityId: identity._id }).sort({ createdAt: -1 }).limit(20);

    return ok({
      identity: sanitizeIdentityRecord(identity),
      profile: sanitizeProfileRecord(profile),
      requests,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}