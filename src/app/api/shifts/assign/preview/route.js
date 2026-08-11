import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { Shift } from '@/lib/models/index';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ShiftAssignSchema, validateRequest } from '@/lib/validation';
import { computeTargetUserIds } from '@/lib/shift-assign';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const body = await req.json();
    const validation = validateRequest(ShiftAssignSchema, body);
    if (!validation.valid) return fail('Validation failed: ' + validation.error, 400);
    if (!validation.data.reason?.trim()) return fail('Reason is required', 400);

    const { shiftId, targets } = validation.data;

    const shiftDoc = await Shift.findById(shiftId);
    if (!shiftDoc) return fail('Target shift not found', 404);

    const userIds = await computeTargetUserIds({
      userIds: targets?.userIds || [],
      departments: targets?.departments || [],
      roles: targets?.roles || [],
      fromShiftId: targets?.fromShiftId || null,
    });

    let users = [];
    if (userIds.length) {
      users = await User.find({ _id: { $in: userIds } })
        .select('_id name email department role shift shiftId identityId')
        .lean();

      // Enrich best-effort with employeeNumber from the core profile
      const identityIds = users.map(u => u.identityId).filter(Boolean);
      if (identityIds.length) {
        try {
          const profiles = await EmpProfile.find({ identityId: { $in: identityIds } })
            .select('identityId employeeNumber')
            .lean();
          const profileMap = {};
          for (const p of profiles) profileMap[String(p.identityId)] = p;
          users = users.map(u => ({
            ...u,
            employeeNumber: u.identityId ? (profileMap[String(u.identityId)]?.employeeNumber || '') : '',
          }));
        } catch (e) {
          console.error('Preview profile enrichment failed (non-fatal):', e.message);
        }
      }
    }

    return ok({
      count: users.length,
      shiftName: shiftDoc.name,
      users: users.map(u => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        department: u.department,
        shift: u.shift,
        employeeNumber: u.employeeNumber || '',
      })),
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
