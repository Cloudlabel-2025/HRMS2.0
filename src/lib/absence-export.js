'use client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KIND_CHIP = {
  absent:        { fill: 'FFFEE2E2', font: 'FFDC2626', label: 'Absent', bold: true },
  not_arrived:   { fill: 'FFF1F5F9', font: 'FF64748B', label: 'Not Arrived', bold: false },
  on_leave:      { fill: 'FFDBEAFE', font: 'FF2563EB', label: 'On Leave', bold: false },
  on_permission: { fill: 'FFE0E7FF', font: 'FF1D4ED8', label: 'On Permission', bold: false },
  late:          { fill: 'FFFEF3C7', font: 'FFD97706', label: 'Late', bold: false },
  half_day:      { fill: 'FFF3E8FF', font: 'FF7C3AED', label: 'Half Day', bold: false },
  present:       { fill: 'FFDCFCE7', font: 'FF16A34A', label: 'Present', bold: true },
};

function kindChip(kind) {
  return KIND_CHIP[kind] || { fill: 'FFF8FAFC', font: 'FF64748B', label: kind || '—', bold: false };
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

function styleDataRow(row) {
  row.height = 20;
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    cell.font = { size: 10, color: { argb: 'FF334155' } };
  });
  if (row.number % 2 === 0) {
    row.eachCell((cell) => {
      if (!cell.fill || cell.fill.fgColor?.argb === undefined) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  }
}

function hexToRgb(argb) {
  const hex = String(argb).slice(2);
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function formatRangeLabel(month, fromDate, toDate) {
  if (fromDate || toDate) return `${fromDate || '—'} to ${toDate || '—'}`;
  return month || '—';
}

function calendarDaysForMonth(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return 0;
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export async function buildAbsenceExcel(filteredAbsences, meta = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS';
  wb.created = new Date();
  wb.modified = new Date();

  const month = meta.month || '';
  const fromDate = meta.fromDate || '';
  const toDate = meta.toDate || '';
  const statusFilter = meta.statusFilter || 'all';
  const searchValue = meta.searchValue || '';
  const department = meta.department || '';
  const formatDateFn = meta.formatDate || ((v) => v || '');

  const periodLabel = formatRangeLabel(month, fromDate, toDate);
  const generatedAt = new Date().toLocaleString();
  const calendarDays = calendarDaysForMonth(month);

  // Build filter description for banner
  const activeFilters = [];
  if (statusFilter && statusFilter !== 'all') activeFilters.push(`Status: ${statusFilter}`);
  if (searchValue) activeFilters.push(`Search: "${searchValue}"`);
  if (department) activeFilters.push(`Dept: ${department}`);
  if (fromDate || toDate) activeFilters.push(`Date: ${fromDate || '—'} to ${toDate || '—'}`);
  const filterDesc = activeFilters.length ? `Filters: ${activeFilters.join('  •  ')}` : 'No additional filters';

  const headers = ['Employee', 'Department', 'Date', 'Day', 'Status', 'Reason / Detail', 'Permission', 'Leave', 'Absences', 'Pattern'];
  // 10 cols: tune widths
  const colWidths = [22, 18, 13, 8, 14, 26, 18, 18, 10, 11];

  const ws = wb.addWorksheet('Absence Report', { properties: { tabColor: { argb: 'FFEF4444' } } });
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  ws.columns = colWidths.map((w) => ({ width: w }));
  ws.headerFooter.oddFooter = `&LAbsence Report — ${periodLabel}&CPage &P of &N&RGenerated: ${generatedAt}`;

  // Row 1: Banner
  ws.mergeCells(1, 1, 1, headers.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = 'Absence Management Report';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 32;

  // Row 2: Period + calendar days + generated
  ws.mergeCells(2, 1, 2, headers.length);
  const metaCell = ws.getCell(2, 1);
  metaCell.value = `Period: ${periodLabel}  •  Month: ${month || '—'}  •  Calendar Days: ${calendarDays || '—'}  •  Records: ${filteredAbsences.length}  •  Generated: ${generatedAt}`;
  metaCell.font = { size: 10, color: { argb: 'FF475569' }, italic: true };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  ws.getRow(2).height = 20;

  // Row 3: Active filters
  ws.mergeCells(3, 1, 3, headers.length);
  const filterCell = ws.getCell(3, 1);
  filterCell.value = filterDesc;
  filterCell.font = { size: 9, color: { argb: 'FF64748B' } };
  filterCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  ws.getRow(3).height = 18;

  // Row 4: Summary counts (if any records)
  ws.mergeCells(4, 1, 4, headers.length);
  const summaryCell = ws.getCell(4, 1);
  if (filteredAbsences.length) {
    const sCounts = {
      absent: filteredAbsences.filter((a) => a.kind === 'absent').length,
      notArrived: filteredAbsences.filter((a) => a.kind === 'not_arrived').length,
      onLeave: filteredAbsences.filter((a) => a.kind === 'on_leave').length,
      onPerm: filteredAbsences.filter((a) => a.kind === 'on_permission').length,
      late: filteredAbsences.filter((a) => a.kind === 'late').length,
      halfDay: filteredAbsences.filter((a) => a.kind === 'half_day').length,
      flagged: filteredAbsences.filter((a) => a.flagged || (a.pattern || 0) >= 3).length,
    };
    summaryCell.value = `Absent: ${sCounts.absent}  •  Not Arrived: ${sCounts.notArrived}  •  On Leave: ${sCounts.onLeave}  •  On Permission: ${sCounts.onPerm}  •  Late: ${sCounts.late}  •  Half Day: ${sCounts.halfDay}  •  Flagged: ${sCounts.flagged}`;
  } else {
    summaryCell.value = 'No records for the selected filters.';
  }
  summaryCell.font = { size: 10, bold: true, color: { argb: 'FF0F172A' } };
  summaryCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  summaryCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  summaryCell.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
  ws.getRow(4).height = 22;

  // Row 5: spacer
  ws.getRow(5).height = 6;

  // Row 6: headers
  const headerRow = ws.getRow(6);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
  });
  styleHeaderRow(headerRow);

  ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: false }];

  if (filteredAbsences.length === 0) {
    ws.mergeCells(7, 1, 7, headers.length);
    const empty = ws.getCell(7, 1);
    empty.value = 'No absence records for the selected period and filters.';
    empty.font = { size: 11, color: { argb: 'FF94A3B8' }, italic: true };
    empty.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    ws.getRow(7).height = 26;
  } else {
    const sorted = [...filteredAbsences].sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.userId?.name || '').localeCompare(String(b.userId?.name || '')));
    sorted.forEach((a, idx) => {
      const row = ws.getRow(7 + idx);
      const dayLabel = DAYS[new Date(a.date + 'T00:00:00').getDay()] || '';
      const permText = a.permission ? `${a.permission.status || ''} ${a.permission.startTime || ''}${a.permission.startTime ? '–' : ''}${a.permission.endTime || ''}`.trim() || '—' : (a.permissionStatus || '—');
      const leaveText = a.leave ? `${a.leave.type || a.leave.typeCode || ''}${a.leave.halfDay ? ' (½)' : ''}` : '—';
      const patternText = String(a.pattern || 0);
      const flaggedText = a.flagged || (a.pattern || 0) >= 3 ? 'Flagged' : 'Normal';
      const vals = [
        a.userId?.name || '—',
        a.userId?.department || '—',
        a.date || '—',
        dayLabel,
        a.statusLabel || kindChip(a.kind).label,
        a.reason || '—',
        permText,
        leaveText,
        patternText,
        flaggedText,
      ];
      vals.forEach((v, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = v;
      });
      styleDataRow(row);
      // Status chip override col 5
      const chip = kindChip(a.kind);
      const statusCell = row.getCell(5);
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: chip.fill } };
      statusCell.font = { color: { argb: chip.font }, bold: chip.bold, size: 10 };
      // Flagged highlight col 10
      if (a.flagged || (a.pattern || 0) >= 3) {
        const flagCell = row.getCell(10);
        flagCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        flagCell.font = { color: { argb: 'FFDC2626' }, bold: true, size: 10 };
      } else {
        const flagCell = row.getCell(10);
        flagCell.font = { color: { argb: 'FF16A34A' }, size: 10 };
      }
    });
    ws.autoFilter = { from: 'A6', to: `J${6 + sorted.length}` };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

