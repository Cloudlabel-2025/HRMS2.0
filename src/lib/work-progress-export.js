'use client';

import { api } from '@/lib/api';
import { computeWorkRowDuration } from '@/lib/attendance-constants';

export const WORK_PROGRESS_EXPORT_KEY = 'hrms_work_progress_export';
export const WORK_PROGRESS_EXPORT_EVENT = 'hrms-work-progress-export-change';
export const WORK_PROGRESS_EXPORT_SECONDS = 30 * 60;

const safeName = value => String(value || 'employee').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'employee';
const durationText = minutes => {
  const value = Number(minutes) || 0;
  return `${Math.floor(value / 60)}h ${value % 60}m`;
};
const effectiveStatus = row => row?.carriedForward ? 'pending' : (row?.status || 'pending');
const groupByCalendarMonth = cycles => {
  const months = new Map();
  for (const cycle of cycles || []) {
    for (const dateEntry of cycle.dates || []) {
      const key = String(dateEntry.date || '').slice(0, 7);
      if (!key) continue;
      if (!months.has(key)) {
        const [year, month] = key.split('-').map(Number);
        months.set(key, { key, label: new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), dates: [] });
      }
      months.get(key).dates.push(dateEntry);
    }
  }
  return [...months.values()].sort((a, b) => a.key.localeCompare(b.key));
};

function notifyJobChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WORK_PROGRESS_EXPORT_EVENT));
}

