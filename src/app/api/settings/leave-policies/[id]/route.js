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
  const doc = await LeavePolicy.findById(id);
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

  const doc = await LeavePolicy.findByIdAndUpdate(id, body, { new: true, runValidators: true });
  if (!doc) return fail('Not found', 404);

  // Enforce single default — if this policy is being set as default, unset all others
  if (body.isDefault === true) {
    await LeavePolicy.updateMany(
      { _id: { $ne: doc._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }

  await auditLog('Leave Policy Updated', 'Settings', user._id, `Updated policy: ${doc.name}`, 'medium', req.headers.get('x-forwarded-for') || '');
  return ok(doc);
}

export async function DELETE(req, { params }) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const { id } = await params;
  const hardDelete = new URL(req.url).searchParams.get('hard') === 'true';
  await dbConnect();

  const doc = await LeavePolicy.findById(id);
  if (!doc) return fail('Not found', 404);

  if (hardDelete) {
    if (doc.isDefault) return fail('Cannot delete the default policy. Set another policy as default first.', 400);
    await LeavePolicy.findByIdAndDelete(id);
    await auditLog('Leave Policy Deleted', 'Settings', user._id, `Permanently deleted policy: ${doc.name}`, 'high', req.headers.get('x-forwarded-for') || '');
    return ok({ deleted: true });
  }

  if (doc.isDefault) return fail('Cannot archive the default policy. Set another policy as default first.', 400);

  doc.status = 'archived';
  await doc.save();

  await auditLog('Leave Policy Archived', 'Settings', user._id, `Archived policy: ${doc.name}`, 'medium', req.headers.get('x-forwarded-for') || '');
  return ok({ archived: true });
}
