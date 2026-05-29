import { connectDB } from '@/lib/db';
import { AttendanceRegularization } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

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

    const { date, requestedIn, requestedOut, reason } = await req.json();
    if (!date || !reason) return fail('Date and reason are required');

    const request = await AttendanceRegularization.create({
      userId: user._id, date, requestedIn, requestedOut, reason,
    });
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

    const { id, action } = await req.json();
    if (!['approved', 'rejected'].includes(action)) return fail('Invalid action');

    const reg = await AttendanceRegularization.findById(id);
    if (!reg) return fail('Request not found', 404);

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

    return ok(reg);
  } catch (e) {
    return fail(e.message, 500);
  }
}
