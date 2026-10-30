import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payrollPeriod, cycleRange, normalizeEntitlementType, leavePaidFraction } from '../src/lib/payroll-periods.js';
import { buildEntitlementPlan } from '../src/lib/leave/entitlement-plan.js';
import LeavePolicy from '../src/lib/models/LeavePolicy.js';

const config = { payrollStartDay: 26, payrollEndDay: 25 };
const policy = { leaveTypeConfigs: ['SL', 'CL', 'EL'].map(code => ({ code, isPaid: true })) };
const request = (id, from, days = 1, typeCode = 'SL', status = 'approved') => ({ _id: id, from, to: from, days, typeCode, status, halfDay: days === 0.5 });
const plan = leaves => buildEntitlementPlan({ leaves, policy, config, today: '2026-10-30', joined: '2026-07-01', isChargeDate: () => true });

test('database policy documents preserve Sick, Casual and Earned balance types', () => {
  const document = new LeavePolicy({ name: 'Standard', leaveTypeConfigs: ['SL', 'CL', 'EL'].map(code => ({ code, name: code, enabled: true, isPaid: true })) });
  const args = { leaves: [request('one', '2026-10-01')], config, today: '2026-10-30', joined: '2026-07-01', isChargeDate: () => true };
  const fromDocument = buildEntitlementPlan({ ...args, policy: document });
  const fromPlain = buildEntitlementPlan({ ...args, policy: document.toObject() });
  assert.deepEqual(fromDocument, fromPlain);
  assert.deepEqual(fromDocument.balances.map(row => row.typeCode), ['SL', 'CL', 'EL']);
  assert.equal(fromDocument.leaves[0].paidDays, 1);
  assert.equal(normalizeEntitlementType(document.leaveTypeConfigs[0]).enabled, true);
});

test('payroll months, quarters and years start on 26th and end on 25th', () => {
  assert.equal(payrollPeriod('2026-09-25', config).quarter, 2);
  const q = payrollPeriod('2026-09-26', config);
  assert.equal(q.monthKey, '2026-10');
  assert.equal(q.quarterStart, '2026-09-26');
  assert.equal(q.quarterEnd, '2026-12-25');
  assert.equal(q.yearStart, '2025-12-26');
  assert.equal(q.yearEnd, '2026-12-25');
  assert.equal(payrollPeriod('2026-12-26', config).year, 2027);
  assert.equal(payrollPeriod('2026-01-25', config).quarterStart, '2025-12-26');
  assert.equal(payrollPeriod('2026-03-26', config).quarterEnd, '2026-06-25');
});
test('custom payroll boundaries and short February are date-valid', () => {
  assert.equal(payrollPeriod('2026-09-21', { payrollStartDay: 21, payrollEndDay: 20 }).quarterStart, '2026-09-21');
  assert.deepEqual(cycleRange(1, 31, 2026, 1), { fromDate: '2026-02-01', toDate: '2026-02-28' });
  assert.deepEqual(cycleRange(31, 30, 2028, 1), { fromDate: '2028-01-31', toDate: '2028-02-28' });
  assert.deepEqual(cycleRange(31, 30, 2028, 2), { fromDate: '2028-02-29', toDate: '2028-03-30' });
  assert.equal(payrollPeriod('2028-02-29', { payrollStartDay: 31, payrollEndDay: 30 }).monthKey, '2028-03');
});
test('Stephen example: four approved sick days split into 1.5 paid and 2.5 LOP', () => {
  const result = plan([request('a','2026-09-28'), request('b','2026-10-03'), request('c','2026-10-05',1,'SL','rejected'),
    request('d','2026-10-13',0.5), request('e','2026-10-20',0.5), request('f','2026-10-27')]);
  assert.equal(result.leaves.reduce((sum,row)=>sum+row.paidDays,0),1.5);
  assert.equal(result.leaves.reduce((sum,row)=>sum+row.unpaidDays,0),2.5);
  assert.equal(result.leaves.find(row=>row.leave._id==='b').paidDays,0.5);
  assert.equal(result.leaves.find(row=>row.leave._id==='f').unpaidDays,1);
  assert.equal(result.leaves.some(row=>row.leave._id==='c'),false);
  assert.equal(result.balances.find(row=>row.typeCode==='SL').used,1.5);
});
test('sick and casual expire while unused earned leave rolls to next quarter', () => {
  const leaves = ['SL','CL','EL'].flatMap(type=>[request(type+'a','2026-07-01',1,type), request(type+'b','2026-09-28',1,type),request(type+'c','2026-10-01',1,type)]);
  const result = plan(leaves);
  assert.equal(result.leaves.find(row=>row.leave._id==='SLc').unpaidDays,0.5);
  assert.equal(result.leaves.find(row=>row.leave._id==='CLc').unpaidDays,0.5);
  assert.equal(result.leaves.find(row=>row.leave._id==='ELc').unpaidDays,0);
  const earned = result.balances.find(row=>row.typeCode==='EL');
  assert.equal(earned.allocated-earned.used-earned.pending,3);
});
test('cross-quarter request has separate per-date allowance and rejected leave releases quota', () => {
  const rows = [request('used','2026-09-01'),request('half','2026-09-02',0.5),{...request('cross','2026-09-25',2),to:'2026-09-26'}];
  const first = plan(rows).leaves.find(row=>row.leave._id==='cross');
  assert.deepEqual(first.payrollDaySplit,[{date:'2026-09-25',paidDays:0,unpaidDays:1},{date:'2026-09-26',paidDays:1,unpaidDays:0}]);
  rows[0].status='rejected';
  assert.equal(plan(rows).leaves.find(row=>row.leave._id==='cross').paidDays,2);
  assert.equal(leavePaidFraction({...first,entitlementVersion:1},'2026-09-25'),0);
  assert.equal(normalizeEntitlementType({code:'SL',carryForwardAllowed:true}).carryForwardAllowed,false);
});
