import dbConnect from '@/lib/db';
import { LeavePolicy } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const ADMIN_ROLES = ['super_admin', 'admin_full'];

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  await dbConnect();
  const policies = await LeavePolicy.find().populate('leaveTypeConfigs.typeId', 'name code color icon').sort({ createdAt: -1 });
  return ok(policies);
}

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  await dbConnect();
  const body = await req.json();
  if (!body.name?.trim()) return fail('Policy name is required', 400);

  const doc = await LeavePolicy.create(body);
  await auditLog('Leave Policy Created', 'Settings', user._id, `Created policy: ${doc.name}`, 'medium', req.headers.get('x-forwarded-for') || '');
  return ok(doc, 201);
}
