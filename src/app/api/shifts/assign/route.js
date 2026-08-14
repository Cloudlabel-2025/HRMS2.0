import dbConnect from '@/lib/db';
import { Shift, ShiftChange } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { ShiftAssignSchema, validateRequest } from '@/lib/validation';
import { computeTargetUserIds, applyShiftToUsers, todayStr } from '@/lib/shift-assign';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const body = await req.json();
    const ip = req.headers.get('x-forwarded-for') || '';

    const validation = validateRequest(ShiftAssignSchema, body);
    if (!validation.valid) return fail('Validation failed: ' + validation.error, 400);

    const { shiftId, effectiveDate, reason, targets } = validation.data;
    if (!reason?.trim()) return fail('Reason is required', 400);

    const shiftDoc = await Shift.findById(shiftId);
    if (!shiftDoc) return fail('Target shift not found', 404);

    const userIds = await computeTargetUserIds({
      userIds: targets?.userIds || [],
      departments: targets?.departments || [],
      roles: targets?.roles || [],
      fromShiftId: targets?.fromShiftId || null,
      exactUserIds: !!targets?.exactUserIds,
    });

    if (!userIds.length) return fail('No matching employees found for the selected filters', 400);

    // No effective date, or today or earlier → apply immediately
    if (!effectiveDate || effectiveDate <= todayStr()) {
      const applied = await applyShiftToUsers(userIds, shiftDoc, user, ip, reason);
      await auditLog('Shift Assigned (Bulk)', 'Shifts', user._id, `Applied shift "${shiftDoc.name}" to ${applied} user(s). Reason: ${reason}`, 'medium', ip, null, null);
      return ok({ applied, shiftName: shiftDoc.name });
    }

    // Future effective date → schedule
    const change = await ShiftChange.create({
      targetShiftId: shiftDoc._id,
      targetShiftName: shiftDoc.name,
      fromShiftId: targets?.fromShiftId || null,
      departments: (targets?.departments || []).join(', '),
      roles: (targets?.roles || []).join(', '),
      userIds,
      exactUserIds: !!targets?.exactUserIds,
      effectiveDate,
      reason: reason.trim(),
      createdBy: user._id,
    });

    await auditLog('Shift Change Scheduled', 'Shifts', user._id, `Scheduled shift "${shiftDoc.name}" for ${userIds.length} user(s) on ${effectiveDate}. Reason: ${reason}`, 'low', ip, null, change._id);

    return ok({ scheduled: true, id: change._id, count: userIds.length, effectiveDate, reason: change.reason }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const [pending, history] = await Promise.all([
      ShiftChange.find({ status: 'pending' })
        .sort({ effectiveDate: 1 })
        .populate('targetShiftId', 'name startTime endTime')
        .populate('fromShiftId', 'name')
        .populate('createdBy', 'name')
        .lean(),
      ShiftChange.find({ status: { $in: ['applied', 'cancelled'] } })
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('targetShiftId', 'name startTime endTime')
        .populate('fromShiftId', 'name')
        .populate('createdBy', 'name')
        .lean(),
    ]);

    return ok({ pending, history });
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return fail('id is required', 400);

    const change = await ShiftChange.findById(id);
    if (!change) return fail('Not found', 404);
    if (change.status !== 'pending') return fail('Only pending changes can be cancelled', 400);

    change.status = 'cancelled';
    await change.save();

    await auditLog(
      'Shift Change Cancelled',
      'Shifts',
      user._id,
      `Cancelled scheduled shift "${change.targetShiftName}" (${change.effectiveDate}). Reason: ${change.reason}`,
      'medium',
      req.headers.get('x-forwarded-for') || '',
      null,
      change._id
    );

    return ok({ cancelled: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
