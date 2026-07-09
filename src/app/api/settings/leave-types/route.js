import dbConnect from '@/lib/db';
import { LeaveType } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { z } from 'zod';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

const UpsertTypeSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  code: z.string().min(1).max(20).trim().toUpperCase(),
  description: z.string().max(500).optional().default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').default('#3b82f6'),
  icon: z.string().max(50).default('bi-calendar-check'),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  await dbConnect();
  const types = await LeaveType.find().sort({ sortOrder: 1, name: 1 });
  return ok(types);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  await dbConnect();
  const body = await req.json();
  const parsed = UpsertTypeSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Validation failed: ' + parsed.error.issues.map(i => i.message).join('; '), 400);
  }

  const existing = await LeaveType.findOne({ $or: [{ name: parsed.data.name }, { code: parsed.data.code }] });
  if (existing) return fail('A leave type with this name or code already exists', 400);

  const doc = await LeaveType.create(parsed.data);
  await auditLog('Leave Type Created', 'Settings', user._id, `Created leave type: ${doc.name} (${doc.code})`, 'low', req.headers.get('x-forwarded-for') || '');
  return ok(doc, 201);
}

export async function PUT(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  await dbConnect();
  const { id, ...body } = await req.json();
  if (!id) return fail('id is required', 400);

  const parsed = UpsertTypeSchema.partial().safeParse(body);
  if (!parsed.success) {
    return fail('Validation failed: ' + parsed.error.issues.map(i => i.message).join('; '), 400);
  }

  const doc = await LeaveType.findByIdAndUpdate(id, parsed.data, { new: true, runValidators: true });
  if (!doc) return fail('Not found', 404);

  await auditLog('Leave Type Updated', 'Settings', user._id, `Updated leave type: ${doc.name}`, 'low', req.headers.get('x-forwarded-for') || '');
  return ok(doc);
}

export async function DELETE(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  await dbConnect();
  const { id } = await req.json();
  if (!id) return fail('id is required', 400);

  // Soft-delete: set inactive
  const doc = await LeaveType.findByIdAndUpdate(id, { isActive: false }, { new: true });
  if (!doc) return fail('Not found', 404);

  await auditLog('Leave Type Deactivated', 'Settings', user._id, `Deactivated leave type: ${doc.name}`, 'medium', req.headers.get('x-forwarded-for') || '');
  return ok({ deactivated: true });
}
