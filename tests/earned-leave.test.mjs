import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeLeaveTypes, canonicalizeLeaveRecord, mergeEarnedLeaveBalances } from '../src/lib/leave/types.js';
import { normalizeEntitlementType } from '../src/lib/payroll-periods.js';
import { buildEntitlementPlan } from '../src/lib/leave/entitlement-plan.js';
import { planEarnedLeaveMigration } from '../src/lib/leave/migrate-earned-leave.js';
import LeavePolicy from '../src/lib/models/LeavePolicy.js';
import Leave from '../src/lib/models/Leave.js';
import Balance from '../src/lib/models/UserLeaveBalance.js';

const monthly = { code: 'EL', name: 'Earned Leave', annualAllocation: 12, creditSchedule: 'monthly',
  usagePeriod: 'monthly', maxUsagePerPeriod: 1, isPaid: true, enabled: true, carryForwardAllowed: false };
const config = { payrollStartDay: 1, payrollEndDay: 31 };
const request = (id, from, code = 'EL', days = 1, status = 'approved') => ({ _id: id, typeCode: code,
  type: code === 'PL' ? 'Privilege Leave' : 'Earned Leave', from, to: from, days, halfDay: days === 0.5, status });
const plan = (today, leaves = [], type = monthly, extras = {}) => buildEntitlementPlan({
  leaves, policy: { leaveTypeConfigs: [type] }, config, today, joined: '2026-01-01', isChargeDate: () => true, ...extras,
});
const available = result => { const row = result.balances.find(row => row.typeCode === 'EL'); return row.allocated + row.carriedForward - row.used - row.pending; };

test('EL keeps the assigned monthly credit and annual allocation instead of forced quarterly defaults', () => {
  const normalized = normalizeEntitlementType({ ...monthly, annualAllocation: 18, maxUsagePerPeriod: 1.5 });
  assert.equal(normalized.annualAllocation, 18);
  assert.equal(normalized.creditSchedule, 'monthly');
  assert.equal(normalized.usagePeriod, 'monthly');
  assert.equal(normalized.maxUsagePerPeriod, 1.5);
  assert.equal(normalized.unusedPeriodRollover, true);
  assert.equal(normalized.carryForwardAllowed, false);
});

test('both leave types become a single EL configuration; existing EL rules win', () => {
  const original = [{ code: 'PL', name: 'Privilege Leave', annualAllocation: 15 }, monthly,
    { code: 'EM', name: 'Emergency', linkedLeaveTypes: ['PL', 'EL', 'CL'] }];
  const result = canonicalizeLeaveTypes(original);
  assert.equal(result.filter(row => row.code === 'EL').length, 1);
  assert.equal(result[0].annualAllocation, 12);
  assert.equal(result[0].creditSchedule, 'monthly');
  assert.deepEqual(result[1].linkedLeaveTypes, ['EL', 'CL']);
  assert.equal(original[0].code, 'PL');
  assert.deepEqual(canonicalizeLeaveTypes(result), result);
});

test('existing PL usage and pending requests consume the same earned balance', () => {
  const result = plan('2026-03-15', [request('pl', '2026-01-12', 'PL', 0.5), request('el', '2026-02-12', 'EL', 1, 'pending')]);
  assert.equal(result.leaves[0].leave.typeCode, 'EL');
  assert.equal(result.balances.length, 1);
  assert.equal(result.balances[0].used, 0.5);
  assert.equal(result.balances[0].pending, 1);
  assert.equal(available(result), 1.5);
  assert.deepEqual(result.balances[0].periodUsage.map(row => row.period), ['M0', 'M1']);
});

test('unused earned days carry month to month without waiting for a cron job', () => {
  assert.equal(available(plan('2026-01-15')), 1);
  assert.equal(available(plan('2026-02-15')), 2);
  assert.equal(available(plan('2026-03-15')), 3);
  const leaves = [request('jan', '2026-01-12', 'EL', 0.5)];
  assert.equal(available(plan('2026-03-15', leaves)), 2.5);
  leaves[0].status = 'cancelled';
  assert.equal(available(plan('2026-03-15', leaves)), 3);
});

test('assigned quarterly credits remain quarterly and fractional monthly credits total exactly the annual allocation', () => {
  assert.equal(available(plan('2026-02-15', [], { ...monthly, creditSchedule: 'quarterly', usagePeriod: 'quarterly', maxUsagePerPeriod: 3 })), 3);
  assert.equal(available(plan('2026-04-15', [], { ...monthly, creditSchedule: 'quarterly', usagePeriod: 'quarterly', maxUsagePerPeriod: 3 })), 6);
  assert.equal(available(plan('2026-12-15', [], { ...monthly, annualAllocation: 5, maxUsagePerPeriod: 0 })), 5);
});

