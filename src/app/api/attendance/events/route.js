import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { connectDB } from '@/lib/db';
import User from '@/lib/models/User';
import { fail, getRefreshTokenFromRequest, verifyToken, signToken, SESSION_COOKIE_OPTIONS } from '@/lib/jwt';
import { subscribeAttendance } from '@/lib/sse';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  let user;
  const { user: authUser, error } = await requireAuth(req);
  user = authUser;
  let rotated = false;

  if (error) {
    // EventSource sends cookies automatically, so the access token may have
    // silently expired. Rotate the refresh token (mirroring auth/refresh) and
    // set a fresh hrms_access cookie on the SSE response so the stream stays up.
    const refreshToken = getRefreshTokenFromRequest(req);
    const decoded = refreshToken ? verifyToken(refreshToken) : null;
    if (decoded?.tokenType === 'refresh') {
      await connectDB();
      const freshUser = await User.findById(decoded.id).select('-password');
      if (freshUser && freshUser.status === 'active') {
        user = freshUser;
        rotated = true;
      }
    }
  }

  if (!user) return fail('Unauthorized', 401);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let ping = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsubscribe();
        try { controller.close(); } catch (e) { /* already closed */ }
      };

      const res = {
        write(frame) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(frame));
          } catch (e) {
            cleanup();
          }
        },
      };

      unsubscribe = subscribeAttendance({ res, user });
      req.signal.addEventListener('abort', cleanup, { once: true });
      if (req.signal.aborted) { cleanup(); return; }

      ping = setInterval(() => res.write(': ping\n\n'), 30000);
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
    },
  });

  const response = new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });

  if (rotated) {
    const token = signToken({ id: user._id, role: user.role });
    response.cookies.set('hrms_access', token, { ...SESSION_COOKIE_OPTIONS, maxAge: 15 * 60 });
  }
  return response;
}
