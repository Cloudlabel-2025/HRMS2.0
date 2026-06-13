import dbConnect from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { SelfServiceRequest } from '@/lib/models/index';
import { ReviewSelfServiceRequestSchema, validateRequest } from '@/lib/validation';

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
    request.reason = rest.reason || request.reason;
    if (rest.payload) request.payload = rest.payload;
    await request.save();

    await auditLog('Self-Service Request Updated', 'SelfService', user._id, `Updated ${request.requestType} request`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    return ok({ request });
  } catch (e) {
    return fail(e.message, 500);
  }
}