test('12 annual earned days unlock as 3 per payroll quarter, never before the next quarter', () => {
  const quarterly = { ...monthly, creditSchedule: 'quarterly', accrualMode: 'quarterly', usagePeriod: 'quarterly', maxUsagePerPeriod: 3 };
  const payrollConfig = { payrollStartDay: 26, payrollEndDay: 25 };
  for (const [date, expected] of [
    ['2026-01-01', 3], ['2026-03-25', 3],
    ['2026-03-26', 6], ['2026-06-25', 6],
    ['2026-06-26', 9], ['2026-09-25', 9],
    ['2026-09-26', 12], ['2026-12-25', 12],
  ]) {
    assert.equal(available(plan(date, [], quarterly, { config: payrollConfig })), expected, date);
  }
  const used = [request('taken', '2026-02-12', 'EL', 1)];
  assert.equal(available(plan('2026-03-25', used, quarterly, { config: payrollConfig })), 2);
  assert.equal(available(plan('2026-03-26', used, quarterly, { config: payrollConfig })), 5);
});

test('year-end carry limits and expiry remain governed by the assigned policy', () => {
  const type = { ...monthly, carryForwardAllowed: true, carryForwardMaxDays: 2, carryForwardExpiryMonths: 3 };
  assert.equal(available(plan('2027-01-15', [], type)), 3);
  assert.equal(available(plan('2027-03-15', [], type)), 5);
  assert.equal(available(plan('2027-04-15', [], type)), 4);
  assert.equal(available(plan('2027-01-15', [], monthly)), 1);
});

test('future-month reservations do not consume this month’s yet-unspent earned credits', () => {
  const result = plan('2026-01-15', [request('future', '2026-02-12', 'EL', 1, 'pending')]);
  assert.equal(available(result), 1);
});

test('merging balances transfers usage without adding a duplicate entitlement', () => {
  const rows = [{ typeCode: 'PL', allocated: 15, used: 2, pending: 0.5, carriedForward: 4, periodUsage: [{ period: 'M0', used: 2, cap: 2 }] },
    { typeCode: 'EL', allocated: 12, used: 1, pending: 0.5, carriedForward: 1, periodUsage: [{ period: 'M0', used: 1, cap: 1 }] }];
  const result = mergeEarnedLeaveBalances(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].allocated, 12);
  assert.equal(result[0].used, 3);
  assert.equal(result[0].pending, 1);
  assert.equal(result[0].carriedForward, 1);
  assert.equal(result[0].periodUsage[0].used, 3);
  assert.deepEqual(mergeEarnedLeaveBalances(result), result);
});

test('migration only changes type metadata and is idempotent; dates, approval and paid amounts survive', () => {
  const original = { ...request('old', '2026-01-12', 'PL'), paidDays: 1, unpaidDays: 0,
    requestedTypeCode: 'PL', requestedTypeName: 'Privilege Leave' };
  const [change] = planEarnedLeaveMigration('leaves', [original]);
  const migrated = { ...original, ...change.after };
  assert.equal(migrated.typeCode, 'EL');
  assert.equal(migrated.requestedTypeCode, 'EL');
  for (const field of ['from', 'to', 'days', 'paidDays', 'unpaidDays', 'status']) assert.equal(migrated[field], original[field]);
  assert.deepEqual(planEarnedLeaveMigration('leaves', [migrated]), []);
  assert.equal(canonicalizeLeaveRecord({ type: 'Privilege Leave' }).typeCode, 'EL');
});

test('database documents hydrate legacy records as earned leave and save only EL going forward', async () => {
  const policy = LeavePolicy.hydrate({ leaveTypeConfigs: [{ code: 'PL', name: 'Privilege Leave', annualAllocation: 15 }, monthly] });
  assert.equal(policy.leaveTypeConfigs.length, 1);
  assert.equal(policy.leaveTypeConfigs[0].code, 'EL');
  const leave = new Leave({ userId: '000000000000000000000001', typeCode: 'PL', type: 'Privilege Leave',
    from: '2026-01-12', to: '2026-01-12', days: 1, reason: 'Family' });
  await leave.validate();
  assert.equal(leave.typeCode, 'EL');
  const balance = Balance.hydrate({ balances: [{ typeCode: 'PL', allocated: 15, used: 2 }, { typeCode: 'EL', allocated: 12, used: 1 }] });
  assert.equal(balance.balances.length, 1);
  assert.equal(balance.balances[0].used, 3);
});
