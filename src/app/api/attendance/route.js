import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, parseShiftStartTime } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime } from '@/lib/timezone';
import { checkAndApplyAutoLogout } from '@/lib/attendance-utils';
import { resolveShift } from '@/lib/shift-utils';
import { getShiftConfig, determineStatus } from '@/lib/attendance-constants';
import { matchBreakRule } from '@/lib/attendance-breaks';
import { getDepartmentUserIds } from '@/lib/rbac';
import { isEmployer } from '@/lib/permissions';
import { notify } from '@/lib/notify';

async function getShiftAwareToday(targetUserId) {
  const now = await getTzTime();
  try {
    const targetUser = await User.findById(targetUserId).select('shift shiftId').lean();
    if (!targetUser) return null;
    const shiftDoc = await resolveShift(targetUser);
    return getAttendanceDate(now, shiftDoc?.startTime || null, shiftDoc?.endTime || null);
  } catch {
    return null;
  }
}

function canViewDailyProgress(user) {
  return ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role);
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const date   = searchParams.get('date');
    const month  = searchParams.get('month');
    const scope  = searchParams.get('scope');

    const employerIds = (await User.find({ role: 'super_admin' }).select('_id').lean()).map(u => u._id);
    const employerIdSet = new Set(employerIds.map(id => id.toString()));

    const query = {};

    if (scope === 'my') {
      if (isEmployer(user.role)) return ok({ items: [], summary: {} });
      query.userId = user._id;
    } else if (scope === 'team') {
      if (!canViewDailyProgress(user)) return fail('Access denied', 403);
      const ids = await getDepartmentUserIds(user);
      if (userId) {
        if (ids && !ids.some(id => id.toString() === userId)) return fail('Access denied', 403);
        query.userId = userId;
      } else if (ids) {
        query.userId = { $in: ids };
      }
      if (query.userId) {
        query.$and = [{ userId: query.userId }, { userId: { $nin: employerIds } }];
        delete query.userId;
      } else {
        query.userId = { $nin: employerIds };
      }
      // admins (ids === null) see all — no userId filter
    } else if (userId) {
      if (!['super_admin', 'admin_full'].includes(user.role) && userId !== user._id.toString()) {
        return fail('Access denied', 403);
      }
      query.userId = userId;
    } else {
      // default: own records only
      query.userId = user._id;
    }

    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');

    if (date) {
      query.date = date;
    } else if (fromDate || toDate) {
      const dateRange = {};
      if (fromDate) dateRange.$gte = fromDate;
      if (toDate) dateRange.$lte = toDate;
      query.date = dateRange;
    } else if (month) {
      query.date = { $regex: '^' + month };
    }

    const raw = await Attendance.find(query)
      .populate('userId', 'name avatar department role shift shiftId')
      .sort({ date: -1 })
      .lean();

    const now = await getTzTime();
    const config = await getGlobalConfig();

    const clockedUsers = raw.filter(r => r.clockIn && r.userId?._id).map(r => r.userId);
    const uniqueUsers = [...new Map(clockedUsers.map(u => [u._id.toString(), u])).values()];
    const shiftByUserId = {};
    for (const u of uniqueUsers) {
      const sd = await resolveShift(u);
      if (sd) shiftByUserId[u._id.toString()] = sd;
    }

    // Lazy auto-logout honoring each user's shift setup (endTime + autoLogoutAfterShiftEnd buffer)
    for (const rec of raw) {
      if (!rec.clockIn || rec.clockOut) continue;
      if (employerIdSet.has(rec.userId?._id?.toString())) continue;
      const shiftDoc = shiftByUserId[rec.userId?._id?.toString()] || null;
      const cfg = getShiftConfig(shiftDoc, config);
      if (await checkAndApplyAutoLogout(rec, now, cfg, shiftDoc, employerIdSet.has(rec.userId?._id?.toString()))) {
        await Attendance.findByIdAndUpdate(rec._id, {
          clockOut: rec.clockOut,
          autoLoggedOut: rec.autoLoggedOut,
          breaks: rec.breaks,
          workProgress: rec.workProgress,
          baseHoursWorked: rec.baseHoursWorked,
          hoursWorked: rec.hoursWorked,
          status: rec.status,
        });
      }
    }

    // Recompute lateFlag/status based on actual shift start time
    // so that records created by previous buggy clock logic get corrected
    for (const rec of raw) {
      if (!rec.clockIn) continue;
      if (employerIdSet.has(rec.userId?._id?.toString())) continue;
      const shiftDoc = shiftByUserId[rec.userId?._id?.toString()] || null;
      const cfg = getShiftConfig(shiftDoc, config);

      let shiftHour = 9, shiftMin = 0;
      let shiftFound = false;
      if (shiftDoc?.startTime) {
        const [sh, sm] = shiftDoc.startTime.split(':').map(Number);
        shiftHour = sh; shiftMin = sm;
        shiftFound = true;
      }
      if (!shiftFound) {
        const parsed = parseShiftStartTime(rec.userId?.shift);
        if (parsed) {
          const [sh, sm] = parsed.split(':').map(Number);
          shiftHour = sh; shiftMin = sm;
          shiftFound = true;
        }
      }
      const [h, m] = rec.clockIn.split(':').map(Number);
      let minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
      if (minutesSinceShiftStart < -720) minutesSinceShiftStart += 1440;
      if (minutesSinceShiftStart > 720) minutesSinceShiftStart -= 1440;

      if (rec.clockOut && rec.hoursWorked < cfg.absentThreshold) {
        rec.status = 'absent';
        rec.lateFlag = false;
      } else if (shiftFound) {
        const result = determineStatus(minutesSinceShiftStart, cfg);
        rec.status = result.status;
        rec.lateFlag = result.lateFlag;
      }
    }

    // Persist corrected status/lateFlag for all recalculated records
    const bulkOps = raw
      .filter(rec => rec.clockIn && rec._id)
      .map(rec => ({
        updateOne: {
          filter: { _id: rec._id },
          update: { $set: { status: rec.status, lateFlag: rec.lateFlag } }
        }
      }));

    if (bulkOps.length > 0) {
      await Attendance.bulkWrite(bulkOps).catch(err => {
        console.error('Failed to persist corrected attendance status:', err);
      });
    }

    // Consecutive late detection for managers
    if (scope === 'team' && user.role !== 'employee') {
      const CONSECUTIVE_THRESHOLD = 3;
      const lateEmployees = raw
        .filter(r => r.lateFlag && r.status !== 'leave')
        .map(r => r.userId?._id?.toString())
        .filter(Boolean);
      const uniqueLateUserIds = [...new Set(lateEmployees)];
      for (const uid of uniqueLateUserIds) {
        const recentRecords = await Attendance.find({ userId: uid })
          .sort({ date: -1 })
          .limit(CONSECUTIVE_THRESHOLD)
          .lean();
        const consecutiveLateDays = recentRecords.filter(r => r.lateFlag).length;
        if (consecutiveLateDays >= CONSECUTIVE_THRESHOLD) {
          const empUser = await User.findById(uid).select('name').lean();
          if (empUser) {
            await Notification.create({
              userId: user._id,
              title: 'Consecutive Late Days',
              message: `${empUser.name} has been late for ${consecutiveLateDays} consecutive days.`,
              type: 'attendance',
              refId: uid,
            }).catch(() => {});
          }
        }
      }
    }

    return ok(raw);
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
    const targetUserId = body.userId || user._id;
    if (isEmployer(user.role) && targetUserId.toString() === user._id.toString()) {
      return fail('Employer accounts do not track attendance', 403);
    }
    let today = await getShiftAwareToday(targetUserId);
    if (!today) {
      const now = await getTzTime();
      today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    }

    const record = await Attendance.findOneAndUpdate(
      { userId: targetUserId, date: today },
      { $setOnInsert: { userId: targetUserId, date: today, ...body } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!record) return fail('Failed to create attendance record', 500);
    return ok(record, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();

    // Handle leave override approval/rejection
    if (body.action === 'approve_override' || body.action === 'reject_override') {
      if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
        return fail('Access denied', 403);
      }
      if (!body.attendanceId) return fail('attendanceId is required', 400);

      const record = await Attendance.findById(body.attendanceId);
      if (!record) return fail('Attendance record not found', 404);
      if (record.leaveOverride?.status !== 'pending') return fail('No pending override for this record', 400);

      if (body.action === 'approve_override') {
        record.leaveOverride = {
          status: 'approved',
          approvedBy: user._id,
          approvedAt: new Date(),
        };
        record.status = 'present';
        await record.save();

        await notify(record.userId, 'Attendance Approved',
          `Your clock-in on ${record.date} (leave day) has been approved by ${user.name}.`, 'attendance', record._id);

        return ok(record);
      } else {
        record.leaveOverride = {
          status: 'rejected',
          approvedBy: user._id,
          approvedAt: new Date(),
        };
        record.status = 'leave';
        record.clockIn = null;
        record.clockOut = null;
        record.hoursWorked = 0;
        record.baseHoursWorked = 0;
        record.earlyLogin = false;
        await record.save();

        await notify(record.userId, 'Attendance Rejected',
          `Your clock-in on ${record.date} (leave day) has been rejected by ${user.name}. Status reverted to leave.`, 'attendance', record._id);

        return ok(record);
      }
    }

    const targetUserId = body.userId || user._id;
    let today = body.date || (await getShiftAwareToday(targetUserId));
    if (!today) {
      const now = await getTzTime();
      today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    }

    if (targetUserId.toString() !== user._id.toString() && !['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied', 403);
    }

    const allowed = ['breaks', 'workProgress', 'hoursWorked', 'baseHoursWorked', 'breakDeduction', 'note', 'absenceReason'];
    const update = {};
    allowed.forEach(f => { if (f in body) update[f] = body[f]; });

    // Enforce break limits from shift config
    if (body.breaks) {
      const targetUser = await User.findById(targetUserId).select('shift shiftId').lean();
      const shiftDoc = await resolveShift(targetUser);
      const cfg = await getGlobalConfig();
      const shiftCfg = getShiftConfig(shiftDoc, cfg);

      for (const [ruleIdx, rule] of (shiftCfg.breaks || []).entries()) {
        const allowed = rule.maxCount ?? 1;
        const count = body.breaks.filter(b => matchBreakRule(b, shiftCfg.breaks)?.index === ruleIdx).length;
        if (count > allowed) {
          return fail(`You can only take ${allowed} ${rule.name || rule.type}(s) per day.`, 400);
        }
      }
    }

    const record = await Attendance.findOneAndUpdate(
      { userId: targetUserId, date: today },
      update,
      { new: true }
    );
    if (!record) return fail('Attendance record not found', 404);
    return ok(record);
  } catch (e) {
    return fail(e.message, 500);
  }
}
