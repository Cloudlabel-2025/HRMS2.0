import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, parseShiftStartTime } from '@/lib/payroll-cycle';
import { getAttendanceDate } from '@/lib/attendance-date';
import { getTzTime } from '@/lib/timezone';
import { checkAndApplyAutoLogout } from '@/lib/attendance-utils';
import { resolveShift, resolveShiftForDate } from '@/lib/shift-utils';
import { getShiftConfig, computeWorkRowDuration } from '@/lib/attendance-constants';
import { resolveDayStatus } from '@/lib/attendance-resolver';
import { matchBreakRule } from '@/lib/attendance-breaks';
import { reconcilePermissionWorkProgress } from '@/lib/permission-work';
import { getAccessibleDepartments } from '@/lib/rbac';
import { isEmployer } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { publishAttendance } from '@/lib/sse';

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
    const openOnly = searchParams.get('openOnly') === '1';

    const employerIds = (await User.find({ role: 'super_admin' }).select('_id').lean()).map(u => u._id);
    const employerIdSet = new Set(employerIds.map(id => id.toString()));

    const query = {};

    if (scope === 'my') {
      if (isEmployer(user.role)) return ok({ items: [], summary: {} });
      query.userId = user._id;
    } else if (scope === 'team') {
      if (!canViewDailyProgress(user)) return fail('Access denied', 403);
      const depts = await getAccessibleDepartments(user);
      if (userId) {
        const targetUser = await User.findById(userId).select('department').lean();
        if (!targetUser) return fail('Access denied', 403);
        if (depts !== null && !depts.includes(targetUser.department)) return fail('Access denied', 403);
        query.userId = userId;
      } else if (depts) {
        const deptUsers = await User.find({ department: { $in: depts } }).select('_id').lean();
        query.userId = { $in: deptUsers.map(u => u._id), $nin: employerIds };
      } else {
        query.userId = { $nin: employerIds };
      }
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

    if (openOnly) {
      query.clockIn = { $ne: null };
      query.clockOut = null;
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

    // Lazy auto-logout honoring each user's shift setup (shift-aware deadlines, overnight-correct).
    // For past dates use historical shift (criterion 2); regularizationOutOpen only defers until grace (criteria 5/6).
    const _calTodayForAuto = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    for (const rec of raw) {
      if (!rec.clockIn || rec.clockOut) continue;
      if (employerIdSet.has(rec.userId?._id?.toString())) continue;
      let shiftDoc = shiftByUserId[rec.userId?._id?.toString()] || null;
      // Frozen snapshot first, then historical shift for past dates so grace
      // deadline matches that day's config
      if (rec.shiftStartTime) {
        shiftDoc = {
          _id: rec.shiftId || null,
          name: rec.shiftName || rec.userId?.shift || '',
          startTime: rec.shiftStartTime,
          endTime: rec.shiftEndTime || '',
          lateThreshold: rec.shiftLateThreshold ?? null,
        };
      } else if (rec.date && rec.date !== _calTodayForAuto && rec.userId?._id) {
        try {
          const hist = await resolveShiftForDate(rec.userId, rec.date);
          if (hist) shiftDoc = hist;
        } catch { /* fallback to current */ }
      }
      const cfg = getShiftConfig(shiftDoc, config);
      if (await checkAndApplyAutoLogout(rec, now, cfg, shiftDoc, employerIdSet.has(rec.userId?._id?.toString()))) {
        await Attendance.findByIdAndUpdate(rec._id, {
          clockOut: rec.clockOut,
          autoLoggedOut: rec.autoLoggedOut,
          regularizationOutOpen: rec.regularizationOutOpen,
          breaks: rec.breaks,
          workProgress: rec.workProgress,
          baseHoursWorked: rec.baseHoursWorked,
          hoursWorked: rec.hoursWorked,
          payableHours: rec.payableHours,
          shortHours: rec.shortHours,
          status: rec.status,
        });
        try {
          publishAttendance({
            type: 'clockout',
            userId: (rec.userId?._id || rec.userId).toString(),
            name: rec.userId?.name,
            date: rec.date,
            clockIn: rec.clockIn,
            clockOut: rec.clockOut,
            hoursWorked: rec.hoursWorked,
            status: rec.status,
            autoLoggedOut: true,
          });
        } catch (e) { /* non-fatal */ }
      }
    }

    // Recompute lateFlag/status using the shift effective ON rec.date
    // (per-day rule). Snapshot on the record wins, then historical
    // ShiftChange lineage, then current shift as last resort. Never
    // overwrite explicit leave/holiday decisions (rejected overrides).
    const _histShiftCache = new Map();
    const resolveShiftForRow = async (rec) => {
      const uid = rec.userId?._id?.toString() || '';
      // 1. Frozen snapshot written at clock-in (future-proof, immune to later edits)
      if (rec.shiftStartTime) {
        return {
          _id: rec.shiftId || null,
          name: rec.shiftName || rec.userId?.shift || '',
          startTime: rec.shiftStartTime,
          endTime: rec.shiftEndTime || '',
          lateThreshold: rec.shiftLateThreshold ?? null,
        };
      }
      // 2. Historical lineage for past dates
      if (rec.date && rec.date !== _calTodayForAuto && rec.userId?._id) {
        const key = uid + '|' + rec.date;
        if (!_histShiftCache.has(key)) {
          try {
            const hist = await resolveShiftForDate(rec.userId, rec.date);
            _histShiftCache.set(key, hist || null);
          } catch { _histShiftCache.set(key, null); }
        }
        const hist = _histShiftCache.get(key);
        if (hist) return hist;
      }
      // 3. Current shift fallback
      return shiftByUserId[uid] || null;
    };
    for (const rec of raw) {
      if (!rec.clockIn) continue;
      if (employerIdSet.has(rec.userId?._id?.toString())) continue;
      if (['leave', 'holiday'].includes(rec.status)) continue;
      if (rec.leaveOverride?.status === 'rejected') continue;
      const shiftDoc = await resolveShiftForRow(rec);
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
      const shiftStartMins = shiftHour * 60 + shiftMin;
      let minutesSinceShiftStart = shiftFound ? (h - shiftHour) * 60 + (m - shiftMin) : 0;
      if (minutesSinceShiftStart < -720) minutesSinceShiftStart += 1440;
      if (minutesSinceShiftStart > 720) minutesSinceShiftStart -= 1440;

      if (rec.approvedHalfDayLeave) {
        rec.status = 'half_day';
        rec.lateFlag = false;
        rec.halfDayThresholdExceeded = false;
      } else if (shiftFound) {
        const result = resolveDayStatus({
          clockIn: rec.clockIn,
          permission: rec.permission?.endTime ? { startTime: rec.permission?.startTime, endTime: rec.permission?.endTime } : null,
          approvedHalfDayLeave: !!rec.approvedHalfDayLeave,
          nonWorkingDayType: rec.nonWorkingDayType || 'none',
          leaveOverrideStatus: rec.leaveOverride?.status || 'none',
          minutesSinceShiftStart,
          shiftStartMins,
          cfg,
        });
        rec.status = result.status;
        rec.lateFlag = result.lateFlag;
        rec.halfDayThresholdExceeded = !!result.halfDayThresholdExceeded;
      }
      if (rec.permission?.requestId || rec.permission?.startTime) {
        rec.status = 'present';
        rec.lateFlag = false;
        rec.halfDayThresholdExceeded = false;
        rec.shortHours = false;
        rec._permissionStatus = 'approved';
      } else {
        rec.halfDayThresholdExceeded = !!rec.halfDayThresholdExceeded;
      }
    }

    // Join pending permission requests so superadmin can see Late + Pending.
    // Pending lives in self_service_requests, not on the Attendance doc.
    try {
      const { SelfServiceRequest } = await import('@/lib/models/index');
      const dates = [...new Set(raw.map(r => r.date).filter(Boolean))];
      if (dates.length > 0) {
        const pendings = await SelfServiceRequest.find({
          requestType: 'permission',
          status: 'pending',
          'payload.date': { $in: dates },
        }).select('identityId profileId payload reason createdAt').lean();
        if (pendings.length > 0) {
          const identityIds = [...new Set(pendings.map(p => String(p.identityId)).filter(Boolean))];
          const profileIds = [...new Set(pendings.map(p => String(p.profileId)).filter(Boolean))];
          const orConds = [];
          if (identityIds.length) orConds.push({ identityId: { $in: identityIds } });
          if (profileIds.length) orConds.push({ profileId: { $in: profileIds } });
          let userMap = new Map();
          if (orConds.length) {
            const pUsers = await User.find({ $or: orConds }).select('_id identityId profileId').lean();
            for (const u of pUsers) {
              if (u.identityId) userMap.set('id:' + String(u.identityId), String(u._id));
              if (u.profileId) userMap.set('pf:' + String(u.profileId), String(u._id));
            }
          }
          const pendingByUserDate = new Map();
          for (const p of pendings) {
            const uid = userMap.get('id:' + String(p.identityId)) || userMap.get('pf:' + String(p.profileId)) || null;
            if (!uid) continue;
            const d = p.payload?.date;
            if (!d) continue;
            const key = uid + '|' + d;
            if (!pendingByUserDate.has(key)) {
              pendingByUserDate.set(key, {
                date: d,
                startTime: p.payload?.startTime || '',
                endTime: p.payload?.endTime || '',
                duration: Number(p.payload?.duration || 0) || 0,
                status: 'pending',
                requestId: String(p._id),
                reason: p.reason || '',
              });
            }
          }
          for (const rec of raw) {
            const uid = rec.userId?._id?.toString() || String(rec.userId || '');
            const key = uid + '|' + rec.date;
            const hasApproved = !!(rec.permission?.requestId || rec.permission?.startTime);
            if (hasApproved) {
              rec._permissionStatus = 'approved';
            } else if (pendingByUserDate.has(key)) {
              rec.pendingPermission = pendingByUserDate.get(key);
              rec._permissionStatus = 'pending';
            } else {
              rec._permissionStatus = rec._permissionStatus || null;
            }
          }
        } else {
          for (const rec of raw) {
            const hasApproved = !!(rec.permission?.requestId || rec.permission?.startTime);
            rec._permissionStatus = hasApproved ? 'approved' : (rec._permissionStatus || null);
          }
        }
      }
    } catch (e) {
      console.error('Pending permission join failed:', e?.message || e);
    }

    const nowTimeStr = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    const permissionDirtyIds = new Set();
    for (const rec of raw) {
      if (!rec.clockIn || rec.clockOut) continue;
      if (reconcilePermissionWorkProgress(rec, nowTimeStr)) permissionDirtyIds.add(String(rec._id));
    }

    if (raw.length === 0 && scope === 'my' && date) {
      try {
        const { SelfServiceRequest } = await import('@/lib/models/index');
        const reqs = await SelfServiceRequest.find({
          $or: [{ identityId: user.identityId }, { profileId: user.profileId }],
          requestType: 'permission',
          'payload.date': date,
          status: { $in: ['pending', 'approved'] },
        }).sort({ createdAt: -1 }).lean();
        if (reqs.length > 0) {
          const r = reqs[0];
          const isApproved = r.status === 'approved';
          raw.push({
            _id: null,
            userId: { _id: user._id, name: user.name, department: user.department, role: user.role, shift: user.shift, shiftId: user.shiftId },
            date,
            clockIn: null,
            clockOut: null,
            status: 'absent',
            workProgress: [],
            permission: isApproved ? { requestId: r._id, startTime: r.payload?.startTime || null, endTime: r.payload?.endTime || null, status: 'approved' } : undefined,
            pendingPermission: !isApproved ? { startTime: r.payload?.startTime || '', endTime: r.payload?.endTime || '', status: 'pending', requestId: String(r._id) } : undefined,
            _permissionStatus: r.status,
          });
        }
      } catch {}
    }

    if (typeof date === 'string' && date && (scope === 'team' || scope === 'my' || userId)) {
      try {
        const { Leave } = await import('@/lib/models/index');
        const leaves = await Leave.find({ status: 'approved', from: { $lte: date }, to: { $gte: date } }).select('userId from to halfDay').lean();
        if (leaves.length > 0) {
          const isUserAllowed = (uid) => {
            const qUid = query.userId;
            const idStr = String(uid);
            if (!qUid) return true;
            if (typeof qUid === 'string') return String(qUid) === idStr;
            if (qUid instanceof String) return String(qUid) === idStr;
            if (qUid._id) return String(qUid._id) === idStr;
            if (qUid.$in && qUid.$nin) {
              const inSet = new Set(qUid.$in.map(String));
              const ninSet = new Set(qUid.$nin.map(String));
              if (ninSet.has(idStr)) return false;
              return inSet.has(idStr);
            }
            if (qUid.$in) return new Set(qUid.$in.map(String)).has(idStr);
            if (qUid.$nin) return !new Set(qUid.$nin.map(String)).has(idStr);
            return true;
          };
          for (const l of leaves) {
            const uidStr = String(l.userId);
            if (employerIdSet.has(uidStr)) continue;
            if (!isUserAllowed(l.userId)) continue;
            const exists = raw.some(r => String(r.userId?._id || r.userId) === uidStr && r.date === date);
            if (exists) continue;
            const isHalf = !!l.halfDay && l.from === l.to;
            const userDoc = await User.findById(l.userId).select('name avatar department role shift shiftId').lean().catch(() => null);
            if (!userDoc) continue;
            let rec = await Attendance.findOne({ userId: l.userId, date }).lean().catch(() => null);
            if (!rec) {
              rec = await Attendance.findOneAndUpdate(
                { userId: l.userId, date },
                { $set: { userId: l.userId, date, status: isHalf ? 'half_day' : 'leave', relatedLeaveId: l._id, approvedHalfDayLeave: isHalf } },
                { upsert: true, new: true }
              ).lean().catch(() => null);
              if (!rec) continue;
              rec.userId = userDoc;
            } else {
              if (rec.status !== 'half_day' && rec.status !== 'leave') {
                await Attendance.findByIdAndUpdate(rec._id, { status: isHalf ? 'half_day' : 'leave', relatedLeaveId: l._id, approvedHalfDayLeave: isHalf }).catch(() => {});
                rec.status = isHalf ? 'half_day' : 'leave';
                rec.approvedHalfDayLeave = isHalf;
              }
              rec.userId = userDoc;
            }
            raw.push(rec);
          }
        }
      } catch (e) { console.error('Lazy leave materialize failed:', e?.message || e); }
    }

    // READ-SAFE: never persist recomputed status/lateFlag for past dates.
    // Past rows are judged per-day in memory; only today's rows may be
    // corrected in DB (plus open-record workProgress/permission churn).
    const bulkOps = raw
      .filter(rec => rec.clockIn && rec._id && rec.date === _calTodayForAuto)
      .map(rec => {
        const set = { status: rec.status, lateFlag: rec.lateFlag, halfDayThresholdExceeded: !!rec.halfDayThresholdExceeded, shortHours: !!rec.shortHours };
        if (permissionDirtyIds.has(String(rec._id))) {
          set.workProgress = rec.workProgress;
          set.permission = rec.permission;
        }
        return { updateOne: { filter: { _id: rec._id }, update: { $set: set } } };
      });

    if (bulkOps.length > 0) {
      await Attendance.bulkWrite(bulkOps).catch(err => {
        console.error('Failed to persist corrected attendance status:', err);
      });
    }
    for (const rec of raw) {
      if (permissionDirtyIds.has(String(rec._id)) && rec.workProgress) {
        try {
          await Attendance.findByIdAndUpdate(rec._id, { workProgress: rec.workProgress, permission: rec.permission });
        } catch {}
      }
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
          `Your clock-in on ${record.date} (${record.nonWorkingDayType !== 'none' ? 'non-working day' : 'leave day'}) has been approved by ${user.name}.`, 'attendance', record._id);

        return ok(record);
      } else {
        record.leaveOverride = {
          status: 'rejected',
          approvedBy: user._id,
          approvedAt: new Date(),
        };
        record.status = record.nonWorkingDayType !== 'none' ? 'holiday' : 'leave';
        record.clockIn = null;
        record.clockOut = null;
        record.hoursWorked = 0;
        record.baseHoursWorked = 0;
        record.earlyLogin = false;
        await record.save();

        await notify(record.userId, 'Attendance Rejected',
          `Your clock-in on ${record.date} has been rejected by ${user.name}. Status reverted to ${record.status}.`, 'attendance', record._id);

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

    if (update.workProgress) {
      const existing = await Attendance.findOne({ userId: targetUserId, date: today }).lean();
      if (existing?.permission?.requestId) {
        const serverPerm = existing.permission;
        const hasActiveServerPerm = existing.workProgress?.some(r => r.type === 'permission' && !r.endTime);
        const serverEnded = !!serverPerm.endedAt;
        const incomingPermIdx = update.workProgress.findIndex(r => r.type === 'permission');
        if (serverPerm.requestId) {
          if (incomingPermIdx === -1 && hasActiveServerPerm && !serverEnded) {
            const permRow = existing.workProgress.find(r => r.type === 'permission' && !r.endTime);
            if (permRow) update.workProgress.push(permRow);
          }
          if (incomingPermIdx !== -1) {
            const idx = incomingPermIdx;
            if (serverEnded) {
              update.workProgress[idx] = { ...existing.workProgress.find(r => r.type === 'permission'), ...update.workProgress[idx], endTime: existing.workProgress.find(r => r.type === 'permission')?.endTime || serverPerm.endedAt || serverPerm.endTime, status: 'completed' };
              update.workProgress[idx].permissionRequestId = serverPerm.requestId;
            } else if (!serverEnded) {
              update.workProgress[idx].permissionRequestId = serverPerm.requestId;
              if (update.workProgress[idx].endTime && !hasActiveServerPerm) {
              } else if (!update.workProgress[idx].endTime) {
                update.workProgress[idx].status = 'work_in_progress';
              }
            }
          }
          const permRows = update.workProgress.filter(r => r.type === 'permission');
          if (permRows.length > 1) {
            const keepIdx = update.workProgress.findIndex(r => r.type === 'permission' && String(r.permissionRequestId || '') === String(serverPerm.requestId));
            const filtered = [];
            let kept = false;
            for (const r of update.workProgress) {
              if (r.type !== 'permission') { filtered.push(r); continue; }
              if (!kept && String(r.permissionRequestId || '') === String(serverPerm.requestId)) { filtered.push(r); kept = true; }
              else if (!kept && keepIdx === -1) { filtered.push(r); kept = true; }
            }
            update.workProgress = filtered;
          }
        }
        if (serverPerm.requestId && !serverEnded) {
          const activePerm = existing.workProgress?.some(r => r.type === 'permission' && !r.endTime);
          if (activePerm && update.workProgress.some(r => r.type !== 'permission' && r.startTime && !r.endTime)) {
            const incomingActiveIdx = update.workProgress.findIndex(r => r.startTime && !r.endTime && r.type !== 'permission');
            if (incomingActiveIdx !== -1) {
              return fail('Cannot start a new task or break while permission is active. End permission first.', 400);
            }
          }
        }
      }
      const lockedRows = (existing?.workProgress || []).filter(r => r.resumedAfter === 'break' || r.resumedAfter === 'permission');
      for (const lr of lockedRows) {
        const stillThere = update.workProgress.some(r => r.startTime === lr.startTime && r.resumedAfter === lr.resumedAfter && r.type === lr.type);
        if (!stillThere) {
          return fail(`Task created after ${lr.resumedAfter} at ${lr.startTime} cannot be deleted.`, 400);
        }
      }
      const activeRows = update.workProgress.filter(row => row.startTime && !row.endTime);
      if (activeRows.length > 1) {
        return fail('Multiple active work rows detected. End the current row before starting another.', 400);
      }
      update.workProgress = update.workProgress.map(row => ({ ...row, duration: computeWorkRowDuration(row) }));
      if (update.workProgress.some(r => r.type === 'permission' && !r.permissionRequestId && r.startTime)) {
        const perm = await Attendance.findOne({ userId: targetUserId, date: today }).select('permission').lean();
        if (perm?.permission?.requestId) {
          update.workProgress = update.workProgress.map(r => r.type === 'permission' && !r.permissionRequestId ? { ...r, permissionRequestId: perm.permission.requestId } : r);
        }
      }
    }

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
