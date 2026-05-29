import { verifyToken, signToken, ok, fail } from '@/lib/jwt';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';

export async function POST(req) {
  try {
    const { refreshToken } = await req.json();
    if (!refreshToken) return fail('Refresh token required', 401);

    const decoded = verifyToken(refreshToken);
    if (!decoded) return fail('Invalid or expired refresh token', 401);

    await connectDB();
    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.status !== 'active') return fail('User not found or inactive', 401);

    const token = signToken({ id: user._id, role: user.role });
    return ok({ token });
  } catch (e) {
    return fail(e.message, 500);
  }
}
