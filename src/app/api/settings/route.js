import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import { Department, Shift, Holiday, SystemConfig, Role, Designation, AssetCategory, Leave, SmeExpertise, Employee } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { notify } from '@/lib/notify';
import { getGlobalConfig } from '@/lib/payroll-cycle';
import { syncCalendarRowsForUsers } from '@/lib/attendance-sync';

const MODEL_MAP = {
  departments:        Department,
  shifts:             Shift,
  holidays:           Holiday,
  config:             SystemConfig,
  roles:              Role,
  designations:       Designation,
  categories:         AssetCategory,
  sme_expertise:      SmeExpertise,
};

const ADMIN_ROLES = ['super_admin', 'admin_full'];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOLIDAY_TYPES = ['National', 'Optional', 'Company'];
const HOLIDAY_SOURCES = ['manual', 'saturday_alternate'];

const FIELD_ALLOWLIST = {
  departments:  ['name', 'head', 'members', 'visibleDepartments'],
  shifts:       ['name', 'startTime', 'endTime', 'days', 'expectedHours', 'absentThreshold', 'lateThreshold', 'earlyLoginWindow', 'breaks', 'autoLogoutAfterShiftEnd', 'halfDayThreshold'],
  holidays:     ['name', 'date', 'type', 'source', 'workingDayOverride', 'overrideReason'],
  config:       ['key', 'value'],
  roles:        ['name', 'description'],
  designations: ['name', 'department', 'description'],
  categories:   ['name', 'description'],
  sme_expertise:['name'],
};

function requireSettingsAdmin(user) {
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);
  return null;
}

function localTodayStr() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

function isSaturdayDate(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && d.getDay() === 6;
}

/**
 * Immediately propagate a holiday add/remove to attendance rows for that
 * single date, so past-date holidays reflect everywhere without waiting
 * for the daily sweep. Mirrors daily-sweep semantics: past dates may be
 * marked absent (allowAbsent), today/future never are. Future dates no-op
 * inside the sync (dates > today are skipped).
 */
async function syncHolidayDate(dateStr, { allowAbsent }) {
  const config = await getGlobalConfig();
  // Include the override flag — without it the sync would treat a compensated
  // Saturday as a holiday and flip the rows the wrong way.
  const holidays = await Holiday.find({}).select('date workingDayOverride').lean().catch(() => []);
  const users = await User.find({ status: 'active' }).select('_id').lean().catch(() => []);
  return syncCalendarRowsForUsers({
    userIds: users.map(u => u._id),
    fromDate: dateStr,
    toDate: dateStr,
    config,
    holidays,
    todayStr: null,
    allowTodayAbsent: allowAbsent,
  });
}

async function approvedLeaveOn(dateStr) {
  return Leave.findOne({ status: 'approved', from: { $lte: dateStr }, to: { $gte: dateStr } }).lean();
}

function pickAllowed(type, body) {
  const allowed = FIELD_ALLOWLIST[type] || [];
  return Object.fromEntries(
    allowed
      .filter(key => Object.prototype.hasOwnProperty.call(body, key))
      .map(key => [key, body[key]])
  );
}

