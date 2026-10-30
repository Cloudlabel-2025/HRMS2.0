import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveBalanceDisplay } from '../src/lib/leave/balance-display.js';
import { payrollPeriod } from '../src/lib/payroll-periods.js';

const config = { startDay: 26, endDay: 25 };
const period = payrollPeriod('2026-10-30', { payrollStartDay: 26, payrollEndDay: 25 });
const balance = used => ({ typeCode: 'SL', allocated: 1.5, used, pending: 0, carriedForward: 0 });
const leave = (date, unpaidDays, status = 'approved') => ({ typeCode: 'SL', status, payrollDaySplit: [{ date, unpaidDays }] });

test('balance displays fractional allowance and negative excess without modifying paid balances', () => {
  assert.equal(leaveBalanceDisplay(balance(0), { code: 'SL' }, [], period, config).displayBalance, 1.5);
  assert.equal(leaveBalanceDisplay(balance(1), { code: 'SL' }, [], period, config).displayBalance, 0.5);
  const original = balance(1.5);
  assert.equal(leaveBalanceDisplay(original, { code: 'SL' }, [leave('2026-10-20', 1)], period, config).displayBalance, -1);
  assert.equal(original.used, 1.5);
});

test('only excess in the current payroll quarter counts; rejected and cancelled leave are excluded', () => {
  const rows = [leave('2026-09-25', 2), leave('2026-09-26', 0.5), leave('2026-12-25', 0.5, 'pending'), leave('2026-12-26', 1), leave('2026-10-05', 1, 'rejected'), leave('2026-10-06', 1, 'cancelled')];
  const result = leaveBalanceDisplay(balance(1.5), { code: 'SL' }, rows, period, config);
  assert.equal(result.displayBalance, -1);
  assert.equal(result.periodStart, '2026-09-26');
  assert.equal(result.periodEnd, '2026-12-25');
});

test('earned leave display preserves unused carry-forward', () => {
  const earned = { typeCode: 'EL', allocated: 6, used: 1.5, pending: 0, carriedForward: 0 };
  assert.equal(leaveBalanceDisplay(earned, { code: 'EL' }, [], period, config).displayBalance, 4.5);
});
