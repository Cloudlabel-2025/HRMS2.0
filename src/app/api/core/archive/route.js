import dbConnect from '@/lib/db';
import EmpProfile from '@/lib/models/EmploymentProfile';
import UsrIdentity from '@/lib/models/Identity';
import User from '@/lib/models/User';
import { Employee } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { recordLifecycleHistory } from '@/lib/core/history';

const SEPARATED_STATUSES = ['resigned', 'terminated', 'retired'];

function retentionDateQuery(cutoff) {
  return {
    $or: [
      { 'separation.clearedAt': { $lt: cutoff } },
      { 'separation.clearedAt': null, 'separation.lastWorkingDate': { $lt: cutoff } },
    ],
  };
}

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
      ...retentionDateQuery(cutoff),
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
      ...retentionDateQuery(cutoff),
    });

    let archived = 0;
    for (const profile of profiles) {
      const fromState = profile.employmentStatus;
      profile.employmentStatus = 'alumni';
      await profile.save();
      if (profile.identityId) {
        const identity = await UsrIdentity.findByIdAndUpdate(profile.identityId, { recordStatus: 'archived' }, { new: true });
        if (identity?.authUserId) {
          await Promise.all([
            User.findByIdAndUpdate(identity.authUserId, { status: 'alumni' }),
            Employee.findOneAndUpdate({ userId: identity.authUserId }, { status: 'alumni' }),
          ]);
        }
        await recordLifecycleHistory({
          entityType: 'employment',
          entityId: profile._id,
          identityId: profile.identityId,
          profileId: profile._id,
          eventType: 'status_change',
          action: 'Archive separated profile',
          fromState,
          toState: 'alumni',
          reason: `Retention period of ${years} year(s) completed`,
          actorUserId: user._id,
          actorRole: user.role,
          metadata: { source: 'retention-archive', cutoff },
        });
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
