// Verifies manual-permission regularization gates (pure parts + imports).
// Run: node scripts/verify-regularization-manual-permission.mjs
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const dotenv = (await import('dotenv')).default;
dotenv.config({ path: './.env.local' });

const { canApproveManualPermission } = await import('../src/lib/rbac.js');
const { AttendanceRegularizeSchema } = await import('../src/lib/validation.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};

check('super_admin may approve manual', canApproveManualPermission({ role: 'super_admin' }) === true);
check('admin_full may approve manual', canApproveManualPermission({ role: 'admin_full' }) === true);
check('team_lead may NOT approve manual', canApproveManualPermission({ role: 'team_lead' }) === false);
check('team_admin may NOT approve manual', canApproveManualPermission({ role: 'team_admin' }) === false);
check('employee may NOT approve manual', canApproveManualPermission({ role: 'employee' }) === false);
check('null user may NOT approve manual', canApproveManualPermission(null) === false);

// Schema accepts a manual window (source manual, typed start/end).
const parsed = AttendanceRegularizeSchema.safeParse({
  date: '2026-09-20',
  requestedIn: '',
  requestedOut: '',
  requestedBreaks: [],
  requestedPermission: { startTime: '10:00', endTime: '10:30', actualEndTime: '10:25', source: 'manual' },
  reason: 'Missed punching the permission window on the day itself, requesting regularization.',
});
check('schema accepts manual permission window', parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues));

// Route files referencing the new gate must resolve.
await import('../src/app/api/attendance/regularize/route.js').then(
  () => check('regularize route imports', true),
  (e) => check('regularize route imports', false, e.message),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
