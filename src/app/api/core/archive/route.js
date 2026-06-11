import dbConnect from '@/lib/db';
import EmpProfile from '@/lib/models/EmploymentProfile';
import UsrIdentity from '@/lib/models/Identity';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const SEPARATED_STATUSES = ['resigned', 'terminated', 'retired'];

// GET /api/core/archive?olderThanYears=N — preview candidates
// POST /api/core/archive { olderThanYears: N } — execute archival
export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const { searchParams } = new URL(req.url);
    const years = Math.max(1, parseInt(searchParams.get('olderThanYears') || '3', 10));
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);

    const candidates = await EmpProfile.find({
      employmentStatus: { $in: SEPARATED_STATUSES },
      isLocked: true,
      updatedAt: { $lt: cutoff },
    }).populate('identityId', 'legalName primaryEmail recordStatus').lean();

    return ok({ count: candidates.length, years, cutoff, candidates: candidates.map(p => ({
      profileId: p._id,
      employeeNumber: p.employeeNumber,
      employmentStatus: p.employmentStatus,
      department: p.department,
      updatedAt: p.updatedAt,
      name: p.identityId?.legalName || '—',
      email: p.identityId?.primaryEmail || '—',
    })) });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (user.role !== 'super_admin') return fail('Only super_admin can execute archival', 403);

    await dbConnect();
    const { olderThanYears = 3 } = await req.json();
    const years = Math.max(1, parseInt(olderThanYears, 10));
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);

    const profiles = await EmpProfile.find({
      employmentStatus: { $in: SEPARATED_STATUSES },
      isLocked: true,
      updatedAt: { $lt: cutoff },
    });

    let archived = 0;
    for (const profile of profiles) {
      profile.employmentStatus = 'alumni';
      await profile.save();
      if (profile.identityId) {
        await UsrIdentity.findByIdAndUpdate(profile.identityId, { recordStatus: 'archived' });
      }
      archived++;
    }

    const ip = req.headers.get('x-forwarded-for') || '';
    await auditLog('Data Retention Archive', 'EmploymentProfile', user._id,
      `Archived ${archived} separated profiles older than ${years} years`, 'high', ip);

    return ok({ archived, years, cutoff });
  } catch (e) {
    return fail(e.message, 500);
  }
}
