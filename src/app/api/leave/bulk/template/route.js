import { requireAuth } from '@/lib/middleware';
import { fail } from '@/lib/jwt';
import { BALANCE_HEADERS, LEAVE_HEADERS, BULK_ADMIN_ROLES } from '@/lib/leave/bulk-helpers';

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  if (!BULK_ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);

  const type = new URL(req.url).searchParams.get('type') || 'balance';
  if (!['balance', 'leaves'].includes(type)) return fail('type must be balance or leaves', 400);

  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS';
  const ws = wb.addWorksheet(type === 'balance' ? 'Leave Balance' : 'Leave History');

  const headers = type === 'balance' ? BALANCE_HEADERS : LEAVE_HEADERS;
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

  const year = new Date().getFullYear();
  if (type === 'balance') {
    ws.addRow(['priya@company.com', 'CHC-2026-0001', 'CL', 12, 2, 0, 0, '', year, 'Opening balance migration']);
    ws.addRow(['', 'CHC-2026-0002', 'SL', 2, 0, 0, 0, '', year, 'Correction (+2 days)']);
    ws.columns = headers.map(h => ({ header: h, width: h === 'reason' ? 34 : 18 }));
  } else {
    ws.addRow(['priya@company.com', 'CHC-2026-0001', 'CL', `${year}-06-10`, `${year}-06-12`, 'FALSE', '', 'Family function', 'approved', '', '']);
    ws.addRow(['', 'CHC-2026-0002', 'SL', `${year}-07-04`, `${year}-07-04`, 'TRUE', 'first_half', 'Fever', 'approved', '', '']);
    ws.columns = headers.map(h => ({ header: h, width: ['reason', 'employeeEmail'].includes(h) ? 28 : 16 }));
  }

  // Instruction sheet
  const help = wb.addWorksheet('Instructions');
  const lines = type === 'balance'
    ? [
      ['Bulk Leave Balance — Instructions'],
      [''],
      ['1. Fill ONE of employeeEmail or employeeCode per row. If both are filled they must match the same person.'],
      ['2. typeCode must exist in that employee\u2019s leave policy (e.g. CL, SL, PL).'],
      ['3. allocated / used / pending / carriedForward are numbers >= 0. Leave blank = 0 (delta mode) or unchanged.'],
      ['4. mode=delta adds the numbers; mode=overwrite replaces them.'],
      ['5. cycleYear defaults to current year. reason is required (audit).'],
      ['6. Max 500 rows per file.'],
    ]
    : [
      ['Bulk Leave History — Instructions'],
      [''],
      ['1. Fill ONE of employeeEmail or employeeCode per row. If both are filled they must match the same person.'],
      ['2. Dates must be YYYY-MM-DD, from <= to.'],
      ['3. halfDay TRUE only for single-day leaves; halfDayType = first_half or second_half.'],
      ['4. status = approved (deducts balance + creates attendance) or pending (goes to approvals).'],
      ['5. Leave paidDays/unpaidDays blank to auto-calculate from the company calendar.'],
      ['6. Overlapping dates with existing leaves will be flagged. Max 500 rows per file.'],
    ];
  lines.forEach(l => help.addRow(l));
  help.getColumn(1).width = 100;

  const buf = await wb.xlsx.writeBuffer();
  return new Response(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="leave-${type}-template.xlsx"`,
    },
  });
}
