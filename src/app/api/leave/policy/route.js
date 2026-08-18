import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { resolvePolicyForUser } from '@/app/api/leave/balance/route';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const policy = await resolvePolicyForUser(user);
  if (!policy) return fail('No active leave policy found for your role', 400);

  return ok(policy);
}