export async function buildAbsencePdf(filteredAbsences, meta = {}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF('l', 'mm', 'a4');

  const month = meta.month || '';
  const fromDate = meta.fromDate || '';
  const toDate = meta.toDate || '';
  const statusFilter = meta.statusFilter || 'all';
  const searchValue = meta.searchValue || '';
  const department = meta.department || '';
  const formatDateFn = meta.formatDate || ((v) => v || '');

  const periodLabel = formatRangeLabel(month, fromDate, toDate);
  const generatedAt = new Date().toLocaleString();
  const calendarDays = calendarDaysForMonth(month);

  const activeFilters = [];
  if (statusFilter && statusFilter !== 'all') activeFilters.push(`Status: ${statusFilter}`);
  if (searchValue) activeFilters.push(`Search: "${searchValue}"`);
  if (department) activeFilters.push(`Dept: ${department}`);
  if (fromDate || toDate) activeFilters.push(`Date: ${fromDate || '—'} to ${toDate || '—'}`);
  const filterDesc = activeFilters.length ? activeFilters.join('  •  ') : 'No additional filters';

  // Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 297, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Absence Management Report', 14, 11);

  doc.setTextColor(71, 85, 105);
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  doc.text(`Period: ${periodLabel}  •  Month: ${month || '—'}  •  Calendar Days: ${calendarDays || '—'}  •  Records: ${filteredAbsences.length}  •  Generated: ${generatedAt}`, 14, 23);
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7);
  doc.text(filterDesc, 14, 27);

  const sorted = [...filteredAbsences].sort((a, b) => (a.date || '').localeCompare(b.date || '') || String(a.userId?.name || '').localeCompare(String(b.userId?.name || '')));

  const head = [['Employee', 'Department', 'Date', 'Day', 'Status', 'Reason', 'Permission', 'Leave', 'Count', 'Alert']];
  const body = sorted.map((a) => {
    const dayLabel = DAYS[new Date(a.date + 'T00:00:00').getDay()] || '';
    const permText = a.permission ? `${a.permission.status || ''} ${a.permission.startTime || ''}${a.permission.startTime ? '–' : ''}${a.permission.endTime || ''}`.trim() || '—' : (a.permissionStatus || '—');
    const leaveText = a.leave ? `${a.leave.type || a.leave.typeCode || ''}${a.leave.halfDay ? ' (½)' : ''}` : '—';
    return [
      a.userId?.name || '—',
      a.userId?.department || '—',
      formatDateFn(a.date) || a.date || '—',
      dayLabel,
      a.statusLabel || kindChip(a.kind).label,
      (a.reason || '—').slice(0, 40),
      permText,
      leaveText,
      String(a.pattern || 0),
      a.flagged || (a.pattern || 0) >= 3 ? 'Flagged' : 'Normal',
    ];
  });

  if (body.length === 0) {
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('No absence records for the selected period and filters.', 14, 38);
    return doc;
  }

  autoTable(doc, {
    startY: 31,
    head,
    body,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 5: { cellWidth: 45 }, 6: { cellWidth: 28 }, 7: { cellWidth: 22 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const kind = sorted[data.row.index]?.kind;
        const chip = kindChip(kind);
        data.cell.styles.fillColor = hexToRgb(chip.fill);
        data.cell.styles.textColor = hexToRgb(chip.font);
        if (chip.bold) data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.column.index === 9) {
        const a = sorted[data.row.index];
        if (a?.flagged || (a?.pattern || 0) >= 3) {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else {
          data.cell.styles.textColor = [22, 163, 74];
        }
      }
    },
  });

  return doc;
}
