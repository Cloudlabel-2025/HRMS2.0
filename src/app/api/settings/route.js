import dbConnect from '@/lib/db';
import { Department, Shift, Holiday, SystemConfig, Role, Designation, AssetCategory, Leave, SmeExpertise } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

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

const FIELD_ALLOWLIST = {
  departments:  ['name', 'head', 'members'],
  shifts:       ['name', 'startTime', 'endTime', 'days', 'expectedHours', 'hardCapHours', 'absentThreshold', 'lateThreshold', 'earlyLoginWindow', 'breaks', 'autoLogoutAfterShiftEnd'],
  holidays:     ['name', 'date', 'type'],
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

function pickAllowed(type, body) {
  const allowed = FIELD_ALLOWLIST[type] || [];
  return Object.fromEntries(
    allowed
      .filter(key => Object.prototype.hasOwnProperty.call(body, key))
      .map(key => [key, body[key]])
  );
}

function validateSettingsPayload(type, body, { isUpdate = false } = {}) {
  const data = pickAllowed(type, body);

  if (type === 'departments') {
    if (!isUpdate && !data.name?.trim()) return { error: fail('Department name is required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.head !== undefined) data.head = String(data.head).trim();
    if (data.members !== undefined) data.members = Number(data.members) || 0;
  }

  if (type === 'shifts') {
    if (!isUpdate && (!data.name?.trim() || !data.startTime || !data.endTime))
      return { error: fail('Shift name, start time, and end time are required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.days !== undefined && !Array.isArray(data.days))
      return { error: fail('Shift days must be an array', 400) };
    if (data.expectedHours !== undefined) {
      data.expectedHours = Number(data.expectedHours);
      if (isNaN(data.expectedHours) || data.expectedHours < 0) return { error: fail('Expected hours must be a positive number', 400) };
    }
    if (data.hardCapHours !== undefined) {
      data.hardCapHours = Number(data.hardCapHours);
      if (isNaN(data.hardCapHours) || data.hardCapHours < 0) return { error: fail('Hard cap hours must be a positive number', 400) };
      if (data.expectedHours !== undefined && data.hardCapHours < data.expectedHours)
        return { error: fail('Hard cap must be >= expected hours', 400) };
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
        if (!['break', 'lunch'].includes(b.type)) return { error: fail('Break type must be break or lunch', 400) };
        const dur = Number(b.maxDuration);
        if (isNaN(dur) || dur <= 0) return { error: fail('Break maxDuration must be a positive number', 400) };
      }
    }
  }

  if (type === 'holidays') {
    if (!isUpdate && (!data.name?.trim() || !data.date))
      return { error: fail('Holiday name and date are required', 400) };
    if (data.name !== undefined) data.name = data.name.trim();
    if (data.type !== undefined && !['National', 'Optional', 'Company'].includes(data.type))
      return { error: fail('Invalid holiday type', 400) };
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
  const { user, error } = await requireAuth(req);
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
    const conflict = await Leave.findOne({
      status: 'approved',
      from: { $lte: data.date },
      to:   { $gte: data.date },
    });
    if (conflict) {
      return fail(`Cannot mark holiday on ${data.date} — an approved leave (${conflict.type}) already exists for this date`, 400);
    }
  }

  const doc = await MODEL_MAP[type].create(data);
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
  const doc = await MODEL_MAP[type].findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!doc) return fail('Not found', 404);
  return ok(doc);
}

export async function DELETE(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  const adminError = requireSettingsAdmin(user);
  if (adminError) return adminError;

  await dbConnect();
  const { type, id } = await req.json();
  if (!MODEL_MAP[type] || type === 'config') return fail('Invalid type', 400);
  const doc = await MODEL_MAP[type].findByIdAndDelete(id);
  if (!doc) return fail('Not found', 404);
  return ok({ deleted: true });
}
