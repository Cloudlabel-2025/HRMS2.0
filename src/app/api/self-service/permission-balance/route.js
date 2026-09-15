import dbConnect from '@/lib/db';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getPermissionBalance } from '@/lib/permission-allowance';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const identityId = user.identityId;
    if (!identityId) return fail('Identity link not found', 404);
    const identity = await UsrIdentity.findById(identityId);
    if (!identity) return fail('Identity not found', 404);
    const profile = await EmpProfile.findOne({ identityId: identity._id });
    if (!profile) return fail('Employment profile not found', 404);
    const config = await getGlobalConfig();
    const balance = await getPermissionBalance(profile._id, date, config);
    return ok({ balance });
  } catch (e) {
    return fail(e.message, 500);
  }
}
