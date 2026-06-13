import { connectDB } from '@/lib/db';
import { AttendanceRegularization } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AttendanceRegularizeSchema, ApproveRegularizationSchema, validateRequest } from '@/lib/validation';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope'); // 'my' | 'approvals'

    let query = {};
    if (scope === 'approvals') {
      if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
        return fail('Access denied', 403);
      }
      if (user.role === 'team_lead') {
        const members = await User.find({ teamLeadId: user._id }).select('_id');
        query = { userId: { $in: members.map(m => m._id) }, status: 'pending' };
      } else if (user.role === 'team_admin') {
        const members = await User.find({ teamAdminId: user._id }).select('_id');
        query = { userId: { $in: members.map(m => m._id) }, status: 'pending' };
      } else {
        query = { status: 'pending' };
      }
    } else {
      query = { userId: user._id };
    }

    const requests = await AttendanceRegularization.find(query)
      .populate('userId', 'name avatar department')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    return ok(requests);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const ip = req.headers.get('x-forwarded-for') || '';
    const validation = validateRequest(AttendanceRegularizeSchema, body);
    if (!validation.valid) {
      auditLog('Regularization Request Failed', 'Attendance', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { date, requestedIn, requestedOut, reason } = validation.data;

    const request = await AttendanceRegularization.create({
      userId: user._id,
      date,
      requestedIn,
      requestedOut,
      reason,
      status: 'pending',
    });

    // Audit log
    await auditLog(
      'Attendance Regularization Requested',
      'Attendance',
      user._id,
      `Requested regularization for ${date}`,
      'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      user._id
    );

    return ok(request, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
      return fail('Access denied', 403);
    }
    await connectDB();

    const body = await req.json();
    const { id, ...rest } = body;
    if (!id) return fail('id is required', 400);

    // Validate request
    const validation = validateRequest(ApproveRegularizationSchema, rest);
    if (!validation.valid) {
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { action } = validation.data;

    const reg = await AttendanceRegularization.findById(id);
    if (!reg) return fail('Request not found', 404);

    if (reg.status !== 'pending') {
      auditLog(`Regularization Review Attempted`, 'Attendance', user._id, `Attempted to ${action} already-processed request (status: ${reg.status})`, 'low', req.headers.get('x-forwarded-for') || '', null, reg.userId);
      return fail('This request has already been processed', 400);
    }

    reg.status = action;
    reg.reviewedBy = user._id;
    reg.reviewedAt = new Date();
    await reg.save();

    // If approved, update the actual attendance record
    if (action === 'approved') {
      const update = {};
      if (reg.requestedIn)  update.clockIn = reg.requestedIn;
      if (reg.requestedOut) update.clockOut = reg.requestedOut;
      if (reg.requestedIn && reg.requestedOut) {
        const [inH, inM] = reg.requestedIn.split(':').map(Number);
        const [outH, outM] = reg.requestedOut.split(':').map(Number);
        update.hoursWorked = (outH * 60 + outM) - (inH * 60 + inM);
        update.status = 'present';
      }
      await Attendance.findOneAndUpdate({ userId: reg.userId, date: reg.date }, update);
    }

    // Audit log
    await auditLog(
      `Attendance Regularization ${action}`,
      'Attendance',
      user._id,
      `${action} regularization request for ${reg.userId} on ${reg.date}`,
      action === 'approved' ? 'medium' : 'low',
      req.headers.get('x-forwarded-for') || '',
      null,
      reg.userId
    );

    return ok(reg);
  } catch (e) {
    return fail(e.message, 500);
  }
}
