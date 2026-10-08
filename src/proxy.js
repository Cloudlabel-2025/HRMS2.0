import { NextResponse } from 'next/server';

// Block every app/API request, including GET handlers that write to the DB
// and scheduled jobs. Static Next.js assets do not access the database.
export function proxy(request) {
  if (process.env.MAINTENANCE_MODE !== 'true') return NextResponse.next();

  const headers = {
    'Cache-Control': 'no-store, max-age=0',
    'Retry-After': '300',
    'X-HRMS-Maintenance': 'true',
  };
  if (request.nextUrl.pathname === '/api' || request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({
      success: false,
      error: 'HRMS is temporarily unavailable for scheduled maintenance. Please try again later.',
      maintenance: true,
    }, { status: 503, headers });
  }

  return new NextResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HRMS — Scheduled maintenance</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fb;color:#172238;font-family:system-ui,sans-serif}main{max-width:480px;margin:24px;padding:40px;background:white;border-radius:16px;box-shadow:0 8px 32px #17223812}h1{font-size:28px;line-height:1.2}p{line-height:1.6;color:#526078}.label{font-size:13px;font-weight:700;letter-spacing:.12em;color:#2563eb}</style></head>
<body><main><div class="label">HRMS</div><h1>We’ll be back soon</h1><p>HRMS is temporarily unavailable for scheduled maintenance. Please try again later.</p><p>Your previously saved records remain available after maintenance.</p></main></body></html>`, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
