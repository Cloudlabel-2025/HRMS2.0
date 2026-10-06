import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Notification, Holiday } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getGlobalConfig, parseShiftStartTime, isWorkingDay } from '@/lib/payroll-cycle';
import { getShiftAwareToday } from '@/lib/shift-today';
import { getTzTime } from '@/lib/timezone';
import { checkAndApplyAutoLogout } from '@/lib/attendance-utils';
import { resolveShift, resolveShiftForDate, getShiftEndMinutes } from '@/lib/shift-utils';
import { getShiftConfig, computeWorkRowDuration, closeExtraActiveRows } from '@/lib/attendance-constants';
import { resolveDayStatus } from '@/lib/attendance-resolver';
import { reconcilePermissionWorkProgress } from '@/lib/permission-work';
import { isWorkedDay } from '@/lib/attendance-stats';
import { syncCalendarRowsForUsers } from '@/lib/attendance-sync';
import { matchBreakRule, calculateBreakDeduction } from '@/lib/attendance-breaks';
import { getAccessibleDepartments } from '@/lib/rbac';
import { isEmployer } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { publishAttendance } from '@/lib/sse';

// Throttle for the read-path calendar sync (Step: self-healing register).
// Keyed by range + roster size so rapid refreshes don't re-issue bulkWrites.
const _attendanceSyncThrottle = new Map();

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

    const now = await getTzTime();
    const config = await getGlobalConfig();
    const _calToday = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

    // Self-healing register: materialise absent/holiday/leave rows for the
    // requested report range so the team report shows the full calendar even
    // when the daily sweep hasn't run. Insert-only and idempotent — clocked
    // rows are never touched, today is left for Not-Arrived (derived below).
    let holidayDocs = [];
    let syncUids = [];
    let syncFrom = null;
    let syncTo = null;
    if (!openOnly && !date) {
      if (fromDate || toDate) {
        syncFrom = fromDate || toDate;
        syncTo = toDate || fromDate;
      } else if (month && /^\d{4}-\d{2}$/.test(month)) {
        const [yy, mm] = month.split('-').map(Number);
        const last = new Date(yy, mm, 0).getDate();
        syncFrom = `${month}-01`;
        syncTo = `${month}-${String(last).padStart(2, '0')}`;
      }
      if (syncFrom && syncTo && syncFrom <= syncTo) {
        const qUid = query.userId;
        if (typeof qUid === 'string') syncUids = [qUid];
        else if (Array.isArray(qUid)) syncUids = qUid.map(u => String(u));
        else if (qUid && typeof qUid === 'object') {
          if (Array.isArray(qUid.$in)) syncUids = qUid.$in.map(u => String(u));
          else {
            // All-users scope ({ $nin }) — resolve the roster once.
            const all = await User.find({ status: 'active', role: { $ne: 'super_admin' } }).select('_id').lean().catch(() => []);
            syncUids = (all || []).map(u => String(u._id));
          }
        }
        holidayDocs = await Holiday.find({ date: { $gte: syncFrom, $lte: syncTo } }).select('date name type workingDayOverride').lean().catch(() => []);
        if (syncUids.length) {
          const tKey = `${syncFrom}|${syncTo}|${syncUids.length}|${syncUids[0] || ''}`;
          const lastSync = _attendanceSyncThrottle.get(tKey);
          if (!lastSync || Date.now() - lastSync > 60000) {
            _attendanceSyncThrottle.set(tKey, Date.now());
            if (_attendanceSyncThrottle.size > 500) _attendanceSyncThrottle.clear();
            try {
              await syncCalendarRowsForUsers({
                userIds: syncUids,
                fromDate: syncFrom,
                toDate: syncTo,
                config,
                holidays: holidayDocs,
                todayStr: _calToday,
                allowTodayAbsent: false,
              });
            } catch (e) { console.error('attendance read-sync failed:', e?.message || e); }
          }
        }
      }
    }

    let raw = await Attendance.find(query)
      .populate('userId', 'name avatar department role shift shiftId')
      .sort({ date: -1 })
      .lean();

    // Permission lifecycle (read-path self-heal): materialise the
    // type:'permission' workProgress row for TODAY's open records so the
    // sheet shows the permission and the End Permission button can render.
    // Historical days are never touched. Persists via bulkWrite with the
    // raw subdocs so no schema-declared field is ever stripped.
    try {
      const nowStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      const permReconOps = [];
      for (const rec of raw) {
        if (!rec || rec.date !== _calToday || !rec.clockIn || rec.clockOut) continue;
        if (employerIdSet.has(rec.userId?._id?.toString())) continue;
        if (!rec.permission?.requestId) continue;
        try {
          if (reconcilePermissionWorkProgress(rec, nowStr)) {
            permReconOps.push({
              updateOne: {
                filter: { _id: rec._id },
                update: { $set: { workProgress: rec.workProgress, permission: rec.permission } },
              },
            });
          }
        } catch (e) { console.error('Permission read-reconcile failed:', e?.message || e); }
      }
      if (permReconOps.length > 0) {
        await Attendance.bulkWrite(permReconOps).catch(err => {
          console.error('Failed to persist permission work-progress reconcile:', err);
        });
      }
    } catch (e) { console.error('Permission read-reconcile pass failed:', e?.message || e); }

    // Holiday name join (read-time, never stored): renaming a holiday in
    // Settings updates every historical row immediately.
    if (holidayDocs.length) {
      const nameByDate = new Map(holidayDocs.map(h => [h.date, h]));
      for (const rec of raw) {
        if (rec.nonWorkingDayType === 'holiday') {
          const h = nameByDate.get(rec.date);
          if (h) { rec.holidayName = h.name; rec.holidayType = h.type; }
        }
      }
    }

    // Not-arrived derivation (display-only, never persisted) is applied
    // after resolveShiftForRow is defined — see below.

    const clockedUsers = raw.filter(r => r.clockIn && r.userId?._id).map(r => r.userId);
    const uniqueUsers = [...new Map(clockedUsers.map(u => [u._id.toString(), u])).values()];
    const shiftByUserId = {};
    for (const u of uniqueUsers) {
      const sd = await resolveShift(u);
      if (sd) shiftByUserId[u._id.toString()] = sd;
    }

    // Per-day shift resolver: frozen snapshot first, then historical
    // ShiftChange lineage for past dates, then current shift fallback.
    // Cached per user+date to avoid N+1 query blowup on Vercel.
    const _histShiftCache = new Map();
    const resolveShiftForRow = async (rec) => {
      const uid = rec.userId?._id?.toString() || '';
      if (rec.date && rec.userId?._id) {
        const key = uid + '|' + rec.date;
        if (!_histShiftCache.has(key)) {
          try {
            const hist = await resolveShiftForDate(rec.userId, rec.date, { fallbackToCurrent: false });
            _histShiftCache.set(key, hist || null);
          } catch { _histShiftCache.set(key, null); }
        }
        const hist = _histShiftCache.get(key);
        if (hist) return hist;
      }
      if (rec.shiftStartTime) {
        return {
          _id: rec.shiftId || null,
          name: rec.shiftName || rec.userId?.shift || '',
          startTime: rec.shiftStartTime,
          endTime: rec.shiftEndTime || '',
          lateThreshold: rec.shiftLateThreshold ?? null,
        };
      }
      return shiftByUserId[uid] || null;
    };

    // Not-arrived derivation (display-only, never persisted): today, no
    // clock-in, shift half-day threshold not yet elapsed. Mirrors the Absence
    // page; the end-of-day sweep owns today's real absent rows.
    try {
      const { resolveShiftStartMins, elapsedSinceShiftStart } = await import('@/lib/absence-status');
      const inRange = syncFrom && syncTo && _calToday >= syncFrom && _calToday <= syncTo;
      const todayKeys = new Set(raw.filter(r => r.date === _calToday).map(r => String(r.userId?._id || r.userId)));
      const missingUids = syncUids.filter(uid => !todayKeys.has(String(uid)));
      if (missingUids.length && inRange && isWorkingDay(_calToday, config, holidayDocs)) {
        const missingUsers = await User.find({ _id: { $in: missingUids } }).select('name avatar department role shift shiftId').lean().catch(() => []);
        for (const u of missingUsers || []) {
          if (isEmployer(u.role)) continue;
          let shiftDoc = null;
          try { shiftDoc = await resolveShift(u); } catch { shiftDoc = null; }
          const halfDayThreshold = Number(shiftDoc?.halfDayThreshold ?? 180) || 180;
          const shiftStartMins = resolveShiftStartMins(shiftDoc, u.shift);
          const elapsed = elapsedSinceShiftStart(now, shiftStartMins);
          if (elapsed < halfDayThreshold) {
            raw.push({
              _id: `notarrived_${u._id}_${_calToday}`,
              userId: u,
              date: _calToday,
              status: 'absent',
              clockIn: null,
              clockOut: null,
              hoursWorked: 0,
              payableHours: 0,
              shortHours: false,
              lateFlag: false,
              nonWorkingDayType: 'none',
              notArrived: true,
              displayStatus: 'not_arrived',
              _virtual: true,
            });
          }
        }
        raw.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }
      // Rows that exist for today but are still pre-threshold: mark the
      // no-clock-in ones as not-arrived instead of absent. Source-aware:
      // the schema's empty importedPresence object must not suppress this.
      for (const rec of raw) {
        if (rec.date !== _calToday || isWorkedDay(rec)) continue;
        if (['leave', 'holiday'].includes(rec.status)) continue;
        const shiftDoc = await resolveShiftForRow(rec);
        const halfDayThreshold = Number(shiftDoc?.halfDayThreshold ?? 180) || 180;
        const shiftStartMins = resolveShiftStartMins(shiftDoc, rec.userId?.shift);
        const elapsed = elapsedSinceShiftStart(now, shiftStartMins);
        if (elapsed < halfDayThreshold) {
          rec.notArrived = true;
          rec.displayStatus = 'not_arrived';
        }
      }
    } catch (e) { console.error('not-arrived derivation failed:', e?.message || e); }

    // Lazy auto-logout honoring each user's shift setup (endTime + autoLogoutAfterShiftEnd buffer).
    // Past dates use the historical shift so the grace deadline matches that day's config.
    for (const rec of raw) {
      if (!rec.clockIn || rec.clockOut) continue;
      if (employerIdSet.has(rec.userId?._id?.toString())) continue;
      const shiftDoc = await resolveShiftForRow(rec);
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
    // (per-day rule). Never overwrite explicit leave/holiday decisions
    // (rejected overrides). Permission rows are recomputed with
    // the permission window (actual clockIn is preserved, never faked),
    // and shortHours is suppressed on permission days.
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
      // Permission time, including any overrun before it is ended, is excused
      // from short-hours calculation. Overruns are tracked separately as Late.
      // An approved, on-time permission forces Present (even mid-day).
      // An OVER-RUN permission (ended late) keeps the resolver's verdict
      // so the day is marked Late instead of being masked as Present.
      // Exception: an APPLIED arrival-cover permission already fulfilled its
      // purpose at clock-in — a late close later in the day is not an overrun.
      if (rec.permission?.requestId || rec.permission?.startTime) {
        if (rec.permission?.endedLate && rec.permission?.applied !== true) {
          rec.status = rec.status === 'present' ? 'late' : rec.status;
          rec.lateFlag = true;
          rec.shortHours = false;
          rec._permissionStatus = 'approved_late';
        } else {
          rec.shortHours = false;
          rec.status = 'present';
          rec.lateFlag = false;
          rec._permissionStatus = 'approved';
        }
        // Keep the breakdown consistent with the suppressed flag so the UI
        // never renders "short by 60m" next to an excused permission day.
        rec.shortfallMins = 0;
        rec.breakExcessMins = 0;
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

    // Persist today's status corrections only. Historical corrections are
    // performed explicitly after the target database and shift are verified.
    const bulkOps = raw
      .filter(rec => rec.clockIn && rec._id && rec.date === _calToday)
      .map(rec => ({
        updateOne: {
          filter: { _id: rec._id },
          update: { $set: { status: rec.status, lateFlag: rec.lateFlag, shortHours: !!rec.shortHours, shortfallMins: rec.shortfallMins ?? 0, breakExcessMins: rec.breakExcessMins ?? 0 } }
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
        record.shortHours = false;
        record.shortfallMins = 0;
        record.breakExcessMins = 0;
        record.earlyLogin = false;
        await record.save();

        await notify(record.userId, 'Attendance Rejected',
          `Your clock-in on ${record.date} has been rejected by ${user.name}. Status reverted to ${record.status}.`, 'attendance', record._id);

        return ok(record);
      }
    }

    // Update by record ID (e.g. absence reason from the Team view).
    // The old date-based path below resolves to the caller's own "today"
    // when userId/date are omitted, so a { recordId } payload would miss
    // and return 404 ("Attendance record not found").
    const recordId = body.recordId || (!body.action ? body.attendanceId : null);
    if (recordId) {
      if (typeof recordId === 'string' && recordId.startsWith('notarrived_')) {
        return fail('No attendance record exists for this day yet', 400);
      }
      if (!['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user.role)) {
        return fail('Access denied', 403);
      }
      const record = await Attendance.findById(recordId).catch(() => null);
      if (!record) return fail('Attendance record not found', 404);
      // Scope team leads / team admins to their own departments.
      if (['team_lead', 'team_admin'].includes(user.role)) {
        const depts = await getAccessibleDepartments(user);
        if (depts !== null) {
          const targetUser = await User.findById(record.userId).select('department').lean();
          if (!targetUser || !depts.includes(targetUser.department)) return fail('Access denied', 403);
        }
      }
      if ('absenceReason' in body) record.absenceReason = body.absenceReason;
      else return fail('Nothing to update', 400);
      await record.save();
      return ok(record);
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
      // Self-heal instead of wedging the day: keep the most recently
      // started open row, close any earlier ones (clamped to their own
      // start so no negative duration is invented). Previously this was a
      // hard 400 that left already-broken days permanently unsavable.
      const openRows = update.workProgress.filter(row => row.startTime && !row.endTime);
      if (openRows.length > 1) {
        const latestStart = openRows.map(r => r.startTime).sort().reverse()[0];
        const healed = closeExtraActiveRows(update.workProgress, latestStart);
        update.workProgress = healed.rows;
        try {
          const { auditLog } = await import('@/lib/middleware');
          await auditLog('Work Progress Self-Heal', 'Attendance', user._id,
            `Collapsed ${healed.healed} extra active row(s) on ${today} (kept ${latestStart})`, 'low',
            req.headers.get('x-forwarded-for') || '', null, user._id);
        } catch { /* non-fatal */ }
      }
      update.workProgress = update.workProgress.map(row => ({ ...row, duration: computeWorkRowDuration(row) }));
    }

    // Enforce break limits from shift config, then recompute the derived
    // values. Break edits change the excess, which is one of the two triggers
    // behind shortHours — trusting client-supplied hours here would silently
    // desynchronise the flag from the actual breaks on the record.
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

      const current = await Attendance.findOne({ userId: targetUserId, date: today }).lean();
      if (current?.clockIn && current?.clockOut) {
        const elapsed = Math.max(0, diffMins(current.clockIn, current.clockOut));
        const deduction = calculateBreakDeduction(body.breaks, shiftCfg.breaks);
        const shiftEndMins = shiftDoc ? getShiftEndMinutes(shiftDoc, shiftCfg) : null;
        const { baseHours, hoursWorked, payableHours, shortfallMins, breakExcessMins, shortHours } =
          calculateHoursWorked(elapsed, deduction, shiftCfg, {
            clockOut: current.clockOut,
            shiftEndMins,
            breakExcessMins: deduction,
          });
        const hasPermission = !!(current.permission?.requestId || current.permission?.startTime);
        update.breakDeduction = deduction;
        update.baseHoursWorked = baseHours;
        update.hoursWorked = hoursWorked;
        update.payableHours = payableHours;
        update.shortHours = hasPermission ? false : shortHours;
        update.shortfallMins = hasPermission ? 0 : shortfallMins;
        update.breakExcessMins = hasPermission ? 0 : breakExcessMins;
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
