import { connectDB } from '@/lib/db';
import { AttendanceRegularization, Notification } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AttendanceRegularizeSchema, ApproveRegularizationSchema, validateRequest } from '@/lib/validation';
import { getDepartmentUserIds } from '@/lib/rbac';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { getShiftConfig, calculateHoursWorked } from '@/lib/attendance-constants';
import { calculateBreakDeduction } from '@/lib/attendance-breaks';
import { resolveShift } from '@/lib/shift-utils';
import { isEmployer } from '@/lib/permissions';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope'); // 'my' | 'approvals' | 'history'

    let query = {};
    if (scope === 'history') {
      if (user.role === 'super_admin') {
        query = {};
      } else if (user.role === 'admin_full') {
        const excludeUsers = await User.find({ $or: [{ _id: user._id }, { role: 'admin_full' }] }).select('_id');
        const excludeIds = excludeUsers.map(u => u._id);
        query = { userId: { $nin: excludeIds } };
      } else if (['team_lead', 'team_admin'].includes(user.role)) {
        query = { userId: { $in: await getDepartmentUserIds(user) } };
      } else {
        query = { userId: user._id };
      }
    } else if (scope === 'approvals') {
      if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
        return fail('Access denied', 403);
      }
      if (user.role === 'super_admin') {
        query = { status: 'pending' };
      } else if (user.role === 'admin_full') {
        const excludeUsers = await User.find({ $or: [{ _id: user._id }, { role: 'admin_full' }] }).select('_id');
        const excludeIds = excludeUsers.map(u => u._id);
        query = { userId: { $nin: excludeIds }, status: 'pending' };
      } else if (['team_lead', 'team_admin'].includes(user.role)) {
        query = { userId: { $in: await getDepartmentUserIds(user) }, status: 'pending' };
      }
    } else {
      query = { userId: user._id };
    }

    const requests = await AttendanceRegularization.find(query)
      .populate('userId', 'name avatar department role')
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
    if (isEmployer(user.role)) return fail('Employer accounts do not track attendance', 403);
    await connectDB();

    const body = await req.json();
    const ip = req.headers.get('x-forwarded-for') || '';
    const validation = validateRequest(AttendanceRegularizeSchema, body);
    if (!validation.valid) {
      auditLog('Regularization Request Failed', 'Attendance', user._id, `Validation failed: ${validation.error}`, 'low', ip, null, user._id);
      return fail('Validation failed: ' + validation.error, 400);
    }

    const { date, requestedIn, requestedOut, requestedOutNotYet, requestedBreaks, reason } = validation.data;

    const countToday = await AttendanceRegularization.countDocuments({ userId: user._id, date: validation.data.date });
    if (countToday >= 4) {
      return fail('Maximum 4 regularization requests allowed per day', 400);
    }

    const existingPending = await AttendanceRegularization.findOne({ userId: user._id, date: validation.data.date, status: 'pending' });
    if (existingPending) {
      return fail('You already have a pending regularization request for this date', 400);
    }

    const request = await AttendanceRegularization.create({
      userId: user._id, date,
      requestedIn: requestedIn || null,
      requestedOut: requestedOut || null,
      requestedOutNotYet: requestedOutNotYet || false,
      requestedBreaks: (requestedBreaks || []).map(b => ({
        type: b.type,
        name: b.name || '',
        ruleIdx: b.ruleIdx ?? null,
        idx: b.idx ?? null,
        start: b.start || '',
        end: b.end || null,
        notYet: b.notYet || false,
      })),
      reason, status: 'pending',
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

    // Role-based scope verification
    if (user.role === 'admin_full') {
      const requester = await User.findById(reg.userId).select('role').lean();
      if (!requester || requester.role === 'admin_full' || reg.userId.toString() === user._id.toString()) {
        return fail('Access denied', 403);
      }
    } else if (['team_lead', 'team_admin'].includes(user.role)) {
      const ids = await getDepartmentUserIds(user);
      if (!ids.some(id => id.toString() === reg.userId.toString())) {
        return fail('Access denied', 403);
      }
    }

    // STEP 1: Atomically claim the regulation FIRST
    const updated = await AttendanceRegularization.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status: action, reviewedBy: user._id, reviewedAt: new Date() } },
      { new: true }
    );
    if (!updated) {
      const existing = await AttendanceRegularization.findById(id);
      if (!existing) return fail('Request not found', 404);
      auditLog(`Regularization Review Attempted`, 'Attendance', user._id, `Attempted to ${action} already-processed request (status: ${existing.status})`, 'low', req.headers.get('x-forwarded-for') || '', null, reg.userId);
      return fail('This request has already been processed', 400);
    }

    // STEP 2: Now safely update the attendance record
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
      if (reg.requestedOutNotYet) {
        const nyUser = await User.findById(reg.userId).select('shift shiftId').lean();
        const nyShift = await resolveShift(nyUser);
        if (nyShift?.endTime) attendance.clockOut = nyShift.endTime;
      }

      // Apply requested breaks from regularization
      const attendanceBreaks = attendance.breaks ? [...attendance.breaks] : [];
      const attendanceWorkProgress = attendance.workProgress ? [...attendance.workProgress] : [];

      if (reg.requestedBreaks && reg.requestedBreaks.length > 0) {
        const ruleKey = (b) => (b.ruleIdx != null ? 'r' + b.ruleIdx : (b.name ? b.type + '|' + b.name : b.type || ''));

        // Indexes of attendance break entries per rule key (ordered)
        const breaksByRule = {};
        attendanceBreaks.forEach((b, i) => {
          const k = ruleKey(b);
          (breaksByRule[k] = breaksByRule[k] || []).push(i);
        });

        // Find the instIdx-th attendance break for the requested break's rule,
        // falling back to type-only matching for legacy (pre rule-identity) data.
        const findExistingIdx = (rb, instIdx) => {
          const key = ruleKey(rb);
          const byKey = breaksByRule[key]?.[instIdx];
          if (byKey !== undefined) return byKey;
          const byType = breaksByRule[rb.type]?.[instIdx];
          if (byType !== undefined) return byType;
          return undefined;
        };

        // Find the instIdx-th workProgress row belonging to the requested break's rule
        const findWp = (rb, instIdx) => {
          let seen = -1;
          let match = -1;
          attendanceWorkProgress.forEach((w, i) => {
            if (w.type === rb.type && (rb.name ? w.taskDetails === rb.name : true)) {
              seen++;
              if (seen === instIdx) match = i;
            }
          });
          if (match !== -1) return match;
          seen = -1; match = -1;
          attendanceWorkProgress.forEach((w, i) => {
            if (w.type === rb.type) { seen++; if (seen === instIdx) match = i; }
          });
          return match;
        };

        for (const rb of reg.requestedBreaks) {
          const instIdx = rb.idx ?? 0;
          if (rb.notYet) {
            const removeIdx = findExistingIdx(rb, instIdx);
            if (removeIdx !== undefined) {
              attendanceBreaks.splice(removeIdx, 1);
              for (const k of Object.keys(breaksByRule)) {
                breaksByRule[k] = breaksByRule[k].map(i => i > removeIdx ? i - 1 : i).filter(i => i !== removeIdx);
              }
            }
            const wpRemoveIdx = findWp(rb, instIdx);
            if (wpRemoveIdx !== -1) attendanceWorkProgress.splice(wpRemoveIdx, 1);
          } else if (rb.start || rb.end) {
            const existingIdx = findExistingIdx(rb, instIdx);
            if (existingIdx !== undefined) {
              if (rb.start) attendanceBreaks[existingIdx].start = rb.start;
              if (rb.end) attendanceBreaks[existingIdx].end = rb.end;
            } else {
              attendanceBreaks.push({ type: rb.type, name: rb.name || '', ruleIdx: rb.ruleIdx ?? null, start: rb.start || '', end: rb.end || null });
            }

            const wpIdx = findWp(rb, instIdx);
            if (wpIdx !== -1) {
              if (rb.start) attendanceWorkProgress[wpIdx].startTime = rb.start;
              if (rb.end) {
                attendanceWorkProgress[wpIdx].endTime = rb.end;
                attendanceWorkProgress[wpIdx].status = 'completed';
              }
            } else {
              attendanceWorkProgress.push({
                type: rb.type, taskDetails: rb.name || (rb.type === 'lunch' ? 'Lunch break' : 'Break'),
                startTime: rb.start || '', endTime: rb.end || null,
                status: rb.end ? 'completed' : 'work_in_progress',
                remarks: '', feedback: '',
              });
            }
          }
        }
      }

      attendance.breaks = attendanceBreaks;
      attendance.workProgress = attendanceWorkProgress;

      // Recalculate hours worked
      const empUser = await User.findById(reg.userId).select('shift shiftId').lean();
      const regShiftDoc = await resolveShift(empUser);
      const config = await getGlobalConfig();
      const regCfg = getShiftConfig(regShiftDoc, config);

      if (attendance.clockIn && attendance.clockOut) {
        const toMins = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        let base = toMins(attendance.clockOut) - toMins(attendance.clockIn);
        if (base < 0 && reg.requestedOutNotYet) base += 24 * 60;
        base = Math.max(0, base);
        attendance.baseHoursWorked = base;

        attendance.breakDeduction = calculateBreakDeduction(attendanceBreaks, regCfg.breaks);
        const { hoursWorked } = calculateHoursWorked(base, attendance.breakDeduction, regCfg);
        attendance.hoursWorked = hoursWorked;
        if (hoursWorked < regCfg.absentThreshold) {
          attendance.status = 'absent';
        } else {
          attendance.status = 'present';
        }

        // Recalculate lateFlag based on shift start
        if (empUser?.shift) {
          const lateShiftDoc = regShiftDoc || await resolveShift(empUser);
          if (lateShiftDoc?.startTime) {
            const [sH, sM] = lateShiftDoc.startTime.split(':').map(Number);
            const shiftStartMins = sH * 60 + sM;
            if (attendance.clockIn) {
              const [cH, cM] = attendance.clockIn.split(':').map(Number);
              const clockInMins = cH * 60 + cM;
              const minutesLate = clockInMins - shiftStartMins;
              attendance.lateFlag = minutesLate > (regCfg?.lateThreshold || 15);
            }
          }
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

    return ok(updated);
  } catch (e) {
    return fail(e.message, 500);
  }
}
