import { connectDB } from '@/lib/db';
import { Leave, Holiday } from '@/lib/models/index';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CreateLeaveSchema, validateRequest } from '@/lib/validation';
import { notify } from '@/lib/notify';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope    = searchParams.get('scope');
    const status   = searchParams.get('status');
    const userIdParam = searchParams.get('userId');
    const smeOnly  = searchParams.get('smeOnly');
    const isAdmin = ['super_admin', 'admin_full'].includes(user.role);

    let query = {};

    if (smeOnly === 'true') {
      if (!isAdmin) return fail('Access denied', 403);
      query.smeId = { $ne: null };
    }

    if (scope === 'all') {
      if (!isAdmin) return fail('Access denied', 403);
      // No userId filter — returns all leaves in the organization
    } else if (scope === 'approvals') {
      if (isAdmin) {
        query = { $or: [
          { adminApproval: { $in: ['pending', null] } },
          { status: 'approved', teamAdminApproval: 'held' },
          { status: 'approved', tlApproval: 'held' },
          { status: 'approved', teamAdminApproval: 'rejected' },
          { status: 'approved', tlApproval: 'rejected' },
          { status: 'pending', teamAdminApproval: 'held' },
          { status: 'pending', tlApproval: 'held' },
          { status: 'pending', teamAdminApproval: 'rejected' },
          { status: 'pending', tlApproval: 'rejected' },
        ]};
      } else if (user.role === 'team_admin') {
        query = { adminApproval: 'approved', teamAdminApproval: { $in: ['pending', null] } };
      } else if (user.role === 'team_lead') {
        query = { adminApproval: 'approved', tlApproval: { $in: ['pending', null] } };
      } else {
        return fail('Access denied', 403);
      }
    } else if (scope === 'my' && userIdParam && isAdmin) {
      query.userId = userIdParam;
    } else {
      // 'my' or any other scope — always own leaves
      query.userId = user._id;
    }

    if (status) query.status = status;

    const leaves = await Leave.find(query)
      .populate('userId', 'name avatar department')
      .populate({ path: 'adminApprovedBy',     select: 'name', strictPopulate: false })
      .populate({ path: 'teamAdminApprovedBy',  select: 'name', strictPopulate: false })
      .populate({ path: 'tlApprovedBy',         select: 'name', strictPopulate: false })
      .sort({ createdAt: -1 });

    return ok(leaves);
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
    const validation = validateRequest(CreateLeaveSchema, body);
    if (!validation.valid) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { type, from, to, reason } = validation.data;
    const days = Math.ceil((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24)) + 1;

    if (user.role === 'intern' && !['Casual Leave', 'Sick Leave'].includes(type)) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Intern not allowed to apply for ${type}`, 'low', ip, null, user._id);
      return fail('Interns can only apply for Casual or Sick Leave', 400);
    }

    let smeId = null;
    if (user.role === 'sme') {
      const { SME } = await import('@/lib/models/index');
      const sme = await SME.findOne({ userId: user._id });
      if (!sme) return fail('SME profile not found', 404);
      if (sme.status !== 'active') return fail('Your account is inactive. Contact admin.', 400);
      if (sme.contractEnd && new Date(to) > new Date(sme.contractEnd)) {
        return fail(`Cannot apply leave beyond contract end date (${new Date(sme.contractEnd).toLocaleDateString()})`, 400);
      }
      smeId = sme._id;
    }

    const existing = await Leave.findOne({ userId: user._id, status: 'pending' });
    if (existing) {
      auditLog('Leave Apply Failed', 'Leave', user._id, 'Already has a pending leave application', 'low', ip, null, user._id);
      return fail('You already have a pending leave application. Wait for it to be resolved before applying again.', 400);
    }

    const overlap = await Leave.findOne({
      userId: user._id,
      status: { $in: ['pending', 'approved'] },
      from: { $lte: to },
      to:   { $gte: from },
    });
    if (overlap) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Date overlap with existing ${overlap.status} leave (${overlap.from} to ${overlap.to})`, 'low', ip, null, user._id);
      return fail(`You already have a ${overlap.status} leave from ${overlap.from} to ${overlap.to} that overlaps with the requested dates.`, 400);
    }

    const holidayOverlap = await Holiday.findOne({
      date: { $gte: from, $lte: to },
    });
    if (holidayOverlap) {
      auditLog('Leave Apply Failed', 'Leave', user._id, `Date overlaps with holiday "${holidayOverlap.name}" on ${holidayOverlap.date}`, 'low', ip, null, user._id);
      return fail(`Cannot apply leave from ${from} to ${to} — "${holidayOverlap.name}" (${holidayOverlap.type}) falls on ${holidayOverlap.date}.`, 400);
    }

    const leave = await Leave.create({ userId: user._id, type, from, to, days, reason, status: 'pending', smeId });

    const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] } }).select('_id');
    if (admins.length) {
      await notify(
        admins.map(a => a._id),
        'New Leave Request',
        `${user.name} applied for ${days} day(s) of ${type} (${from} to ${to})`,
        'leave',
        leave._id
      );
    }

    await auditLog('Leave Applied', 'Leave', user._id, `Applied for ${days} days of ${type} (${from} to ${to})`, 'low', ip, null, user._id);
    return ok(leave, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
