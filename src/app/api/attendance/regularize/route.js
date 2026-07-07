import { connectDB } from '@/lib/db';
import { AttendanceRegularization, Notification } from '@/lib/models/index';
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

    const {
      date,
      requestedIn,
      requestedOut,
      requestedBreakStart,
      requestedBreakEnd,
      requestedLunchStart,
      requestedLunchEnd,
      reason
    } = validation.data;

    const request = await AttendanceRegularization.create({
      userId: user._id,
      date,
      requestedIn: requestedIn || null,
      requestedOut: requestedOut || null,
      requestedBreakStart: requestedBreakStart || null,
      requestedBreakEnd: requestedBreakEnd || null,
      requestedLunchStart: requestedLunchStart || null,
      requestedLunchEnd: requestedLunchEnd || null,
      reason,
      status: 'pending',
    });

    // Send notification to reviewers (super admins, admins, team leads, team admins)
    const reviewers = await User.find({ role: { $in: ['super_admin', 'admin_full', 'team_lead', 'team_admin'] }, status: 'active' }).lean();
    const notificationPromises = reviewers.map(reviewer =>
      Notification.create({
        userId: reviewer._id,
        title: 'Attendance Regularization Requested',
        message: `${user.name} requested attendance regularization for ${date}. Reason: ${reason}`,
        type: 'attendance',
        refId: request._id,
      })
    );
    await Promise.all(notificationPromises);

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
      let attendance = await Attendance.findOne({ userId: reg.userId, date: reg.date });
      if (!attendance) {
        attendance = new Attendance({
          userId: reg.userId,
          date: reg.date,
          status: 'present',
        });
      }

      if (reg.requestedIn)  attendance.clockIn = reg.requestedIn;
      if (reg.requestedOut) attendance.clockOut = reg.requestedOut;

      // Update breaks
      const breaks = attendance.breaks ? [...attendance.breaks] : [];
      const updateBreakType = (breaksArray, type, start, end) => {
        const index = breaksArray.findIndex(b => b.type === type);
        if (start || end) {
          if (index !== -1) {
            if (start !== undefined && start !== null) breaksArray[index].start = start;
            if (end !== undefined && end !== null) breaksArray[index].end = end;
          } else {
            breaksArray.push({
              type,
              start: start || '',
              end: end || null
            });
          }
        }
      };

      if (reg.requestedBreakStart !== undefined && reg.requestedBreakStart !== null || reg.requestedBreakEnd !== undefined && reg.requestedBreakEnd !== null) {
        updateBreakType(breaks, 'break', reg.requestedBreakStart, reg.requestedBreakEnd);
      }
      if (reg.requestedLunchStart !== undefined && reg.requestedLunchStart !== null || reg.requestedLunchEnd !== undefined && reg.requestedLunchEnd !== null) {
        updateBreakType(breaks, 'lunch', reg.requestedLunchStart, reg.requestedLunchEnd);
      }
      attendance.breaks = breaks;

      // Update work progress entries for breaks
      const workProgress = attendance.workProgress ? [...attendance.workProgress] : [];
      const updateWorkProgressBreak = (wpArray, type, start, end) => {
        const index = wpArray.findIndex(w => w.type === type);
        const taskDetails = type === 'lunch' ? 'Lunch break' : 'Break';
        if (start || end) {
          if (index !== -1) {
            if (start !== undefined && start !== null) wpArray[index].startTime = start;
            if (end !== undefined && end !== null) {
              wpArray[index].endTime = end;
              wpArray[index].status = 'completed';
            }
          } else {
            wpArray.push({
              type,
              taskDetails,
              startTime: start || '',
              endTime: end || null,
              status: end ? 'completed' : 'work_in_progress',
              remarks: '',
              feedback: ''
            });
          }
        }
      };

      if (reg.requestedBreakStart !== undefined && reg.requestedBreakStart !== null || reg.requestedBreakEnd !== undefined && reg.requestedBreakEnd !== null) {
        updateWorkProgressBreak(workProgress, 'break', reg.requestedBreakStart, reg.requestedBreakEnd);
      }
      if (reg.requestedLunchStart !== undefined && reg.requestedLunchStart !== null || reg.requestedLunchEnd !== undefined && reg.requestedLunchEnd !== null) {
        updateWorkProgressBreak(workProgress, 'lunch', reg.requestedLunchStart, reg.requestedLunchEnd);
      }
      attendance.workProgress = workProgress;

      // Recalculate hours worked
      const BREAK_ALLOWANCE_MINS = 30;
      const LUNCH_ALLOWANCE_MINS = 60;
      
      const toMinutes = (timeStr) => {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };
      
      const diffMins = (start, end) => {
        if (!start || !end) return 0;
        const s = toMinutes(start), e = toMinutes(end);
        return e > s ? e - s : 0;
      };

      if (attendance.clockIn && attendance.clockOut) {
        const base = diffMins(attendance.clockIn, attendance.clockOut);
        attendance.baseHoursWorked = base;

        // Calculate break deductions
        const breakOver = breaks.filter(b => b.type === 'break' && b.end)
          .reduce((acc, b) => acc + Math.max(0, diffMins(b.start, b.end) - BREAK_ALLOWANCE_MINS), 0);
        const lunchOver = breaks.filter(b => b.type === 'lunch' && b.end)
          .reduce((acc, b) => acc + Math.max(0, diffMins(b.start, b.end) - LUNCH_ALLOWANCE_MINS), 0);
        
        attendance.breakDeduction = breakOver + lunchOver;
        const finalHours = Math.min(480, Math.max(0, base - attendance.breakDeduction));
        attendance.hoursWorked = finalHours;
        if (finalHours < 240) {
          attendance.status = 'absent';
        } else {
          attendance.status = 'present';
        }
      }
      
      await attendance.save();
    }

    // Send notification to the employee
    await Notification.create({
      userId: reg.userId,
      title: `Attendance Regularization ${action.charAt(0).toUpperCase() + action.slice(1)}`,
      message: `Your attendance regularization request for ${reg.date} has been ${action} by ${user.name}.`,
      type: 'attendance',
      refId: reg._id,
    });

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
