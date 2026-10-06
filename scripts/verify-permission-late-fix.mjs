// Verifies: applied arrival-cover permissions never force Late;
// genuine overruns (not applied) still do.
// Run: node scripts/verify-permission-late-fix.mjs
import { register } from 'node:module';
register('./.alias-loader.mjs', import.meta.url);

const { displayStatusOf } = await import('../src/lib/attendance-stats.js');
const { closePermissionEarly, buildPastApprovalClose } = await import('../src/lib/permission-work.js');
const { computeWorkRowDuration } = await import('../src/lib/attendance-constants.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`FAIL   ${name}${detail ? ' — ' + detail : ''}`); }
};

// Kavin 30/09 shape: present + applied permission closed late-evening
const kavin = {
  clockIn: '10:15', status: 'present',
  permission: { requestId: 'x', startTime: '10:00', endTime: '10:30', applied: false, endedLate: false, status: 'approved' },
};
kavin.permission.applied = true;
kavin.permission.endedLate = false; // post-fix stored state
check('applied + on-time close shows present', displayStatusOf(kavin) === 'present', displayStatusOf(kavin));

// Stale-state guard: even if endedLate were still true, applied wins
const kavinStale = { ...kavin, permission: { ...kavin.permission, endedLate: true } };
check('applied + stale endedLate still shows present', displayStatusOf(kavinStale) === 'present', displayStatusOf(kavinStale));

// Genuine overrun: arrival outside window (not applied), ended late -> late
const overrun = {
  clockIn: '11:01', status: 'late',
  permission: { requestId: 'y', startTime: '10:00', endTime: '11:00', applied: false, endedLate: true, status: 'approved' },
};
check('non-applied overrun still shows late', displayStatusOf(overrun) === 'late', displayStatusOf(overrun));

// closePermissionEarly: applied arrival-cover closed at 19:17 -> not late
const appliedRec = {
  clockIn: '10:15',
  permission: { requestId: 'x', startTime: '10:00', endTime: '10:30', applied: true, actualClockIn: '10:15', usedDuration: 15 },
  workProgress: [],
};
const r1 = closePermissionEarly(appliedRec, '19:17', 'manual');
check('applied close at 19:17 not late', r1.endedLate === false, JSON.stringify(r1));

// closePermissionEarly: non-applied closed after window -> late (unchanged)
const plainRec = {
  clockIn: '11:01',
  permission: { requestId: 'y', startTime: '10:00', endTime: '11:00', applied: false },
  workProgress: [],
};
const r2 = closePermissionEarly(plainRec, '17:46', 'manual');
check('non-applied close after window still late', r2.endedLate === true && r2.overrunMins === 406, JSON.stringify(r2));

// closePermissionEarly: legacy rows without applied flag -> late (unchanged)
const legacyRec = {
  clockIn: '11:01',
  permission: { requestId: 'z', startTime: '10:00', endTime: '11:00' },
  workProgress: [],
};
const r3 = closePermissionEarly(legacyRec, '17:46', 'manual');
check('legacy (no applied flag) close still late', r3.endedLate === true, JSON.stringify(r3));

// Taken time: applied arrival-cover row completes at actual clock-in.
// (Row duration is derived at render via computeWorkRowDuration.)
const takenRow = appliedRec.workProgress.find((w) => w.type === 'permission');
check(
  'applied row records taken time 10:00->10:15 (15m)',
  takenRow && takenRow.endTime === '10:15'
    && computeWorkRowDuration(takenRow) === 15
    && /taken 15m/.test(takenRow.taskDetails || ''),
  JSON.stringify(takenRow),
);

// Taken time also applies when completing a pre-existing open row
const appliedOpen = {
  clockIn: '10:15',
  permission: { requestId: 'x', startTime: '10:00', endTime: '10:30', applied: true, actualClockIn: '10:15', usedDuration: 15 },
  workProgress: [{ type: 'permission', permissionRequestId: 'x', startTime: '10:00', endTime: null, status: 'work_in_progress' }],
};
closePermissionEarly(appliedOpen, '19:17', 'manual');
const takenOpen = appliedOpen.workProgress.find((w) => w.type === 'permission');
check(
  'open applied row completes at 10:15 (15m)',
  takenOpen && takenOpen.endTime === '10:15' && takenOpen.duration === 15,
  JSON.stringify(takenOpen),
);
const overRow = plainRec.workProgress.find((w) => w.type === 'permission');
check(
  'overrun row clamps to 10:00->11:00 (60m) with +406m label',
  overRow && overRow.endTime === '11:00'
    && computeWorkRowDuration(overRow) === 60
    && overRow.overrunMins === 406
    && /\+406m over/.test(overRow.taskDetails || ''),
  JSON.stringify(overRow),
);

// buildPastApprovalClose: past worked day settles on time with a taken row.
const pastWorked = buildPastApprovalClose({
  permStart: '10:00', permEnd: '10:30', actualClockIn: '10:15',
  usage: { used: 15, refunded: 15, applied: true, isMidDay: false },
  permDate: '2026-09-28', todayStr: '2026-09-30', requestId: 'req1',
});
check(
  'past worked approval closes on time at window end',
  pastWorked.isPast && pastWorked.hasWork && !pastWorked.refuseReason
    && pastWorked.close.endedAt === '10:30' && pastWorked.close.endedLate === false
    && pastWorked.row.endTime === '10:15' && pastWorked.row.duration === 15
    && /taken 15m/.test(pastWorked.row.taskDetails || ''),
  JSON.stringify(pastWorked),
);

// Past date with no clock-in is refused outright.
const pastEmpty = buildPastApprovalClose({
  permStart: '10:00', permEnd: '10:30', actualClockIn: null,
  usage: null, permDate: '2026-09-28', todayStr: '2026-09-30', requestId: 'req2',
});
check(
  'past dateless approval refused',
  pastEmpty.isPast && !pastEmpty.hasWork && !!pastEmpty.refuseReason && !pastEmpty.row,
  JSON.stringify(pastEmpty),
);

// Non-past dates pass through untouched.
const current = buildPastApprovalClose({
  permStart: '10:00', permEnd: '10:30', actualClockIn: null,
  usage: null, permDate: '2026-09-30', todayStr: '2026-09-30', requestId: 'req3',
});
check(
  'current date untouched',
  current.isPast === false && !current.refuseReason && !current.row,
  JSON.stringify(current),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
