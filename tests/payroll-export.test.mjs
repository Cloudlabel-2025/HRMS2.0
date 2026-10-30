import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { buildPayrollExcel } from '../src/lib/payroll-report-export.js';

test('payroll workbook handles reserved, invalid and colliding long employee names', { timeout: 10000 }, async () => {
  const names = ['Summary', 'summary', 'History', 'Employee [Contract]', "'Employee'", 'A'.repeat(40), 'A'.repeat(40), 'A'.repeat(40), 'A'.repeat(26) + ' (2)'];
  const buffer = await buildPayrollExcel({ month: '2026-10', payrolls: names.map((name, index) => ({
    _id: String(index), userId: { name, department: 'HR' }, netPay: 12345, status: 'draft',
  })), details: { '0': { rows: [{ date: '2026-10-01', lopType: 'Late', dayLop: 0.5, amount: 100 }] } } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, names.length + 1);
  assert.equal(new Set(workbook.worksheets.map(sheet => sheet.name.toLowerCase())).size, names.length + 1);
  for (const sheet of workbook.worksheets) {
    assert.ok(sheet.name.length <= 31);
    assert.doesNotMatch(sheet.name, /[\\/:*?\[\]]/);
  }
  assert.equal(workbook.getWorksheet('Summary').getCell('L5').value, 12345);
  assert.equal(workbook.worksheets[1].getCell('G7').value, 0.5);
  assert.equal(workbook.worksheets[1].getCell('H7').value, 100);
});
