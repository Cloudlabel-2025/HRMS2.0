'use client';

import { formatMins } from '@/lib/format';
import { STATUS_STYLE } from '@/lib/constants';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const safeName = (value) => String(value || 'employee').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 31) || 'employee';

function uniqueSheetName(base, used) {
  let name = safeName(base);
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  let idx = 2;
  while (used.has(`${name} (${idx})`.toLowerCase().slice(0, 31).toLowerCase())) idx++;
  const candidate = `${name} (${idx})`.slice(0, 31);
  used.add(candidate.toLowerCase());
  return candidate;
}

function getCalendarDays(teamMonth, teamFromDate, teamToDate, sorted) {
  if (teamFromDate && teamToDate) {
    const d1 = new Date(teamFromDate + 'T00:00:00');
    const d2 = new Date(teamToDate + 'T00:00:00');
    return Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
  }
  if (teamMonth) {
    const [y, m] = teamMonth.split('-').map(Number);
    if (y && m) return new Date(y, m, 0).getDate();
  }
  if (sorted?.length) {
    const first = sorted[0]?.date;
    const last = sorted[sorted.length - 1]?.date;
    if (first && last) return Math.max(0, Math.round((new Date(last) - new Date(first)) / 86400000) + 1);
  }
  return 0;
}

function computeStats(sorted) {
  return {
    present: sorted.filter((r) => r.status === 'present').length,
    onLeave: sorted.filter((r) => r.status === 'leave' || r.status === 'half_day').length,
    absent: sorted.filter((r) => r.status === 'absent').length,
    late: sorted.filter((r) => r.status === 'late' && !r.halfDayThresholdExceeded).length,
    halfDayLeaveCount: sorted.filter((r) => r.status === 'half_day' || r.approvedHalfDayLeave).length,
    permission: sorted.filter((r) => !!(r.permission?.requestId || r.permission?.startTime || r._permissionStatus === 'approved')).length,
    shortHours: sorted.filter((r) => r.shortHours && !(r.permission?.requestId || r.permission?.startTime)).length,
  };
}

function statusChip(status) {
  // ARGB colors mirroring STATUS_STYLE for Excel fills
  switch (status) {
    case 'present':
      return { fill: 'FFDCFCE7', font: 'FF16A34A', label: 'Present', bold: true };
    case 'absent':
      return { fill: 'FFFEE2E2', font: 'FFDC2626', label: 'Absent', bold: true };
    case 'leave':
      return { fill: 'FFDBEAFE', font: 'FF2563EB', label: 'Leave', bold: false };
    case 'half_day':
      return { fill: 'FFFFEDD5', font: 'FFEA580C', label: 'Half Day', bold: false };
    case 'late':
      return { fill: 'FFFEF3C7', font: 'FFD97706', label: 'Late', bold: false };
    case 'holiday':
      return { fill: 'FFF1F5F9', font: 'FF64748B', label: 'Holiday', bold: false };
    default:
      return { fill: 'FFF8FAFC', font: 'FF64748B', label: status || '—', bold: false };
  }
}

