// Smoke test for the leave->permission revert helper (pure parts + imports).
// Run: node scripts/verify-leave-permission-revert.mjs
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const dotenv = (await import('dotenv')).default;
dotenv.config({ path: './.env.local' });

const { expandDates, revertPermissionsForLeave } = await import('../src/lib/leave-permission-revert.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};

check('helper exports revertPermissionsForLeave', typeof revertPermissionsForLeave === 'function');
check('expandDates single day', JSON.stringify(expandDates('2026-10-05', '2026-10-05')) === JSON.stringify(['2026-10-05']));
check(
  'expandDates multi-day range',
  JSON.stringify(expandDates('2026-10-05', '2026-10-07')) === JSON.stringify(['2026-10-05', '2026-10-06', '2026-10-07']),
);
check('expandDates empty on missing input', expandDates(null, null).length === 0);

// Route files referencing the helper must resolve (import smoke).
await import('../src/app/api/leave/[id]/route.js').then(
  () => check('leave/[id] route imports', true),
  (e) => check('leave/[id] route imports', false, e.message),
);
await import('../src/app/api/core/self-service-requests/route.js').then(
  () => check('self-service-requests route imports', true),
  (e) => check('self-service-requests route imports', false, e.message),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
