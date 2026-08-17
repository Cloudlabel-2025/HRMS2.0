import { requirePortalAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import UsrIdentity from '@/lib/models/Identity';

export async function GET(req) {
  try {
    const { user, profile, portalAccess, error } = await requirePortalAuth(req);
    if (error) return error;
    if (portalAccess !== 'alumni' || !profile) return fail('Alumni access only', 403);

    const identity = user.identityId
      ? await UsrIdentity.findById(user.identityId).select('legalName preferredName displayName primaryEmail personalPhone')
      : null;
    const separation = profile.separation || {};

    return ok({
      person: {
        name: identity?.displayName || identity?.preferredName || identity?.legalName || user.name,
        legalName: identity?.legalName || user.name,
        email: identity?.primaryEmail || user.email,
        phone: identity?.personalPhone || user.phone || '',
      },
      employment: {
        employeeNumber: profile.employeeNumber,
        employmentStatus: profile.employmentStatus,
        department: profile.department,
        designation: profile.designation,
        hireDate: profile.hireDate,
        separationType: separation.separationType,
        reason: separation.reason,
        noticePeriodDays: separation.noticePeriodDays,
        lastWorkingDate: separation.lastWorkingDate,
        settlementStatus: separation.settlementStatus,
        exitInterviewComplete: separation.exitInterviewComplete,
        clearedAt: separation.clearedAt,
        clearanceChecklist: separation.clearanceChecklist || {},
        isLocked: profile.isLocked,
      },
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
