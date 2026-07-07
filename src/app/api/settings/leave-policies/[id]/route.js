import dbConnect from '@/lib/db';
import { LeavePolicy } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

export async function GET(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const { id } = await params;
  await dbConnect();
  const doc = await LeavePolicy.findById(id).populate('leaveTypeConfigs.typeId', 'name code color icon');
  if (!doc) return fail('Not found', 404);
  return ok(doc);
}

export async function PUT(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const { id } = await params;
  await dbConnect();
  const body = await req.json();

  // prevent changing _id
  delete body._id;

  const doc = await LeavePolicy.findByIdAndUpdate(id, body, { new: true, runValidators: true })
    .populate('leaveTypeConfigs.typeId', 'name code color icon');
  if (!doc) return fail('Not found', 404);

  await auditLog('Leave Policy Updated', 'Settings', user._id, `Updated policy: ${doc.name}`, 'medium', req.headers.get('x-forwarded-for') || '');
  return ok(doc);
}

export async function DELETE(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const { id } = await params;
  await dbConnect();

  const doc = await LeavePolicy.findByIdAndUpdate(id, { status: 'archived' }, { new: true });
  if (!doc) return fail('Not found', 404);

  await auditLog('Leave Policy Archived', 'Settings', user._id, `Archived policy: ${doc.name}`, 'medium', req.headers.get('x-forwarded-for') || '');
  return ok({ archived: true });
}
