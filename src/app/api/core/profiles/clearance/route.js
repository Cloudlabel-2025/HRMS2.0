import dbConnect from '@/lib/db';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const CLEARANCE_FIELDS = ['assetReturned','accessRevoked','finalSettlement','exitInterviewDone','nocIssued','relievingLetter'];

export async function PATCH(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const { profileId, field, value } = await req.json();
    if (!profileId) return fail('profileId is required', 400);
    if (!CLEARANCE_FIELDS.includes(field)) return fail('Invalid clearance field', 400);

    const profile = await EmpProfile.findById(profileId);
    if (!profile) return fail('Profile not found', 404);

    const separated = ['resigned','terminated','retired','alumni'].includes(profile.employmentStatus);
    if (!separated) return fail('Clearance checklist only applies to separated employees', 400);

    if (!profile.separation) profile.separation = {};
    if (!profile.separation.clearanceChecklist) profile.separation.clearanceChecklist = {};
    profile.separation.clearanceChecklist[field] = !!value;

    // Auto-lock when all fields are checked AND settlement is settled
    const cl = profile.separation.clearanceChecklist;
    const allDone = CLEARANCE_FIELDS.every(f => !!cl[f]);
    if (allDone && profile.separation.settlementStatus === 'settled') {
      profile.isLocked = true;
      profile.separation.clearedAt = new Date();
    }

    profile.markModified('separation');
    await profile.save();

    const ip = req.headers.get('x-forwarded-for') || '';
    await auditLog('Clearance Updated', 'EmploymentProfile', user._id,
      `${field}=${value} for ${profile.employeeNumber}`, 'medium', ip);

    return ok({ checklist: profile.separation.clearanceChecklist, isLocked: profile.isLocked });
  } catch (e) {
    return fail(e.message, 500);
  }
}
