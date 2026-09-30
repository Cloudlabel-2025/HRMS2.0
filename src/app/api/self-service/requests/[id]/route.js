import dbConnect from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { SelfServiceRequest } from '@/lib/models/index';
import { validatePermissionWindow, addDaysStr, MAX_PERMISSION_ADVANCE_DAYS } from '@/lib/permission-window';
import { getShiftDayInfo } from '@/lib/shift-today';

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const { user, error } = await requireAuth(req);
    if (error) return error;

    await dbConnect();
    const request = await SelfServiceRequest.findById(id);
    if (!request) return fail('Request not found', 404);
    if (request.identityId.toString() !== (user.identityId || '').toString()) return fail('Access denied', 403);
    if (request.status !== 'pending') return fail('Only pending requests can be cancelled', 400);

    request.status = 'cancelled';
    request.cancelledAt = new Date();
    await request.save();

    await auditLog('Self-Service Request Cancelled', 'SelfService', user._id, `Cancelled ${request.requestType} request`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    return ok({ request });
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
    const request = await SelfServiceRequest.findById(id);
    if (!request) return fail('Request not found', 404);
    if (request.identityId.toString() !== (user.identityId || '').toString()) return fail('Access denied', 403);
    if (request.status !== 'pending') return fail('Only pending requests can be edited', 400);

    const body = await req.json();
    const { reviewNote: _reviewNote, ...rest } = body;
    if (rest.reason != null && request.requestType === 'permission' && String(rest.reason).trim().length > 300) {
      return fail('Reason must be 300 characters or less for permission requests', 400);
    }
    if (rest.payload && request.requestType === 'permission') {
      // Close the edit bypass: a pending permission cannot be moved to a
      // past date/time or beyond the advance-booking window.
      const merged = { ...(request.payload?.toObject ? request.payload.toObject() : request.payload), ...rest.payload };
      if (merged.date || merged.startTime || merged.endTime) {
        const dayInfo = await getShiftDayInfo(user._id);
        const windowCheck = validatePermissionWindow({
          date: merged.date, startTime: merged.startTime, endTime: merged.endTime,
          now: dayInfo.now, minDate: dayInfo.minDate,
          maxDate: addDaysStr(dayInfo.minDate, MAX_PERMISSION_ADVANCE_DAYS),
          shiftStart: dayInfo.shiftStart, shiftEnd: dayInfo.shiftEnd,
        });
        if (!windowCheck.valid) return fail(windowCheck.error, 400);
      }
    }
    request.reason = rest.reason || request.reason;
    if (rest.payload) request.payload = rest.payload;
    await request.save();

    await auditLog('Self-Service Request Updated', 'SelfService', user._id, `Updated ${request.requestType} request`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    return ok({ request });
  } catch (e) {
    return fail(e.message, 500);
  }
}