function validateSettingsPayload(type, body, { isUpdate = false } = {}) {
  // Holiday kind arrives as `holidayType`: the generic route discriminator
  // is also called `type`, so a holiday `type` field would collide with it
  // (and in fact broke Settings holiday CRUD — the object literal resolved
  // `type` to 'National' before ever leaving the browser). Translate first.
  let normalized = body;
  if (type === 'holidays' && body && typeof body === 'object' && 'holidayType' in body) {
    const { holidayType, ...rest } = body;
    normalized = { ...rest, type: holidayType };
  }
  const data = pickAllowed(type, normalized);

  if (type === 'departments') {
    if (!isUpdate && !data.name?.trim()) return { error: fail('Department name is required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.head !== undefined) data.head = String(data.head).trim();
    if (data.members !== undefined) data.members = Number(data.members) || 0;
  }

  if (type === 'shifts') {
    if (!isUpdate && (!data.name?.trim() || !data.startTime || !data.endTime))
      return { error: fail('Shift name, start time, and end time are required', 400) };
    if (data.startTime !== undefined && !TIME_RE.test(data.startTime)) return { error: fail('Start time must be in HH:MM (24-hour) format', 400) };
    if (data.endTime !== undefined && !TIME_RE.test(data.endTime)) return { error: fail('End time must be in HH:MM (24-hour) format', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.days !== undefined && !Array.isArray(data.days))
      return { error: fail('Shift days must be an array', 400) };
    if (data.expectedHours !== undefined) {
      data.expectedHours = Number(data.expectedHours);
      if (isNaN(data.expectedHours) || data.expectedHours < 0) return { error: fail('Expected hours must be a positive number', 400) };
    }
    if (data.absentThreshold !== undefined) {
      data.absentThreshold = Number(data.absentThreshold);
      if (isNaN(data.absentThreshold) || data.absentThreshold < 0) return { error: fail('Absent threshold must be a positive number', 400) };
    }
    if (data.lateThreshold !== undefined) {
      data.lateThreshold = Number(data.lateThreshold);
      if (isNaN(data.lateThreshold) || data.lateThreshold < 0) return { error: fail('Late threshold must be a positive number', 400) };
    }
    if (data.earlyLoginWindow !== undefined) {
      data.earlyLoginWindow = Number(data.earlyLoginWindow);
      if (isNaN(data.earlyLoginWindow) || data.earlyLoginWindow < 0) return { error: fail('Early login window must be a positive number', 400) };
    }
    if (data.autoLogoutAfterShiftEnd !== undefined) {
      data.autoLogoutAfterShiftEnd = Number(data.autoLogoutAfterShiftEnd);
      if (isNaN(data.autoLogoutAfterShiftEnd) || data.autoLogoutAfterShiftEnd < 0) return { error: fail('Auto-logout must be a positive number', 400) };
    }
    if (data.breaks !== undefined) {
      if (!Array.isArray(data.breaks)) return { error: fail('Breaks must be an array', 400) };
      for (const b of data.breaks) {
        if (!b.type || typeof b.type !== 'string' || !b.type.trim()) b.type = b.name?.trim() || 'break';
        const dur = Number(b.maxDuration);
        if (isNaN(dur) || dur <= 0) return { error: fail('Break maxDuration must be a positive number', 400) };
      }
    }
  }

  if (type === 'holidays') {
    if (!isUpdate && (!data.name?.trim() || !data.date))
      return { error: fail('Holiday name and date are required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.date !== undefined && !DATE_RE.test(String(data.date)))
      return { error: fail('Holiday date must be YYYY-MM-DD', 400) };
    if (data.type !== undefined && !HOLIDAY_TYPES.includes(data.type))
      return { error: fail('Invalid holiday type', 400) };
    if (data.source !== undefined && !HOLIDAY_SOURCES.includes(data.source))
      return { error: fail('Invalid holiday source', 400) };
    if (data.source === undefined && !isUpdate) data.source = 'manual';
    // Compensated working day: normalise the boolean; the Saturday-only rule
    // is enforced in POST/PUT where the effective date (payload or existing
    // row) is known.
    if (data.workingDayOverride !== undefined) {
      data.workingDayOverride = data.workingDayOverride === true || data.workingDayOverride === 'true';
    }
  }

  if (type === 'config') {
    if (!data.key?.trim()) return { error: fail('Config key is required', 400) };
    data.key = data.key.trim();
  }

  if (type === 'roles') {
    if (!isUpdate && !data.name?.trim()) return { error: fail('Role name is required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
  }

  if (type === 'designations') {
    if (!isUpdate && !data.name?.trim()) return { error: fail('Designation name is required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.department !== undefined) data.department = data.department.trim();
  }

  if (type === 'categories') {
    if (!isUpdate && !data.name?.trim()) return { error: fail('Category name is required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
  }

  if (type === 'sme_expertise') {
    if (!isUpdate && !data.name?.trim()) return { error: fail('Expertise name is required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
  }

  return { data };
}

export async function GET(req) {
  const { error } = await requireAuth(req);
  if (error) return error;
  await dbConnect();
  const type = new URL(req.url).searchParams.get('type');
  if (!MODEL_MAP[type]) return fail('Invalid type', 400);
  const data = await MODEL_MAP[type].find().sort({ name: 1 });
  return ok(data);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  const adminError = requireSettingsAdmin(user);
  if (adminError) return adminError;

  await dbConnect();
  const { type, ...body } = await req.json();
  if (!MODEL_MAP[type]) return fail('Invalid type', 400);
  const { data, error: validationError } = validateSettingsPayload(type, body);
  if (validationError) return validationError;

  if (type === 'config') {
    const doc = await MODEL_MAP[type].findOneAndUpdate({ key: data.key }, { value: data.value }, { new: true, upsert: true });
    return ok(doc);
  }

  if (type === 'holidays') {
    // An override is not "marking a holiday" — it makes the date working, and
    // any approved leave on it is re-evaluated rather than blocking creation.
    // A Saturday-only gate applies to both paths below.
    const isOverride = data.workingDayOverride === true;
    if (!isOverride) {
      const conflict = await approvedLeaveOn(data.date);
      if (conflict) {
        return fail(`Cannot mark holiday on ${data.date} — an approved leave (${conflict.type}) already exists for this date`, 400);
      }
    }
    if (isOverride && !isSaturdayDate(data.date)) {
      return fail('Only Saturdays can be marked as working days', 400);
    }
    const dup = await Holiday.findOne({ date: data.date }).select('_id').lean();
    if (dup) {
      return fail(`A holiday already exists on ${data.date}`, 409);
    }
  }

  const doc = await MODEL_MAP[type].create(data);

  if (type === 'holidays') {
    let synced = null;
    try {
      synced = await syncHolidayDate(doc.date, { allowAbsent: false });
    } catch (e) { console.error('Holiday post-create sync failed:', e?.message || e); }
    try {
      await auditLog('Holiday Created', 'Settings', user._id, `Marked ${doc.date} as holiday (${doc.name})`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    } catch { /* non-fatal */ }
    return ok({ ...doc.toObject(), synced }, 201);
  }

  if (type === 'shifts') {
    const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
    const adminIds = admins.map(a => a._id);
    await notify(adminIds, 'Shift Created', `New shift "${doc.name}" created — ${doc.startTime} to ${doc.endTime}.`, 'shift', doc._id);
    return ok({ ...doc.toObject(), notifiedCount: adminIds.length }, 201);
  }

  return ok(doc, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  const adminError = requireSettingsAdmin(user);
  if (adminError) return adminError;

  await dbConnect();
  const { type, id, ...body } = await req.json();
  if (!MODEL_MAP[type]) return fail('Invalid type', 400);
  const { data, error: validationError } = validateSettingsPayload(type, body, { isUpdate: true });
  if (validationError) return validationError;
  if (type === 'departments' && data.visibleDepartments !== undefined) {
    data.visibleDepartments = Array.isArray(data.visibleDepartments) ? data.visibleDepartments : [];
  }
  const prev = (type === 'shifts' || type === 'holidays') ? await MODEL_MAP[type].findById(id).lean() : null;
  if (type === 'holidays' && data.date && prev && prev.date !== data.date) {
    const conflict = await approvedLeaveOn(data.date);
    if (conflict) {
      return fail(`Cannot move holiday to ${data.date} — an approved leave (${conflict.type}) already exists for this date`, 400);
    }
    const dup = await Holiday.findOne({ date: data.date, _id: { $ne: id } }).select('_id').lean();
    if (dup) {
      return fail(`A holiday already exists on ${data.date}`, 409);
    }
  }
  // The override flag alone (no date move) still needs the Saturday-only rule,
  // checked against the row's effective date.
  if (type === 'holidays' && data.workingDayOverride === true) {
    const effectiveDate = data.date || prev?.date;
    if (!isSaturdayDate(effectiveDate)) {
      return fail('Only Saturdays can be marked as working days', 400);
    }
  }
  const doc = await MODEL_MAP[type].findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!doc) return fail('Not found', 404);

  if (type === 'holidays') {
    const dates = [...new Set([prev?.date, doc.date].filter(Boolean))];
    let synced = null;
    try {
      for (const d of dates) {
        const r = await syncHolidayDate(d, { allowAbsent: false });
        synced = { inserted: (synced?.inserted || 0) + (r.inserted || 0), updated: (synced?.updated || 0) + (r.updated || 0), skipped: (synced?.skipped || 0) + (r.skipped || 0) };
      }
    } catch (e) { console.error('Holiday post-update sync failed:', e?.message || e); }
    try {
      await auditLog('Holiday Updated', 'Settings', user._id, `Updated holiday ${doc.date} (${doc.name})`, 'low', req.headers.get('x-forwarded-for') || '', null, user._id);
    } catch { /* non-fatal */ }
    return ok({ ...doc.toObject(), synced });
  }

  if (type === 'shifts') {
    const affected = await Employee.find({ $or: [{ shiftId: doc._id }, { shift: prev?.name }] }).select('userId').lean();
    const userIds = [...new Set(affected.map(e => e.userId?.toString()).filter(Boolean))];
    await notify(userIds, 'Shift Updated', `Your shift "${doc.name}" has been updated — new hours ${doc.startTime} to ${doc.endTime}.`, 'shift', doc._id);
    return ok({ ...doc.toObject(), notifiedCount: userIds.length });
  }

  return ok(doc);
}

export async function DELETE(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  const adminError = requireSettingsAdmin(user);
  if (adminError) return adminError;

  await dbConnect();
  const { type, id, preview } = await req.json();
  if (!MODEL_MAP[type] || type === 'config') return fail('Invalid type', 400);

  // Holiday undo: preview the attendance consequence before deleting, then
  // re-sync that date immediately so the warned-about outcome is visible
  // at once instead of surfacing silently via a later sweep.
  if (type === 'holidays' && preview === true) {
    const target = await Holiday.findById(id).lean();
    if (!target) return fail('Not found', 404);
    const rows = await Attendance.find({ date: target.date }).select('status clockIn importedPresence').lean();
    const worked = rows.filter(r => r.clockIn || r.importedPresence?.source).length;
    const onLeave = rows.filter(r => !r.clockIn && !r.importedPresence?.source && (r.status === 'leave' || r.status === 'half_day')).length;
    const nonWorked = rows.length - worked - onLeave;
    return ok({
      preview: true,
      holiday: { _id: String(target._id), name: target.name, date: target.date, type: target.type },
      impact: { total: rows.length, worked, onLeave, nonWorked },
    });
  }

  const doc = await MODEL_MAP[type].findByIdAndDelete(id);
  if (!doc) return fail('Not found', 404);

  if (type === 'holidays') {
    let synced = null;
    try {
      // Mirror the sweep: past dates may flip non-worked rows to absent.
      synced = await syncHolidayDate(doc.date, { allowAbsent: doc.date <= localTodayStr() });
    } catch (e) { console.error('Holiday post-delete sync failed:', e?.message || e); }
    try {
      await auditLog('Holiday Removed', 'Settings', user._id, `Removed holiday ${doc.date} (${doc.name})`, 'medium', req.headers.get('x-forwarded-for') || '', null, user._id);
    } catch { /* non-fatal */ }
    return ok({ deleted: true, synced });
  }

  return ok({ deleted: true });
}