function styleHeaderRow(row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
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
  row.height = 22;
  row.eachCell((cell, col) => {
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    };
    cell.font = { size: 11, color: { argb: 'FF334155' } };
  });
  if (row.number % 2 === 0) {
    row.eachCell((cell) => {
      // keep status fill override later; only apply if not status col
      if (!cell.fill || cell.fill.fgColor?.argb === undefined) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Excel builder
// ──────────────────────────────────────────────────────────────────────────────

export async function buildAttendanceExcel(allData, meta = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS';
  wb.created = new Date();
  wb.modified = new Date();

  const teamMonth = meta.teamMonth || '';
  const teamFromDate = meta.teamFromDate || '';
  const teamToDate = meta.teamToDate || '';
  const formatTimeFn = meta.formatTime || ((v) => v || '');
  const periodLabel = teamFromDate || teamToDate ? `${teamFromDate || '—'} to ${teamToDate || '—'}` : teamMonth || '—';

  const usedNames = new Set();

  // Compute global period meta for summary sheet
  const allSortedForSummary = [];
  for (const { records } of allData) {
    const s = [...(records || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    allSortedForSummary.push(s);
  }
  // Use first non-empty sorted for calendar fallback; otherwise use meta
  const anySorted = allSortedForSummary.find((s) => s.length) || [];
  const globalCalendarDays = getCalendarDays(teamMonth, teamFromDate, teamToDate, anySorted);
  const fromLabel = teamFromDate || (teamMonth ? `${teamMonth}-01` : '—');
  const toLabel = teamToDate || (teamMonth ? `${teamMonth}-${String(globalCalendarDays).padStart(2, '0')}` : '—');
  const generatedAt = new Date().toLocaleString();

  // ── Summary sheet (always first) ────────────────────────────────────────────
  const summary = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FF0F172A' } } });
  summary.views = [{ showGridLines: false }];
  summary.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  summary.columns = [
    { width: 26 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 11 }, { width: 10 }, { width: 11 }, { width: 13 }, { width: 13 }, { width: 15 },
  ];

  // Banner
  summary.mergeCells('A1:K1');
  const sTitle = summary.getCell('A1');
  sTitle.value = 'Attendance Team Report';
  sTitle.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  sTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  sTitle.alignment = { vertical: 'middle', horizontal: 'left' };
  summary.getRow(1).height = 36;

  summary.mergeCells('A2:K2');
  const sMeta = summary.getCell('A2');
  sMeta.value = `Period: ${periodLabel}  •  Downloaded: ${fromLabel} to ${toLabel}  •  Calendar Days: ${globalCalendarDays}  •  Employees: ${allData.length}  •  Generated: ${generatedAt}`;
  sMeta.font = { size: 10, color: { argb: 'FF475569' }, italic: true };
  sMeta.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  summary.getRow(2).height = 22;

  const summaryHeaders = ['Employee', 'Department', 'Role', 'Present', 'On Leave', 'Half-Day', 'Absent', 'Late', 'Permission', 'Short Hours', 'Att. Days'];
  const shRow = summary.getRow(4);
  shRow.values = summaryHeaders;
  shRow.height = 26;
  shRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF93C5FD' } } };
  });

  let totalPresent = 0;
  let totalLeave = 0;
  let totalHalf = 0;
  let totalAbsent = 0;
  let totalLate = 0;
  let totalPerm = 0;
  let totalShort = 0;

  for (const { emp, records } of allData) {
    const sorted = [...(records || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const st = computeStats(sorted);
    totalPresent += st.present;
    totalLeave += st.onLeave;
    totalHalf += st.halfDayLeaveCount;
    totalAbsent += st.absent;
    totalLate += st.late;
    totalPerm += st.permission;
    totalShort += st.shortHours;
    const r = summary.addRow([emp.name || '—', emp.department || '—', emp.role || '—', st.present, st.onLeave, st.halfDayLeaveCount, st.absent, st.late, st.permission, st.shortHours, sorted.length]);
    r.height = 22;
    r.eachCell((cell, col) => {
      cell.font = { size: 10, color: { argb: col <= 3 ? 'FF0F172A' : 'FF334155' }, bold: col <= 3 };
      cell.alignment = { vertical: 'middle', horizontal: col <= 3 ? 'left' : 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      if (r.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  }

  if (allData.length > 1) {
    const totals = summary.addRow(['TOTAL', '—', '—', totalPresent, totalLeave, totalHalf, totalAbsent, totalLate, totalPerm, totalShort, '—']);
    totals.height = 24;
    totals.eachCell((cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FF0F172A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'medium', color: { argb: 'FF0F172A' } }, bottom: { style: 'medium', color: { argb: 'FF0F172A' } } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    });
  }

  summary.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  summary.autoFilter = { from: 'A4', to: `K${summary.rowCount}` };
  summary.headerFooter.oddFooter = `&LAttendance Team Report&CPage &P of &N&R${periodLabel}`;

  // ── Per-employee sheets ────────────────────────────────────────────────────
  for (const { emp, records } of allData) {
    const sorted = [...(records || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const headers = ['Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours Worked'];
    const colCount = headers.length;
    const sheetName = uniqueSheetName(emp.name || 'Employee', usedNames);
    const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: 'FF2563EB' } } });
    ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: false }];
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
    ws.columns = [{ width: 14 }, { width: 10 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 }];
    ws.headerFooter.oddFooter = `&L${emp.name || 'Employee'}&CPage &P of &N&R${periodLabel}`;

    const st = computeStats(sorted);
    const calendarDays = getCalendarDays(teamMonth, teamFromDate, teamToDate, sorted);
    const empFromLabel = teamFromDate || (teamMonth ? `${teamMonth}-01` : sorted[0]?.date || '—');
    const empToLabel = teamToDate || (teamMonth ? `${teamMonth}-${String(calendarDays).padStart(2, '0')}` : sorted[sorted.length - 1]?.date || '—');

    // Row 1: Employee banner
    ws.mergeCells(1, 1, 1, colCount);
    const nameCell = ws.getCell(1, 1);
    nameCell.value = `Employee: ${emp.name || '—'}`;
    nameCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 32;

    // Row 2: Role | Department | Period
    ws.mergeCells(2, 1, 2, colCount);
    const infoCell = ws.getCell(2, 1);
    infoCell.value = `Role: ${emp.role || '—'}   •   Department: ${emp.department || '—'}   •   Period: ${periodLabel}`;
    infoCell.font = { size: 10, color: { argb: 'FF475569' }, italic: true };
    infoCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    ws.getRow(2).height = 20;

    // Row 3: Downloaded range + calendar/attendance days
    ws.mergeCells(3, 1, 3, colCount);
    const rangeCell = ws.getCell(3, 1);
    rangeCell.value = `Downloaded: ${empFromLabel} to ${empToLabel}   •   Calendar Days: ${calendarDays}   •   Attendance Days: ${sorted.length}   •   Generated: ${generatedAt}`;
    rangeCell.font = { size: 9, color: { argb: 'FF64748B' } };
    rangeCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    ws.getRow(3).height = 18;

    // Row 4: Summary chips — one metric per cell for easy reading
    const summaryLabels = [
      `Present: ${st.present}`,
      `On Leave: ${st.onLeave} (${st.halfDayLeaveCount} half-day)`,
      `Absent: ${st.absent}`,
      `Late: ${st.late}`,
      `Permission: ${st.permission}`,
      `Short Hours: ${st.shortHours}`,
    ];
    const sumRow = ws.getRow(4);
    summaryLabels.forEach((label, i) => {
      const c = sumRow.getCell(i + 1);
      c.value = label;
      c.font = { size: 10, bold: true, color: { argb: 'FF0F172A' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    sumRow.height = 22;

    // Row 5 spacer
    ws.getRow(5).height = 6;

    // Row 6 headers
    const headerRow = ws.getRow(6);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
    });
    styleHeaderRow(headerRow);

    // Row 7+ data
    if (sorted.length === 0) {
      ws.mergeCells(7, 1, 7, colCount);
      const empty = ws.getCell(7, 1);
      empty.value = 'No attendance records for this period.';
      empty.font = { size: 11, color: { argb: 'FF94A3B8' }, italic: true };
      empty.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      ws.getRow(7).height = 26;
    } else {
      sorted.forEach((r, idx) => {
        const row = ws.getRow(7 + idx);
        const dayLabel = DAYS[new Date(r.date + 'T00:00:00').getDay()] || '';
        const statusLabel = STATUS_STYLE[r.status]?.label || statusChip(r.status).label;
        const values = [r.date, dayLabel, statusLabel, formatTimeFn(r.clockIn) || '—', formatTimeFn(r.clockOut) || '—', r.hoursWorked ? formatMins(r.hoursWorked) : '—'];
        values.forEach((v, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value = v;
        });
        styleDataRow(row);
        // Status chip override (col 3)
        const chip = statusChip(r.status);
        const statusCell = row.getCell(3);
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: chip.fill } };
        statusCell.font = { color: { argb: chip.font }, bold: chip.bold, size: 11 };
      });
    }

    if (sorted.length > 0) {
      ws.autoFilter = { from: 'A6', to: `F${6 + sorted.length}` };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

export async function buildAttendancePdf(allData, meta = {}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF('l', 'mm', 'a4');

  const teamMonth = meta.teamMonth || '';
  const teamFromDate = meta.teamFromDate || '';
  const teamToDate = meta.teamToDate || '';
  const formatTimeFn = meta.formatTime || ((v) => v || '');
  const periodLabel = teamFromDate || teamToDate ? `${teamFromDate || '—'} to ${teamToDate || '—'}` : teamMonth || '—';
  const anySorted = [...(allData[0]?.records || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const globalCalendarDays = getCalendarDays(teamMonth, teamFromDate, teamToDate, anySorted);
  const fromLabel = teamFromDate || (teamMonth ? `${teamMonth}-01` : '—');
  const toLabel = teamToDate || (teamMonth ? `${teamMonth}-${String(globalCalendarDays).padStart(2, '0')}` : '—');
  const generatedAt = new Date().toLocaleString();

  const pdfStatusStyle = (status) => {
    const chip = statusChip(status);
    const hexToRgb = (argb) => {
      const hex = String(argb).slice(2);
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    };
    return { fill: hexToRgb(chip.fill), text: hexToRgb(chip.font), bold: chip.bold };
  };

  // ── Cover / Summary page (always first for parity with Excel Summary sheet) ──
  // Dark banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 297, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text('Attendance Team Report', 14, 11);
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.text(`Period: ${periodLabel}  •  Downloaded: ${fromLabel} to ${toLabel}  •  Calendar Days: ${globalCalendarDays}  •  Employees: ${allData.length}  •  Generated: ${generatedAt}`, 14, 24);

  const summaryBody = allData.map(({ emp, records }) => {
    const sorted = [...(records || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const st = computeStats(sorted);
    return [emp.name || '—', emp.department || '—', emp.role || '—', String(st.present), String(st.onLeave), String(st.halfDayLeaveCount), String(st.absent), String(st.late), String(st.permission), String(st.shortHours), String(sorted.length)];
  });

  let totalsRow = null;
  if (allData.length > 1) {
    const totals = summaryBody.reduce(
      (acc, row) => {
        for (let i = 3; i <= 9; i++) acc[i] += Number(row[i]) || 0;
        acc[10] += Number(row[10]) || 0;
        return acc;
      },
      { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 },
    );
    totalsRow = ['TOTAL', '—', '—', String(totals[3]), String(totals[4]), String(totals[5]), String(totals[6]), String(totals[7]), String(totals[8]), String(totals[9]), String(totals[10])];
  }

  autoTable(doc, {
    startY: 30,
    head: [['Employee', 'Department', 'Role', 'Present', 'On Leave', 'Half-Day', 'Absent', 'Late', 'Permission', 'Short Hours', 'Att. Days']],
    body: totalsRow ? [...summaryBody, totalsRow] : summaryBody,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    didParseCell: (data) => {
      if (data.section === 'body' && totalsRow && data.row.index === summaryBody.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });

  // Per-employee detail pages
  for (let empIdx = 0; empIdx < allData.length; empIdx++) {
    const { emp, records } = allData[empIdx];
    doc.addPage();
    // Banner per employee
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 16, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(`Attendance — ${emp.name || 'Employee'}`, 14, 10);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text(`Role: ${emp.role || '—'}   •   Department: ${emp.department || '—'}   •   Period: ${periodLabel}`, 14, 21);

    const sorted = [...(records || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const calendarDays = getCalendarDays(teamMonth, teamFromDate, teamToDate, sorted);
    const empFromLabel = teamFromDate || (teamMonth ? `${teamMonth}-01` : sorted[0]?.date || '—');
    const empToLabel = teamToDate || (teamMonth ? `${teamMonth}-${String(calendarDays).padStart(2, '0')}` : sorted[sorted.length - 1]?.date || '—');
    const st = computeStats(sorted);

    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text(`Downloaded: ${empFromLabel} to ${empToLabel}   •   Calendar Days: ${calendarDays}   •   Attendance Days: ${sorted.length}   •   Generated: ${generatedAt}`, 14, 26);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text(`Present: ${st.present}   •   On Leave: ${st.onLeave} (${st.halfDayLeaveCount} half-day)   •   Absent: ${st.absent}   •   Late: ${st.late}   •   Permission: ${st.permission}   •   Short Hours: ${st.shortHours}`, 14, 31);
    doc.setFont(undefined, 'normal');

    const rows = sorted.map((r) => [
      r.date,
      DAYS[new Date(r.date + 'T00:00:00').getDay()] || '',
      STATUS_STYLE[r.status]?.label || statusChip(r.status).label,
      formatTimeFn(r.clockIn) || '—',
      formatTimeFn(r.clockOut) || '—',
      r.hoursWorked ? formatMins(r.hoursWorked) : '—',
    ]);

    if (rows.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(148, 163, 184);
      doc.text('No attendance records for this period.', 14, 40);
      continue;
    }

    autoTable(doc, {
      startY: 34,
      head: [['Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours Worked']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 2) {
          const stt = sorted[data.row.index]?.status;
          const s = pdfStatusStyle(stt);
          data.cell.styles.fillColor = s.fill;
          data.cell.styles.textColor = s.text;
          if (s.bold) data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  return doc;
}
