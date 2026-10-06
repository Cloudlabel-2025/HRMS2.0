// Verifies timing-request dashboard + notification deep-link wiring.
// Run: node scripts/verify-timing-deep-link.mjs
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const dotenv = (await import('dotenv')).default;
dotenv.config({ path: './.env.local' });

const { getNotifRoute } = await import('../src/lib/notifications-constants.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};

// Timing-request notification deep-links to the highlighted request.
const timingNotif = { type: 'attendance', title: 'Attendance Regularization Requested', refId: 'abc123' };
check(
  'regularization notification deep-links with highlight',
  getNotifRoute(timingNotif, 'super_admin') === '/attendance?tab=regularize&scope=approvals&highlight=abc123',
  getNotifRoute(timingNotif, 'super_admin'),
);
check(
  'deep link works for admin_full too',
  getNotifRoute(timingNotif, 'admin_full') === '/attendance?tab=regularize&scope=approvals&highlight=abc123',
);

// Ordinary attendance notifications still land on the page top.
check(
  'plain attendance notification unchanged',
  getNotifRoute({ type: 'attendance', title: 'Late Clock-In' }, 'super_admin') === '/attendance',
);
check(
  'attendance notification without refId unchanged',
  getNotifRoute({ type: 'attendance', title: 'Attendance Regularization Requested' }, 'super_admin') === '/attendance',
);
check('leave routing unchanged', getNotifRoute({ type: 'leave' }, 'employee') === '/leave');

// Dashboard API exposes the pending list.
await import('../src/app/api/dashboard/route.js').then(
  () => check('dashboard route imports', true),
  (e) => check('dashboard route imports', false, e.message),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