export function getWorkProgressExportJob() {
  if (typeof window === 'undefined') return null;
  try {
    const value = localStorage.getItem(WORK_PROGRESS_EXPORT_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function saveWorkProgressExportJob(job) {
  localStorage.setItem(WORK_PROGRESS_EXPORT_KEY, JSON.stringify(job));
  notifyJobChange();
  return job;
}

export function startWorkProgressExportJob({ employeeId, employeeName, filters }) {
  return saveWorkProgressExportJob({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    employeeId,
    employeeName,
    filters,
    createdAt: Date.now(),
    expiresAt: Date.now() + WORK_PROGRESS_EXPORT_SECONDS * 1000,
    minimized: false,
    status: 'pending',
  });
}

export function minimizeWorkProgressExportJob() {
  const job = getWorkProgressExportJob();
  if (job) saveWorkProgressExportJob({ ...job, minimized: true });
}

export function cancelWorkProgressExportJob() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(WORK_PROGRESS_EXPORT_KEY);
  notifyJobChange();
}

export function getWorkProgressExportRemaining(job) {
  return job ? Math.max(0, Math.ceil((job.expiresAt - Date.now()) / 1000)) : 0;
}

export function subscribeWorkProgressExport(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener(getWorkProgressExportJob());
  window.addEventListener(WORK_PROGRESS_EXPORT_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(WORK_PROGRESS_EXPORT_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

function applySheetLayout(sheet) {
  sheet.views = [{ showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  sheet.columns = [
    { width: 6 }, { width: 16 }, { width: 38 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 20 },
    { width: 28 }, { width: 30 }, { width: 16 }, { width: 13 }, { width: 10 }, { width: 18 }, { width: 14 },
  ];
}

const EIGHT_HOURS_MINUTES = 8 * 60;
const displayStatus = value => String(value || '—').replaceAll('_', ' ');
const hasWorkData = row => Boolean(row?.taskDetails || row?.type || row?.startTime || row?.endTime);

function styleDataRow(row, centeredColumns = []) {
  row.height = 30;
  row.eachCell((cell, column) => {
    cell.font = { size: 10, color: { argb: '334155' } };
    cell.alignment = { vertical: 'top', horizontal: centeredColumns.includes(column) ? 'center' : 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'E2E8F0' } } };
    if (row.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
  });
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A5F' } };
    cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: '93C5FD' } } };
  });
}

function addMonthSheet(workbook, cycle, employeeName) {
  const sheetName = safeName(`${cycle.key} Overview`).slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName, { properties: { tabColor: { argb: '2563EB' } } });
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.columns = [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 18 }];
  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = `Monthly Work Overview — ${cycle.label}`;
  sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 34;
  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = `Employee: ${employeeName}  •  Daily target: 8 hours  •  Generated: ${new Date().toLocaleString()}`;
  sheet.getCell('A2').font = { color: { argb: '475569' }, italic: true, size: 10 };
  sheet.getCell('A2').alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 22;

  const headerRow = sheet.getRow(4);
  headerRow.values = ['Date', 'Clock In', 'Clock Out', 'Recorded', '8h Target', 'Missing to 8h', 'Overtime', 'Tasks', 'Breaks', 'Attendance'];
  styleHeader(headerRow);
  for (const dateEntry of [...(cycle.dates || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const recorded = Number(dateEntry.hoursWorked) || 0;
    const workRows = (dateEntry.workProgress || []).filter(hasWorkData);
    const tasks = workRows.filter(row => !['break', 'lunch'].includes(String(row.type).toLowerCase())).length;
    const dataRow = sheet.addRow([dateEntry.date, dateEntry.clockIn || '—', dateEntry.clockOut || '—', durationText(recorded), '8h 0m', durationText(Math.max(0, EIGHT_HOURS_MINUTES - recorded)), durationText(Math.max(0, recorded - EIGHT_HOURS_MINUTES)), tasks, workRows.length - tasks, displayStatus(dateEntry.status)]);
    styleDataRow(dataRow, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }
  sheet.autoFilter = { from: 'A4', to: `J${Math.max(4, sheet.rowCount)}` };
  sheet.headerFooter.oddFooter = `&L${employeeName}&CPage &P of &N&R${cycle.label}`;
  return sheet;
}

function addDailySheet(workbook, dateEntry, employeeName) {
  const sheet = workbook.addWorksheet(safeName(dateEntry.date).slice(0, 31), { properties: { tabColor: { argb: '14B8A6' } } });
  applySheetLayout(sheet);
  sheet.mergeCells('A1:N1');
  sheet.getCell('A1').value = `Daily Work Sheet — ${dateEntry.date}`;
  sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  sheet.getCell('A1').alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 34;
  const recorded = Number(dateEntry.hoursWorked) || 0;
  [
    ['Employee', employeeName, 'Attendance', displayStatus(dateEntry.status)],
    ['Clock In', dateEntry.clockIn || '—', 'Clock Out', dateEntry.clockOut || '—'],
    ['Daily Target', '8h 0m', 'Recorded', durationText(recorded)],
    ['Missing to 8h', durationText(Math.max(0, EIGHT_HOURS_MINUTES - recorded)), 'Overtime', durationText(Math.max(0, recorded - EIGHT_HOURS_MINUTES))],
  ].forEach((values, index) => {
    const row = sheet.getRow(index + 2);
    row.values = values;
    row.height = 22;
    [1, 3].forEach(column => { row.getCell(column).font = { bold: true, color: { argb: '475569' } }; });
    [2, 4].forEach(column => { row.getCell(column).font = { bold: true, color: { argb: '0F172A' } }; });
  });

  const headerRow = sheet.getRow(7);
  headerRow.values = ['#', 'Entry Type', 'Task / Event Details', 'Start Time', 'End Time', 'Duration', 'Status', 'Remarks', 'Feedback', 'Completed Date', 'Completed At', 'Tries', 'Attendance', 'Carried'];
  styleHeader(headerRow);
  const timeline = [];
  if (dateEntry.clockIn) timeline.push({ type: 'Clock In', taskDetails: 'Attendance clock-in', startTime: dateEntry.clockIn, endTime: dateEntry.clockIn, status: dateEntry.status || 'present', event: true });
  timeline.push(...(dateEntry.workProgress || []).filter(hasWorkData));
  if (dateEntry.clockOut) timeline.push({ type: 'Clock Out', taskDetails: 'Attendance clock-out', startTime: dateEntry.clockOut, endTime: dateEntry.clockOut, status: 'completed', event: true });
  timeline.sort((a, b) => String(a.startTime || '99:99').localeCompare(String(b.startTime || '99:99')));
  if (!timeline.length) timeline.push({ type: 'No entries', taskDetails: 'No clock or work activity was recorded for this date.', event: true });
  timeline.forEach((row, index) => {
    const minutes = row.event ? 0 : (typeof row.duration === 'number' ? row.duration : computeWorkRowDuration(row));
    const dataRow = sheet.addRow([
      index + 1, row.type || 'Task', row.taskDetails || '', row.startTime || '', row.endTime || '', row.event ? '—' : durationText(minutes),
      displayStatus(row.event ? row.status : effectiveStatus(row)), row.remarks || '', row.feedback || '', row.completedDate || '', row.completedAt || '', row.tries ?? '',
      displayStatus(dateEntry.status), row.carriedForward ? 'Yes' : 'No',
    ]);
    styleDataRow(dataRow, [1, 4, 5, 6, 10, 11, 12, 13, 14]);
  });
  sheet.views = [{ state: 'frozen', ySplit: 7, showGridLines: false }];
  sheet.autoFilter = { from: 'A7', to: `N${sheet.rowCount}` };
  sheet.headerFooter.oddFooter = `&L${employeeName}&CPage &P of &N&R${dateEntry.date}`;
  return sheet;
}

export async function downloadWorkProgressExcel(cycles, employeeName, filters = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const monthlyCycles = groupByCalendarMonth(cycles);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HRMS';
  workbook.created = new Date();
  workbook.modified = new Date();

  const summary = workbook.addWorksheet('Summary', { properties: { tabColor: { argb: '0F172A' } } });
  summary.views = [{ showGridLines: false }];
  summary.columns = [{ width: 24 }, { width: 42 }];
  summary.mergeCells('A1:B1');
  summary.getCell('A1').value = 'Daily Work Sheet Export';
  summary.getCell('A1').font = { bold: true, size: 20, color: { argb: 'FFFFFF' } };
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  summary.getCell('A1').alignment = { vertical: 'middle' };
  summary.getRow(1).height = 38;
  const dateCount = monthlyCycles.reduce((sum, cycle) => sum + (cycle.dates?.length || 0), 0);
  const taskCount = monthlyCycles.reduce((sum, cycle) => sum + (cycle.dates || []).reduce((dateSum, date) => dateSum + (date.workProgress?.length || 0), 0), 0);
  const summaryRows = [
    ['Employee', employeeName], ['Selected from', filters.fromDate || filters.fromMonth || 'All available'],
    ['Selected to', filters.toDate || filters.toMonth || 'All available'], ['Months', monthlyCycles.length], ['Dates', dateCount], ['Work entries', taskCount], ['Generated at', new Date()],
  ];
  summary.addRows(summaryRows);
  summary.getColumn(1).font = { bold: true, color: { argb: '475569' } };
  summary.getColumn(2).alignment = { wrapText: true };
  summary.getCell('B8').numFmt = 'dd-mmm-yyyy hh:mm';
  summary.eachRow((row, index) => {
    if (index > 1) {
      row.height = 24;
      row.eachCell(cell => { cell.border = { bottom: { style: 'thin', color: { argb: 'E2E8F0' } } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
    }
  });

  monthlyCycles.forEach(cycle => addMonthSheet(workbook, cycle, employeeName));
  monthlyCycles
    .flatMap(cycle => cycle.dates || [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(dateEntry => addDailySheet(workbook, dateEntry, employeeName));
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `daily_work_sheet_${safeName(employeeName)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function executeWorkProgressExport(job) {
  const current = getWorkProgressExportJob();
  if (!current || current.id !== job.id || current.status !== 'pending') return;
  saveWorkProgressExportJob({ ...current, status: 'exporting' });
  try {
    const params = new URLSearchParams();
    if (job.filters?.fromMonth) params.set('fromMonth', job.filters.fromMonth);
    if (job.filters?.toMonth) params.set('toMonth', job.filters.toMonth);
    if (job.filters?.fromDate) params.set('fromDate', job.filters.fromDate);
    if (job.filters?.toDate) params.set('toDate', job.filters.toDate);
    const cycles = await api.get(`/api/employees/${job.employeeId}/work-progress${params.size ? `?${params}` : ''}`);
    await downloadWorkProgressExcel(Array.isArray(cycles) ? cycles : [], job.employeeName, job.filters);
    cancelWorkProgressExportJob();
  } catch (error) {
    saveWorkProgressExportJob({ ...job, status: 'failed', error: error.message || 'Export failed', minimized: true });
  }
}
