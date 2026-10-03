'use client';

const DAYS_UNUSED = null; // day label arrives precomputed from the API

const safeName = (value) =>
  String(value || 'employee').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 31) || 'employee';

function uniqueSheetName(base, used) {
  const name = safeName(base);
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  let idx = 2;
  while (used.has(`${name} (${idx})`.slice(0, 31).toLowerCase())) idx++;
  const candidate = `${name} (${idx})`.slice(0, 31);
  used.add(candidate.toLowerCase());
  return candidate;
}

function lopTypeChip(lopType) {
  switch (lopType) {
    case 'Absent':
      return { fill: 'FFFEE2E2', font: 'FFDC2626', bold: true };
    case 'Late':
      return { fill: 'FFFEF3C7', font: 'FFB45309', bold: true };
    case 'Unpaid Leave':
      return { fill: 'FFDBEAFE', font: 'FF2563EB', bold: true };
    case 'Retro':
      return { fill: 'FFF3E8FF', font: 'FF7C3AED', bold: true };
    default:
      return { fill: 'FFF8FAFC', font: 'FF64748B', bold: false };
  }
}

function styleHeaderRow(row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
  });
}

function styleDataRow(row, moneyCols = new Set()) {
  row.height = 22;
  row.eachCell((cell, col) => {
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    cell.font = { size: 10, color: { argb: 'FF334155' } };
    if (moneyCols.has(col)) cell.numFmt = '₹#,##0.00';
  });
  if (row.number % 2 === 0) {
    row.eachCell((cell) => {
      if (!cell.fill || !cell.fill.fgColor?.argb) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  }
}

const empNameOf = (p) => p?.userId?.name || '—';
const empDeptOf = (p) => p?.userId?.department || '—';

/**
 * Build the payroll-run workbook: Summary sheet first (one row per employee
 * with working days, total salary, salary/day, LOP + net pay), then one
 * sheet per employee with every LOP-generating date (date, LOP type,
 * half/full quantum, day LOP, amount, basis/rule).
 */
export async function buildPayrollExcel(report) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS';
  wb.created = new Date();
  wb.modified = new Date();

  const { month = '', cycleLabel = '', fromDate = '', toDate = '', isMidCycle = false } = report || {};
  const payrolls = Array.isArray(report?.payrolls) ? report.payrolls : [];
  const details = report?.details || {};
  const periodLabel = cycleLabel || month || '—';
  const rangeLabel = fromDate || toDate ? `${fromDate || '—'} to ${toDate || '—'}` : periodLabel;
  const generatedAt = new Date().toLocaleString();
  const usedNames = new Set();

  // ── Summary sheet (always first) ──────────────────────────────────────────
  const summaryHeaders = [
    'Employee',
    'Department',
    'Working Days',
    'Monthly Gross',
    'Salary / Day',
    'LOP (raw)',
    'Grace',
    'Effective LOP',
    'Retro LOP',
    'Payable Days',
    'Loss of Pay',
    'Net Pay',
    'Status',
  ];
  const colCount = summaryHeaders.length;
  const lastCol = String.fromCharCode('A'.charCodeAt(0) + colCount - 1);
  const summary = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF0F172A' } } });
  summary.views = [{ showGridLines: false }];
  summary.pageSetup = {
    orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  summary.columns = [
    { width: 26 }, { width: 18 }, { width: 13 }, { width: 15 }, { width: 13 },
    { width: 10 }, { width: 9 }, { width: 12 }, { width: 10 }, { width: 12 },
    { width: 14 }, { width: 14 }, { width: 12 },
  ];

  summary.mergeCells(`A1:${lastCol}1`);
  const sTitle = summary.getCell('A1');
  sTitle.value = `Payroll Report — ${periodLabel}${isMidCycle ? ' (Preview)' : ''}`;
  sTitle.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  sTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  sTitle.alignment = { vertical: 'middle', horizontal: 'left' };
  summary.getRow(1).height = 36;

  summary.mergeCells(`A2:${lastCol}2`);
  const sMeta = summary.getCell('A2');
  sMeta.value = `Cycle: ${rangeLabel}  •  Employees: ${payrolls.length}  •  Generated: ${generatedAt}`;
  sMeta.font = { size: 10, color: { argb: 'FF475569' }, italic: true };
  sMeta.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  summary.getRow(2).height = 22;

  const shRow = summary.getRow(4);
  shRow.values = summaryHeaders;
  styleHeaderRow(shRow);

  const totals = {
    working: 0, gross: 0, lopRaw: 0, grace: 0, eff: 0, retro: 0, payable: 0, lopAmt: 0, net: 0,
  };

  for (const p of payrolls) {
    totals.working += Number(p.workingDays) || 0;
    totals.gross += Number(p.monthlyGross) || 0;
    totals.lopRaw += Number(p.lopDays) || 0;
    totals.grace += Number(p.graceDaysApplied) || 0;
    totals.eff += Number(p.effectiveLopDays ?? p.lopDays) || 0;
    totals.retro += Number(p.retroLopDays) || 0;
    totals.payable += Number(p.payableDays) || 0;
    totals.lopAmt += Number(p.lossOfPay) || 0;
    totals.net += Number(p.netPay) || 0;
    const r = summary.addRow([
      empNameOf(p),
      empDeptOf(p),
      Number(p.workingDays) || 0,
      Number(p.monthlyGross) || 0,
      Number(p.salaryPerDay) || 0,
      Number(p.lopDays) || 0,
      Number(p.graceDaysApplied) || 0,
      Number(p.effectiveLopDays ?? p.lopDays) || 0,
      Number(p.retroLopDays) || 0,
      Number(p.payableDays) || 0,
      Number(p.lossOfPay) || 0,
      Number(p.netPay) || 0,
      p.status || '—',
    ]);
    styleDataRow(r, new Set([4, 5, 11, 12]));
    r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    r.getCell(1).font = { size: 10, bold: true, color: { argb: 'FF0F172A' } };
  }

  if (payrolls.length > 1) {
    const t = summary.addRow([
      'TOTAL', '—', totals.working, totals.gross, '—',
      totals.lopRaw, totals.grace, totals.eff, totals.retro, totals.payable,
      totals.lopAmt, totals.net, '—',
    ]);
    t.height = 24;
    t.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0F172A' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    });
    t.getCell(4).numFmt = '₹#,##0.00';
    t.getCell(11).numFmt = '₹#,##0.00';
    t.getCell(12).numFmt = '₹#,##0.00';
  }

  summary.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  summary.autoFilter = { from: 'A4', to: `${lastCol}${summary.rowCount}` };
  summary.headerFooter.oddFooter = `&LPayroll Report ${periodLabel}&CPage &P of &N&R${rangeLabel}`;
  void DAYS_UNUSED;

  // ── Per-employee sheets ───────────────────────────────────────────────────
  const detailHeaders = ['Date', 'Day', 'Status', 'Clock In', 'LOP Type', 'Quantum', 'Day LOP', 'Amount (₹)', 'Basis / Rule'];
  const dCount = detailHeaders.length;
  const dLast = String.fromCharCode('A'.charCodeAt(0) + dCount - 1);

  for (const p of payrolls) {
    const pid = String(p._id);
    const info = details[pid] || {};
    const rows = Array.isArray(info.rows) ? info.rows : [];
    const sheetName = uniqueSheetName(empNameOf(p), usedNames);
    const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: 'FF2563EB' } } });
    ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: false }];
    ws.pageSetup = {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    };
    ws.columns = [
      { width: 14 }, { width: 9 }, { width: 24 }, { width: 11 }, { width: 15 },
      { width: 11 }, { width: 10 }, { width: 14 }, { width: 34 },
    ];
    ws.headerFooter.oddFooter = `&L${empNameOf(p)}&CPage &P of &N&R${periodLabel}`;

    ws.mergeCells(1, 1, 1, dCount);
    const nameCell = ws.getCell(1, 1);
    nameCell.value = `Employee: ${empNameOf(p)}`;
    nameCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 32;

    ws.mergeCells(2, 1, 2, dCount);
    const infoCell = ws.getCell(2, 1);
    infoCell.value = `Department: ${empDeptOf(p)}  •  Cycle: ${periodLabel} (${rangeLabel})  •  Status: ${p.status || '—'}`;
    infoCell.font = { size: 10, color: { argb: 'FF475569' }, italic: true };
    infoCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    ws.getRow(2).height = 20;

    ws.mergeCells(3, 1, 3, dCount);
    const rateCell = ws.getCell(3, 1);
    rateCell.value =
      `Working Days: ${p.workingDays ?? '—'}  •  Monthly Gross: ₹${Number(p.monthlyGross || 0).toLocaleString('en-IN')}  •  ` +
      `Salary/Day: ₹${Number(p.salaryPerDay || 0).toLocaleString('en-IN')} (${info.basisLabel || 'gross / working_days'})  •  ` +
      `LOP: ${p.effectiveLopDays ?? p.lopDays ?? 0} effective (${p.lopDays ?? 0} raw${Number(p.graceDaysApplied) > 0 ? `, ${p.graceDaysApplied} grace` : ''}` +
      `${Number(p.retroLopDays) > 0 ? `, +${p.retroLopDays} retro` : ''})  •  Payable: ${p.payableDays ?? '—'}  •  Net: ₹${Number(p.netPay || 0).toLocaleString('en-IN')}  •  Generated: ${generatedAt}`;
    rateCell.font = { size: 9, color: { argb: 'FF64748B' } };
    rateCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    ws.getRow(3).height = 30;

    const chips = [
      `Absent: ${p.absentDays ?? 0}`,
      `Late LOP: ${p.lateLopDays ?? 0}`,
      `Unpaid Leave: ${p.unpaidLeaveDays ?? 0}`,
      `Paid Leave: ${p.paidLeaveDays ?? 0}`,
      `Present: ${p.presentDays ?? '—'}`,
    ];
    const sumRow = ws.getRow(4);
    chips.forEach((label, i) => {
      const c = sumRow.getCell(i + 1);
      c.value = label;
      c.font = { size: 10, bold: true, color: { argb: 'FF0F172A' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    sumRow.height = 22;
    ws.getRow(5).height = 6;

    const headerRow = ws.getRow(6);
    detailHeaders.forEach((h, i) => {
      headerRow.getCell(i + 1).value = h;
    });
    styleHeaderRow(headerRow);

    if (rows.length === 0) {
      ws.mergeCells(7, 1, 7, dCount);
      const empty = ws.getCell(7, 1);
      empty.value = 'No LOP in this cycle — every working day was present / paid leave.';
      empty.font = { size: 11, color: { argb: 'FF16A34A' }, italic: true };
      empty.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      ws.getRow(7).height = 26;
    } else {
      let totalDayLop = 0;
      let totalAmt = 0;
      rows.forEach((r, idx) => {
        const row = ws.getRow(7 + idx);
        const values = [r.date || '—', r.day || '', r.status || '', r.clockIn || '—', r.lopType || '', r.quantum || '', Number(r.dayLop) || 0, Number(r.amount) || 0, r.basis || ''];
        values.forEach((v, ci) => {
          row.getCell(ci + 1).value = v;
        });
        styleDataRow(row, new Set([8]));
        const chip = lopTypeChip(r.lopType);
        const typeCell = row.getCell(5);
        typeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: chip.fill } };
        typeCell.font = { color: { argb: chip.font }, bold: chip.bold, size: 10 };
        totalDayLop += Number(r.dayLop) || 0;
        totalAmt += Number(r.amount) || 0;
      });
      const t = ws.getRow(7 + rows.length);
      const tVals = ['TOTAL', '', '', '', '', '', Math.round(totalDayLop * 100) / 100, Math.round(totalAmt * 100) / 100, ''];
      tVals.forEach((v, ci) => {
        t.getCell(ci + 1).value = v;
      });
      t.height = 24;
      t.eachCell((cell) => {
        cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FF0F172A' } },
          bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      });
      t.getCell(8).numFmt = '₹#,##0.00';
      ws.autoFilter = { from: 'A6', to: `${dLast}${6 + rows.length}` };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}
