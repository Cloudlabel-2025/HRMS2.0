import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { ok, fail } from '@/lib/jwt';

function getSubmittedSetupToken(req, body = {}) {
  return req.headers.get('x-setup-token') || body.setupToken || '';
}

export async function POST(req) {
  try {
    const expectedToken = process.env.SETUP_TOKEN;
    if (!expectedToken) {
      return fail('Seed route is disabled. Set SETUP_TOKEN only for controlled first-time setup.', 403);
    }

    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_SEED_ROUTE !== 'true') {
      return fail('Seed route is disabled in production', 403);
    }

    const body = await req.json().catch(() => ({}));
    if (getSubmittedSetupToken(req, body) !== expectedToken) {
      return fail('Invalid setup token', 403);
    }

    await dbConnect();

    const existing = await User.findOne({ role: 'super_admin' });
    if (existing) return fail('Super admin already exists', 409);

    const { SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
    if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD) return fail('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env.local', 400);

    const admin = await User.create({
      name: SEED_ADMIN_NAME || 'Super Admin',
      email: SEED_ADMIN_EMAIL,
      password: SEED_ADMIN_PASSWORD,
      role: 'super_admin',
      status: 'active',
    });

    return ok({ message: 'Super admin created', email: admin.email }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
