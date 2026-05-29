import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  return ok(user);
}
