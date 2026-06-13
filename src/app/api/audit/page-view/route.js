import { requireAuth, pageLog } from '@/lib/middleware';
import { fail, ok } from '@/lib/jwt';

// In-memory session guard: tracks {userId_module: timestamp}
// Prevents duplicate logs from React Strict Mode double-invocation (< 2s apart)
const recentPageViews = new Map();

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const { module, details } = await req.json();
    if (!module) return fail('module is required', 400);

    // Deduplicate within a 5-second window to block Strict Mode double-fire
    // but allow genuine re-visits after that
    const key = `${user._id}_${module}`;
    const last = recentPageViews.get(key) || 0;
    const now = Date.now();
    if (now - last < 5000) return ok({ logged: false });
    recentPageViews.set(key, now);

    const ip = req.headers.get('x-forwarded-for') || '';
    await pageLog(module, user._id, details || `Opened ${module} module`, ip);
    return ok({ logged: true });
  } catch (e) {
    return fail(e.message, 500);
  }
}
