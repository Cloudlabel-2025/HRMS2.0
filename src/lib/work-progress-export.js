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
  const sheetName = safeName(cycle.key || cycle.label).slice(0, 31);
  const sheet = workbook.addWorksheet(sheetName, { properties: { tabColor: { argb: '2563EB' } } });
  applySheetLayout(sheet);
  sheet.mergeCells('A1:N1');
  sheet.getCell('A1').value = `Daily Work Sheet — ${cycle.label}`;
  sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 34;
  sheet.mergeCells('A2:N2');
  sheet.getCell('A2').value = `Employee: ${employeeName}  •  Generated: ${new Date().toLocaleString()}`;
  sheet.getCell('A2').font = { color: { argb: '475569' }, italic: true, size: 10 };
  sheet.getCell('A2').alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 22;

  const headers = ['#', 'Type', 'Task Details', 'Start Time', 'End Time', 'Duration', 'Task Status', 'Remarks', 'Feedback', 'Completed Date', 'Completed At', 'Tries', 'Attendance', 'Carried'];
  let rowNumber = 4;
  for (const dateEntry of [...(cycle.dates || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    sheet.mergeCells(rowNumber, 1, rowNumber, 14);
    const dateCell = sheet.getCell(rowNumber, 1);
    dateCell.value = `${dateEntry.date}  •  ${dateEntry.status || '—'}  •  Clock In: ${dateEntry.clockIn || '—'}  •  Clock Out: ${dateEntry.clockOut || '—'}  •  Hours: ${durationText(dateEntry.hoursWorked)}`;
    dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DBEAFE' } };
    dateCell.font = { bold: true, color: { argb: '1E40AF' }, size: 11 };
    dateCell.alignment = { vertical: 'middle' };
    sheet.getRow(rowNumber).height = 25;
    rowNumber++;

    const headerRow = sheet.getRow(rowNumber);
    headerRow.values = headers;
    styleHeader(headerRow);
    rowNumber++;

    const workRows = dateEntry.workProgress?.length ? dateEntry.workProgress : [{}];
    workRows.forEach((row, index) => {
      const dataRow = sheet.getRow(rowNumber);
      const minutes = typeof row.duration === 'number' ? row.duration : computeWorkRowDuration(row);
      dataRow.values = [
        row.taskDetails || row.type ? index + 1 : '', row.type || '', row.taskDetails || '', row.startTime || '', row.endTime || '',
        row.taskDetails || row.type ? durationText(minutes) : '', row.taskDetails || row.type ? effectiveStatus(row).replaceAll('_', ' ') : '',
        row.remarks || '', row.feedback || '', row.completedDate || '', row.completedAt || '', row.tries ?? '', dateEntry.status || '', row.carriedForward ? 'Yes' : 'No',
      ];
      dataRow.height = 30;
      dataRow.eachCell((cell, column) => {
        cell.font = { size: 10, color: { argb: '334155' } };
        cell.alignment = { vertical: 'top', horizontal: [1, 4, 5, 6, 10, 11, 12, 13, 14].includes(column) ? 'center' : 'left', wrapText: true };
        cell.border = { bottom: { style: 'thin', color: { argb: 'E2E8F0' } } };
        if (rowNumber % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
      });
      rowNumber++;
    });
    rowNumber++;
  }
  sheet.autoFilter = undefined;
  sheet.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  sheet.headerFooter.oddFooter = `&L${employeeName}&CPage &P of &N&R${cycle.label}`;
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
