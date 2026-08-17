'use client';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings, formatTime, parseTime } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';
import Time from '@/components/Time';
import { getAttendanceDate } from '@/lib/attendance-date';
import { formatMins } from '@/lib/format';
import { STATUS_STYLE, WP_STATUS_STYLE, MONTHS, MANAGER_ROLES } from '@/lib/constants';
import { getRuleAllowance, calculateBreakDeduction, isBreakType, breakStyle, matchBreakRule } from '@/lib/attendance-breaks';
import { formatTaskDuration, computeWorkRowDuration } from '@/lib/attendance-constants';
import Pagination from '@/components/Pagination';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_BREAK_RULES = [
  { type: 'break', maxDuration: 30, maxCount: 1 },
  { type: 'lunch', maxDuration: 60, maxCount: 1 },
];
const WORK_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'work_in_progress', label: 'Work in Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'task_blocked', label: 'Task Blocked' },
  { value: 'stopped', label: 'Stopped' },
];

function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function nowTimeStr() {
  const n = new Date();
  return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}

function diffMins(start, end) {
  if (!start || !end) return 0;
  const s = toMinutes(start), e = toMinutes(end);
  return e > s ? e - s : 0;
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { formatDate, settings, formatTime, parseTime } = useSettings();
  const [tab, setTab]                   = useState('today');
  const [todayRecord, setTodayRecord]   = useState(null);
  const [staleOpenSession, setStaleOpenSession] = useState(null);
  const [teamToday, setTeamToday]       = useState([]);
  const [employees, setEmployees]       = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [clockLoading, setClockLoading] = useState(false);
  const [clockAction, setClockAction] = useState(null);
  const [confirmClockOut, setConfirmClockOut] = useState(false);
  const clockBusyRef = useRef(false);
  const [loading, setLoading]           = useState(true);
  const [toastQueue, setToastQueue] = useState([]);
  const [regRequests, setRegRequests]   = useState([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm]           = useState({ date: '', requestedIn: '', requestedOut: '', requestedOutNotYet: false, requestedBreaks: [], reason: '' });
  const [regSaving, setRegSaving]       = useState(false);
  const [todayPage, setTodayPage]       = useState(1);
  const [regPage, setRegPage]           = useState(1);
  const canReview = useMemo(() => MANAGER_ROLES.includes(user?.role), [user?.role]);
  const [regScope, setRegScope]         = useState(canReview ? 'approvals' : 'my');
  const [progressEmpPage, setProgressEmpPage] = useState(1);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showEarlyClockModal, setShowEarlyClockModal] = useState(false);
  const [earlyClockReason, setEarlyClockReason] = useState('');
  const [workProgressDirty, setWorkProgressDirty] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    setTodayPage(1);
    setRegPage(1);
    setProgressEmpPage(1);
  }, [tab]);

  // Break / Lunch local state (client-side only — stored in todayRecord.breaks)
  const [breakRuleIdx, setBreakRuleIdx] = useState(0);
  const [breakLoading, setBreakLoading] = useState(false);

  const [shifts, setShifts] = useState([]);
  const [shiftConfig, setShiftConfig] = useState(null);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);

  // Progress tab states
  const [progressSearch, setProgressSearch] = useState('');
  const [selectedProgressUserId, setSelectedProgressUserId] = useState('');
  const [progressRecord, setProgressRecord] = useState(null);
  const [progressLoading, setProgressLoading] = useState(false);

  // Available tasks (from Projects & Task Management)
  const [availableTasks, setAvailableTasks] = useState([]);
  const [carriedTasks, setCarriedTasks] = useState([]);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const taskPickerRef = useRef(null);
  const workProgressRef = useRef([]);
  const workProgressSaveTimer = useRef(null);
  const triesRef = useRef(new Map());
  const pinRef = useRef(null);
  const todayRecordRef = useRef(null);

  // Work progress save
  const [saveWorkLoading, setSaveWorkLoading] = useState(false);
  const handleSaveWork = async () => {
    setSaveWorkLoading(true);
    try {
      await saveWorkProgress();
      showToast('Work progress saved');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaveWorkLoading(false); }
  };

  const showToast = (msg, type = 'success') => {
    const id = Date.now() + Math.random();
    setToastQueue(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToastQueue(prev => prev.filter(t => t.id !== id)), 3000);
  };

  const buildDateQuery = (uid) => {
    let q = `?scope=team${uid ? '&userId=' + uid : ''}&month=${teamMonth}`;
    if (teamFromDate) q += `&fromDate=${teamFromDate}`;
    if (teamToDate) q += `&toDate=${teamToDate}`;
    return q;
  };

  const fetchEmployeeAttendance = async (empUserId) => {
    const q = buildDateQuery(empUserId);
    const records = await api.get('/api/attendance' + q);
    return Array.isArray(records) ? records : [];
  };

  const handleDownload = async (format) => {
    setDownloadLoading(true);
    try {
      let targets;
      if (showAllEmployees && !selectedUserId) {
        targets = employees;
      } else if (selectedUserId) {
        targets = employees.filter(e => e.userId === selectedUserId);
      } else {
        targets = [{ userId: user?._id, name: user?.name, role: user?.role, department: user?.department }];
      }

      if (targets.length === 0) { showToast('No employee data to download', 'error'); return; }

      const allData = [];
      for (const emp of targets) {
        const records = await fetchEmployeeAttendance(emp.userId);
        allData.push({ emp, records });
      }

      if (format === 'excel') {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'HRMS';
        wb.created = new Date();

        for (const { emp, records } of allData) {
          const sorted = [...records].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
          const headers = ['Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours Worked'];
          const colCount = headers.length;
          const sheetName = (emp.name || 'Employee').slice(0, 31);
          const ws = wb.addWorksheet(sheetName);

          const thinBorder = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
          const centerAlign = { horizontal: 'center', vertical: 'middle' };

          // Row 1: Employee name — merged, bold, font 14
          ws.mergeCells(1, 1, 1, colCount);
          const nameCell = ws.getCell(1, 1);
          nameCell.value = `Employee: ${emp.name || '—'}`;
          nameCell.font = { bold: true, size: 14 };
          nameCell.alignment = centerAlign;

          // Row 2: Role | Department | Period — merged, font 10
          ws.mergeCells(2, 1, 2, colCount);
          const infoCell = ws.getCell(2, 1);
          infoCell.value = `Role: ${emp.role || '—'}  |  Department: ${emp.department || '—'}  |  Period: ${teamMonth}`;
          infoCell.font = { size: 10 };
          infoCell.alignment = centerAlign;

          // Row 3: empty spacer
          // Row 4: Column headers
          const headerRow = ws.getRow(4);
          headers.forEach((h, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
            cell.alignment = centerAlign;
            cell.border = thinBorder;
          });

          // Row 5+: Data rows
          sorted.forEach((r, idx) => {
            const row = ws.getRow(5 + idx);
            const values = [
              r.date,
              DAYS[new Date(r.date + 'T00:00:00').getDay()],
              STATUS_STYLE[r.status]?.label || r.status,
              formatTime(r.clockIn) || '—',
              formatTime(r.clockOut) || '—',
              r.hoursWorked ? formatMins(r.hoursWorked) : '—',
            ];
            values.forEach((v, ci) => {
              const cell = row.getCell(ci + 1);
              cell.value = v;
              cell.alignment = centerAlign;
              cell.border = thinBorder;
            });
          });

          // Auto-fit column widths: max string length + padding of 4
          const dataRows = sorted.length;
          for (let ci = 0; ci < colCount; ci++) {
            let maxLen = headers[ci].length;
            for (let ri = 0; ri < dataRows; ri++) {
              const cellVal = ws.getRow(5 + ri).getCell(ci + 1).value;
              if (cellVal != null) maxLen = Math.max(maxLen, String(cellVal).length);
            }
            ws.getColumn(ci + 1).width = maxLen + 4;
          }
        }

        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_report_${teamMonth}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const doc = new jsPDF('l', 'mm', 'a4');
        let isFirst = true;
        for (const { emp, records } of allData) {
          if (!isFirst) doc.addPage();
          isFirst = false;

          doc.setFontSize(14);
          doc.setFont(undefined, 'bold');
          doc.text(`Attendance Report — ${emp.name || 'Employee'}`, 14, 15);
          doc.setFontSize(10);
          doc.setFont(undefined, 'normal');
          doc.text(`Role: ${emp.role || '—'}   |   Department: ${emp.department || '—'}   |   Period: ${teamMonth}`, 14, 22);

          const rows = records.map(r => [
            r.date,
            DAYS[new Date(r.date + 'T00:00:00').getDay()],
            STATUS_STYLE[r.status]?.label || r.status,
            formatTime(r.clockIn) || '—',
            formatTime(r.clockOut) || '—',
            r.hoursWorked ? formatMins(r.hoursWorked) : '—',
          ]);

          autoTable(doc, {
            startY: 28,
            head: [['Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours Worked']],
            body: rows,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [59, 130, 246] },
          });
        }
        doc.save(`attendance_report_${teamMonth}.pdf`);
      }
      showToast('Downloaded successfully');
    } catch (e) { showToast('Download failed: ' + e.message, 'error'); }
    finally { setDownloadLoading(false); }
  };

  const isAdmin = canReview;
  const isSuperAdmin = useMemo(() => user?.role === 'super_admin', [user?.role]);

  useEffect(() => {
    if (isSuperAdmin) setRegScope('approvals');
  }, [isSuperAdmin]);

  const [today, setToday] = useState(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  });

  // Re-evaluate the shift-aware "today" every 60s and when the tab regains
  // visibility, so night-shift users don't get stuck on a stale date after
  // midnight (and don't get a spurious "clock in" on the calendar date).
  // While a session is open the date is pinned to the session date (no 12am
  // refresh); after clock-out it stays pinned for 10 minutes before rolling.
  const computeToday = useCallback((d, shiftsList, u) => {
    if ((u?.shift || u?.shiftId) && shiftsList.length > 0) {
      const matched = shiftsList.find(s => (u?.shiftId && s._id === u.shiftId) || s.name === u?.shift);
      if (matched?.startTime && matched?.endTime) {
        return getAttendanceDate(d, matched.startTime, matched.endTime);
      }
    }
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }, []);

  useEffect(() => {
    if (!user) return;
    const apply = () => {
      const rec = todayRecordRef.current;
      if (rec?.clockIn && !rec?.clockOut) {
        // Open session: pin today to the session's shift-aware date.
        setToday(prev => prev === rec.date ? prev : rec.date);
        return;
      }
      if (pinRef.current && Date.now() < pinRef.current.until) {
        // Post-clockout grace: keep showing the completed sheet.
        setToday(prev => prev === pinRef.current.date ? prev : pinRef.current.date);
        return;
      }
      pinRef.current = null;
      todayRecordRef.current = null;
      setTodayRecord(null);
      setStaleOpenSession(null);
      const next = computeToday(new Date(), shifts, user);
      setToday(prev => prev === next ? prev : next);
    };
    apply();
    const timer = setInterval(apply, 60000);
    document.addEventListener('visibilitychange', apply);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', apply); };
  }, [user, shifts, computeToday]);
  const month   = today.slice(0, 7);

  // Team tab filters
  const [teamMonth, setTeamMonth] = useState(month);
  const [teamFromDate, setTeamFromDate] = useState('');
  const [teamToDate, setTeamToDate] = useState('');
  const [showAllEmployees, setShowAllEmployees] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);

  const loadTodayRecord = async () => {
    try {
      const [todayRecs, openRecs] = await Promise.all([
        api.get('/api/attendance?date=' + today + '&scope=my'),
        api.get('/api/attendance?openOnly=1&scope=my'),
      ]);
      const todayRec = Array.isArray(todayRecs) && todayRecs.length > 0 ? todayRecs[0] : null;
      const openRec = Array.isArray(openRecs) && openRecs.length > 0 ? openRecs[0] : null;
      if (openRec && openRec.date !== today) {
        // Overnight worker: pin today to the open session's date and show that
        // record directly — no today-dependent reload needed to surface the sheet.
        setToday(openRec.date);
        pinRef.current = { date: openRec.date, until: Date.now() + 10 * 60 * 1000 };
        setTodayRecord(openRec);
        setStaleOpenSession(null);
        return;
      }
      setTodayRecord(todayRec);
      setStaleOpenSession(openRec && openRec.date !== today ? openRec : null);
    } catch { setTodayRecord(null); setStaleOpenSession(null); }
  };

  const loadTeamToday = async () => {
    try {
      const now = new Date();
      const calToday = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      const yest = new Date(now); yest.setDate(yest.getDate() - 1);
      const calYesterday = yest.getFullYear() + '-' + String(yest.getMonth()+1).padStart(2,'0') + '-' + String(yest.getDate()).padStart(2,'0');
      
      const [r1, r2] = await Promise.all([
        api.get('/api/attendance?scope=team&date=' + calToday),
        api.get('/api/attendance?scope=team&date=' + calYesterday),
      ]);
      
      const merged = {};
      for (const r of (Array.isArray(r1) ? r1 : [])) {
        const uid = r.userId?._id?.toString() || r.userId?.toString();
        if (!uid) continue;
        const empShift = shifts.find(s => s.name === r.userId?.shift);
        if (empShift?.startTime && empShift?.endTime) {
          const shiftAwareDate = getAttendanceDate(now, empShift.startTime, empShift.endTime);
          if (r.date !== shiftAwareDate) continue;
        }
        merged[uid] = r;
      }
      for (const r of (Array.isArray(r2) ? r2 : [])) {
        const uid = r.userId?._id?.toString() || r.userId?.toString();
        if (!uid) continue;
        if (merged[uid]) continue;
        const empShift = shifts.find(s => s.name === r.userId?.shift);
        if (!(empShift?.startTime && empShift?.endTime)) continue;
        const shiftAwareDate = getAttendanceDate(now, empShift.startTime, empShift.endTime);
        if (r.date !== shiftAwareDate) continue;
        merged[uid] = r;
      }
      setTeamToday(Object.values(merged));
    } catch { setTeamToday([]); }
  };

  const loadEmployees = async () => {
    try { const r = await api.get('/api/employees'); setEmployees(Array.isArray(r) ? r : []); }
    catch { setEmployees([]); }
  };

  const loadRegRequests = async (scope) => {
    try { const r = await api.get('/api/attendance/regularize?scope=' + scope); setRegRequests(Array.isArray(r) ? r : []); }
    catch { setRegRequests([]); }
  };

  const loadProgressRecord = async (uid) => {
    if (!uid) { setProgressRecord(null); return; }
    setProgressLoading(true);
    try {
      const records = await api.get('/api/attendance?scope=team&userId=' + uid + '&date=' + today);
      setProgressRecord(Array.isArray(records) && records.length > 0 ? records[0] : null);
    } catch { setProgressRecord(null); }
    finally { setProgressLoading(false); }
  };

  // Keep a live copy of todayRecord so the 60s tick never reads a stale closure.
  useEffect(() => {
    todayRecordRef.current = todayRecord;
  }, [todayRecord]);

  // Latest handlers ref so SSE callbacks never act on stale closures.
  const latestHandlers = useRef({});
  useEffect(() => {
    latestHandlers.current = {
      loadTodayRecord,
      loadProgressRecord,
      loadTeamToday,
      user,
      isAdmin,
      selectedProgressUserId,
    };
  });

  // Live per-employee refresh: listen for clock in/out events pushed by the
  // server and refresh only the affected data.
  useEffect(() => {
    if (!user) return;
    let es = null;
    let teamTimer = null;
    const debounceTeam = () => {
      if (teamTimer) clearTimeout(teamTimer);
      teamTimer = setTimeout(() => latestHandlers.current.loadTeamToday(), 1000);
    };
    const connect = () => {
      es = new EventSource('/api/attendance/events');
      es.onmessage = (e) => {
        let evt;
        try { evt = JSON.parse(e.data); } catch { return; }
        if (!evt || (evt.type !== 'clockin' && evt.type !== 'clockout')) return;
        const h = latestHandlers.current;
        if (String(evt.userId) === String(h.user?._id)) {
          if (evt.type === 'clockout') {
            // Keep the completed sheet visible for 10 minutes even when the
            // clock-out happened in another tab.
            pinRef.current = { date: evt.date, until: Date.now() + 10 * 60 * 1000 };
          }
          h.loadTodayRecord();
        }
        if (h.isAdmin && String(evt.userId) === String(h.selectedProgressUserId)) {
          h.loadProgressRecord(h.selectedProgressUserId);
        }
        if (h.isAdmin) debounceTeam();
      };
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          if (es) es.close();
          es = null;
          fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
            .then(() => connect())
            .catch(() => { /* stay disconnected; next reload retries */ });
        }
      };
    };
    connect();
    return () => {
      if (teamTimer) clearTimeout(teamTimer);
      if (es) es.close();
    };
  }, [user]);

  useEffect(() => {
    if (tab === 'progress' && selectedProgressUserId) {
      loadProgressRecord(selectedProgressUserId);
    }
    // No `today` dependency: new-day data for the selected employee arrives via
    // SSE and on re-selection, never from a midnight rollover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProgressUserId, tab]);

  useEffect(() => {
    const handleClick = (e) => {
      if (taskPickerRef.current && !taskPickerRef.current.contains(e.target)) {
        setShowTaskPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fire page-view audit exactly once per mount — useRef prevents double-fire in React Strict Mode
  const pageViewFired = useRef(false);
  useEffect(() => {
    if (!user || pageViewFired.current) return;
    pageViewFired.current = true;
    api.post('/api/audit/page-view', { module: 'Attendance', details: 'Opened Attendance module' }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.get('/api/settings?type=shifts').then(d => {
      const allShifts = Array.isArray(d) ? d : [];
      setShifts(allShifts);
      setShiftsLoaded(true);
      const matched = allShifts.find(s => (user?.shiftId && s._id === user.shiftId) || s.name === user?.shift);
      setShiftConfig(matched || null);
    }).catch(() => setShiftsLoaded(true));
    Promise.all([
      isAdmin ? loadEmployees() : Promise.resolve(),
      loadRegRequests(isSuperAdmin ? 'approvals' : regScope),
      api.get('/api/attendance/available-tasks').then(tasks => {
        setAvailableTasks(Array.isArray(tasks) ? tasks : []);
      }).catch(() => {}),
      api.get('/api/attendance/carried-forward').then(list => {
        if (Array.isArray(list)) setCarriedTasks(list);
      }).catch(() => {}),
      api.get('/api/attendance?scope=my').then(records => {
        const tries = new Map();
        (Array.isArray(records) ? records : []).forEach(rec => {
          (rec.workProgress || []).forEach(row => {
            if (row.type !== 'task' || !row.taskDetails) return;
            const title = String(row.taskDetails).trim();
            if (!title) return;
            if (!tries.has(title)) tries.set(title, new Set());
            tries.get(title).add(rec.date);
          });
        });
        triesRef.current = tries;
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (!user || !shiftsLoaded) return;
    loadTodayRecord();
    if (isAdmin) loadTeamToday();
    // Deliberately independent of `today`: this runs once context is ready, so
    // a midnight rollover never triggers a GET. New-day data comes from SSE
    // events and the explicit actions below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, shiftsLoaded]);

  // Warn on unsaved work progress
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    workProgressRef.current = todayRecord?.workProgress || [];
  }, [todayRecord?.workProgress]);

  // Auto-save work progress every 2 minutes if dirty
  useEffect(() => {
    if (!workProgressDirty) return;
    const timer = setInterval(() => {
      if (workProgressDirty) saveWorkProgress();
    }, 120000);
    return () => clearInterval(timer);
  }, [workProgressDirty]);

  // Clear a pending task-detail save if the page is closed.
  useEffect(() => {
    return () => { if (workProgressSaveTimer.current) clearTimeout(workProgressSaveTimer.current); };
  }, []);

  const handleClock = async (action) => {
    if (clockBusyRef.current) return;
    clockBusyRef.current = true;
    setClockLoading(true);
    setClockAction(action);
    try {
      let payload = { action, clientTime: new Date().toISOString() };
      const result = await api.post('/api/attendance/clock', payload);
      setTodayRecord(result.record);
      if (action === 'out') {
        // Show the completed sheet for 10 minutes, then roll to the new day.
        pinRef.current = { date: result.record.date, until: Date.now() + 10 * 60 * 1000 };
      }
      if (action === 'in' && result.alreadyClockedIn) {
        showToast('You are already clocked in', 'info');
      } else if (action === 'in' && result.record?.lateFlag) {
        showToast('Late clock-in detected — your attendance has been marked as Late', 'warning');
      } else if (action === 'out' && result.deductionBreakdown) {
        showToast(
          `Clocked out — ${result.hoursWorked} min worked, ${result.deductionBreakdown.totalDeduction} min deducted for breaks`,
          'info'
        );
      } else if (action === 'in' && !result.record?.lateFlag) {
        showToast('Clocked in at ' + result.time);
      } else if (action === 'out') {
        showToast('Clocked out at ' + result.time);
      }
    } catch (e) {
      if (action === 'in' && e.message && e.message.includes('requires a reason')) {
        setEarlyClockReason('');
        setShowEarlyClockModal(true);
      } else {
        showToast(e.message, 'error');
      }
    }
    finally {
      setClockLoading(false);
      setClockAction(null);
      clockBusyRef.current = false;
    }
  };

  const handleClockButton = (action) => {
    if (action === 'out') { setConfirmClockOut(true); return; }
    handleClock('in');
  };

  const submitEarlyClock = async () => {
    const reason = earlyClockReason;
    if (!reason.trim()) {
      showToast('Reason is required for early clock-in.', 'error');
      return;
    }
    if (reason.trim().length < 10) {
      showToast('Please enter a detailed reason (at least 10 characters).', 'error');
      return;
    }
    setShowEarlyClockModal(false);
    if (clockBusyRef.current) return;
    clockBusyRef.current = true;
    setClockLoading(true);
    setClockAction('in');
    try {
      const result = await api.post('/api/attendance/clock', { action: 'in', reason, clientTime: new Date().toISOString() });
      setTodayRecord(result.record);
      showToast('Clocked in at ' + result.time);
    } catch (retryErr) {
      showToast(retryErr.message, 'error');
    }
    finally {
      setClockLoading(false);
      setClockAction(null);
      clockBusyRef.current = false;
    }
  };

  // ── Break / Lunch helpers ──────────────────────────────────────────────────
  // We store breaks in todayRecord locally; in a real app you'd persist via API.
  // Structure: todayRecord.breaks = [{ type, name, ruleIdx, start, end }]
  // A break entry is matched to its shift-config rule via ruleIdx (preferred),
  // then name+type, then type — so multiple same-type rules stay independent.

  const getRuleBreaks = (rule, ruleIdx) =>
    (todayRecord?.breaks || []).filter(b => matchBreakRule(b, breakRules)?.index === ruleIdx);

  const activeBreakForRule = (rule, ruleIdx) => getRuleBreaks(rule, ruleIdx).find(b => b.start && !b.end);
  const anyActiveBreak = () => (todayRecord?.breaks || []).find(b => b.start && !b.end);
  const getWorkProgress = () => todayRecord?.workProgress || [];
  const activeWorkIndex = () => getWorkProgress().findIndex(row => row.startTime && !row.endTime);

  const persistTodayRecord = async (updates) => {
    const updated = await api.put('/api/attendance', { date: today, ...updates });
    setTodayRecord(updated);
    setWorkProgressDirty(false);
    return updated;
  };

  // Keep workProgressRef and the debounced auto-save in sync so a pending save
  // can never overwrite a newer change (e.g. a task resumed right after a break).
  const syncWorkRef = (rows) => {
    workProgressRef.current = rows;
    if (workProgressSaveTimer.current) clearTimeout(workProgressSaveTimer.current);
  };

  const buildTaskRow = (startTime, taskDetails = '') => ({
    type: 'task',
    taskDetails,
    startTime,
    endTime: null,
    status: 'work_in_progress',
    remarks: '',
    feedback: '',
  });

  const breakLabel = (type) => (shiftConfig?.breaks || []).find(b => b.type === type)?.name || type || 'Break';
  const breakLabelForRule = (rule) => rule?.name || rule?.type || 'Break';

  const buildBreakRow = (rule, startTime) => ({
    type: rule.type,
    taskDetails: breakLabelForRule(rule),
    startTime,
    endTime: null,
    status: 'work_in_progress',
    remarks: '',
    feedback: '',
  });

  const closeActiveWork = (rows, endTime, status = 'stopped') => {
    const idx = rows.findIndex(row => row.startTime && !row.endTime);
    if (idx === -1) return rows;
    return rows.map((row, i) => i === idx ? { ...row, endTime, status: row.status === 'work_in_progress' ? status : row.status } : row);
  };

  const updateWorkRow = (idx, patch) => {
    setTodayRecord(prev => {
      const workProgress = (prev?.workProgress || []).map((row, i) => i === idx ? { ...row, ...patch } : row);
      workProgressRef.current = workProgress;
      return { ...prev, workProgress };
    });
    setIsDirty(true);
    setWorkProgressDirty(true);
    if (workProgressSaveTimer.current) clearTimeout(workProgressSaveTimer.current);
    workProgressSaveTimer.current = setTimeout(() => saveWorkProgress(), 800);
  };

  const saveWorkProgress = async (rows = workProgressRef.current) => {
    try {
      const updated = await api.put('/api/attendance', { date: today, workProgress: rows });
      // A user may keep typing while a request is in flight. Never replace their newer text.
      if (workProgressRef.current === rows) {
        setTodayRecord(updated);
        setIsDirty(false);
        setWorkProgressDirty(false);
      }
    } catch (e) { showToast(e.message, 'error'); }
  };

  const computeTries = (title) => {
    const existing = triesRef.current.get(String(title || '').trim()) || new Set();
    const dates = new Set(existing);
    dates.add(today);
    return dates.size;
  };

  const applyCompletion = (rows, targetIdx) => {
    const completionTime = nowTimeStr();
    const completableStatuses = new Set(['pending', 'work_in_progress', 'stopped']);
    return rows.map((row, idx) => {
      const isTarget = idx === targetIdx && row.type === 'task';
      const shouldCascade = idx < targetIdx && row.type === 'task' && completableStatuses.has(row.status);
      if (!isTarget && !shouldCascade) return row;
      const needsMetadata = row.status !== 'completed' || !row.completedAt || !row.completedDate || row.tries == null;
      return {
        ...row,
        status: 'completed',
        carriedForward: false,
        endTime: row.endTime || completionTime,
        ...(needsMetadata ? {
          completedAt: completionTime,
          completedDate: today,
          tries: computeTries(row.taskDetails),
        } : {}),
      };
    });
  };

  const completionMetaText = (row) => {
    if (!row?.completedDate) return '';
    const tries = Number(row.tries) || 0;
    return `Completed ${formatDate(row.completedDate)} at ${row.completedAt || '--:--'} · ${tries} ${tries === 1 ? 'try' : 'tries'}`;
  };

  const renderCompletionMeta = (row) => {
    const text = completionMetaText(row);
    return text ? <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>{text}</div> : null;
  };

  const commitWorkRow = async (idx, patch) => {
    const currentRows = todayRecord?.workProgress || [];
    const rows = patch.status === 'completed'
      ? applyCompletion(currentRows, idx)
      : currentRows.map((row, i) => i === idx ? { ...row, ...patch } : row);
    syncWorkRef(rows);
    try { await persistTodayRecord({ workProgress: rows }); }
    catch (e) { showToast(e.message, 'error'); }
  };

  const selectTask = (task) => {
    const projectLabel = task.projectId?.name ? `[${task.projectId.name}] ` : '';
    const taskTitle = projectLabel + task.title;
    const rows = todayRecord?.workProgress || [];
    const activeIdx = rows.findIndex(r => r.startTime && !r.endTime);

    if (activeIdx !== -1 && rows[activeIdx].type === 'task') {
      const updatedRows = rows.map((row, i) => i === activeIdx ? { ...row, taskDetails: taskTitle } : row);
      syncWorkRef(updatedRows);
      setTodayRecord(prev => ({
        ...prev,
        workProgress: updatedRows,
      }));
      saveWorkProgress(updatedRows);
    }
    setShowTaskPicker(false);
    showToast(`Task selected: ${task.title}`);
  };

  const endCurrentTask = async () => {
    if (!clockedIn) { showToast('Clock in first to end a task.', 'error'); return; }
    if (clockedOut) { showToast('You have already clocked out today.', 'error'); return; }
    if (anyActiveBreak()) { showToast('End your current break first.', 'error'); return; }
    const now = nowTimeStr();
    const currentRows = [...(todayRecord?.workProgress || [])];
    const activeIdx = currentRows.findIndex(row => row.startTime && !row.endTime);
    let rows = closeActiveWork(currentRows, now, 'completed');
    if (activeIdx !== -1 && currentRows[activeIdx]?.type === 'task') rows = applyCompletion(rows, activeIdx);
    rows.push(buildTaskRow(now));
    syncWorkRef(rows);
    try {
      await persistTodayRecord({ workProgress: rows });
      showToast('Task ended at ' + now);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const deleteWorkRow = async (dbIdx) => {
    const rows = [...(todayRecord?.workProgress || [])];
    const deletedRow = rows[dbIdx];
    if (!deletedRow) return;
    const isRunning = deletedRow.startTime && !deletedRow.endTime;

    rows.splice(dbIdx, 1);

    if (isRunning && dbIdx > 0) {
      const prevIdx = dbIdx - 1;
      rows[prevIdx] = { ...rows[prevIdx], endTime: null, status: 'work_in_progress' };
    }

    syncWorkRef(rows);
    try {
      await persistTodayRecord({ workProgress: rows });
      setDeleteConfirmIdx(null);
      showToast('Task deleted');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const totalRuleMins = (rule, ruleIdx) =>
    getRuleBreaks(rule, ruleIdx).reduce((acc, b) => acc + (b.end ? diffMins(b.start, b.end) : 0), 0);

  const overMinsForRule = (rule, ruleIdx) => {
    const allowance = getRuleAllowance(rule);
    return Math.max(0, totalRuleMins(rule, ruleIdx) - allowance);
  };

  const handleBreakClock = async (rule, ruleIdx) => {
    setBreakLoading(true);
    try {
      const now = nowTimeStr();
      const type = rule.type;
      const label = breakLabelForRule(rule);
      const active = activeBreakForRule(rule, ruleIdx);
      let updatedBreaks = [...(todayRecord?.breaks || [])];

      let updatedWorkProgress = [...(todayRecord?.workProgress || [])];

      if (!active) {
        // Start break/lunch
        const maxCount = rule.maxCount ?? 1;
        if (getRuleBreaks(rule, ruleIdx).length >= maxCount) {
          showToast(`You have already taken the maximum ${maxCount} ${label}(s) for today.`, 'error');
          setBreakLoading(false);
          return;
        }
        updatedBreaks.push({ type, name: rule.name || '', ruleIdx, start: now, end: null });
        updatedWorkProgress = closeActiveWork(updatedWorkProgress, now, 'stopped');
        updatedWorkProgress.push(buildBreakRow(rule, now));
        showToast(`${label} started at ${now}`);
      } else {
        // End break/lunch
        // Match by rule first; fall back to any open break of the same type so a
        // stale ruleIdx (e.g. after a shift config change) can never wedge the day.
        let idx = updatedBreaks.findIndex(b => matchBreakRule(b, breakRules)?.index === ruleIdx && b.start && !b.end);
        if (idx === -1) idx = updatedBreaks.findIndex(b => b.type === type && b.start && !b.end);
        if (idx !== -1) updatedBreaks[idx] = { ...updatedBreaks[idx], end: now };
        let workIdx = updatedWorkProgress.findIndex(row => row.type === type && (rule.name ? row.taskDetails === rule.name : true) && row.startTime && !row.endTime);
        if (workIdx === -1) workIdx = updatedWorkProgress.findIndex(row => row.type === type && row.startTime && !row.endTime);
        if (workIdx !== -1) updatedWorkProgress[workIdx] = { ...updatedWorkProgress[workIdx], endTime: now, status: 'completed' };
        const lastTask = [...updatedWorkProgress].reverse().find(row => row.type === 'task' && row.taskDetails);
        if (!clockedOut) updatedWorkProgress.push(buildTaskRow(now, lastTask?.taskDetails || ''));
        const ruleMins = updatedBreaks.filter(b => matchBreakRule(b, breakRules)?.index === ruleIdx && b.end)
          .reduce((acc, b) => acc + diffMins(b.start, b.end), 0);
        const over = Math.max(0, ruleMins - getRuleAllowance(rule));
        if (over > 0) {
          showToast(`${label} ended — ${over} min over allowance. Working hours reduced.`, 'error');
        } else {
          showToast(`${label} ended at ${now}`);
        }
      }

      // Recalculate deduction: total over-time across all break rules
      const totalDeduction = calculateBreakDeduction(updatedBreaks, breakRules);

      // Recalculate effective hours (base hoursWorked minus deductions)
      const baseHours = todayRecord?.baseHoursWorked ?? todayRecord?.hoursWorked ?? 0;
      const effectiveHours = Math.max(0, baseHours - totalDeduction);

      syncWorkRef(updatedWorkProgress);
      await persistTodayRecord({
        breaks: updatedBreaks,
        workProgress: updatedWorkProgress,
        baseHoursWorked: todayRecord.baseHoursWorked ?? todayRecord.hoursWorked ?? 0,
        hoursWorked: effectiveHours,
        breakDeduction: totalDeduction,
      });
    } catch (e) { showToast(e.message, 'error'); }
    finally { setBreakLoading(false); }
  };

  const downloadExcel = () => {
    const dbRows = getWorkProgress();
    let exportRows = dbRows.map(r => ({ ...r }));
    if (todayRecord?.clockIn) {
      exportRows.unshift({
        type: 'clock_in',
        taskDetails: 'Clocked In',
        startTime: todayRecord.clockIn,
        endTime: todayRecord.clockIn,
        status: 'completed',
        remarks: '',
        feedback: ''
      });
    }
    if (todayRecord?.clockOut) {
      exportRows.push({
        type: 'clock_out',
        taskDetails: 'Clocked Out',
        startTime: todayRecord.clockOut,
        endTime: todayRecord.clockOut,
        status: 'completed',
        remarks: '',
        feedback: ''
      });
    }

    const headers = ['S.No', 'Type', 'Task Details', 'Start Time', 'End Time', 'Duration', 'Status', 'Remarks', 'Feedback'];
    const csvRows = [headers.join(',')];

    exportRows.forEach((row, idx) => {
      const values = [
        idx + 1,
        row.type || 'task',
        `"${(row.taskDetails || '').replace(/"/g, '""')}"`,
        row.startTime || '',
        row.endTime || '',
        computeWorkRowDuration(row) ?? '',
        (row.carriedForward ? 'pending' : row.status) || '',
        `"${(row.remarks || '').replace(/"/g, '""')}"`,
        `"${([completionMetaText(row), row.feedback].filter(Boolean).join(' ')).replace(/"/g, '""')}"`
      ];
      csvRows.push(values.join(','));
    });

    const csvContent = '\uFEFF' + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `work_progress_${todayRecord?.date || today}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Regularization ──────────────────────────────────────────────────────────
  const submitRegularization = async () => {
    if (!regForm.date || !regForm.reason) { showToast('Date and reason are required', 'error'); return; }
    if (regForm.requestedIn && !TIME_RE.test(regForm.requestedIn)) { showToast('Clock in must be in HH:MM (24-hour) format', 'error'); return; }
    if (regForm.requestedOut && !TIME_RE.test(regForm.requestedOut)) { showToast('Clock out must be in HH:MM (24-hour) format', 'error'); return; }
    for (const b of (regForm.requestedBreaks || [])) {
      if ((b.start || b.end) && (!b.start || !b.end || !TIME_RE.test(b.start) || !TIME_RE.test(b.end))) {
        showToast('Each break must have both start and end in HH:MM (24-hour) format', 'error'); return;
      }
    }
    setRegSaving(true);
    try {
      await api.post('/api/attendance/regularize', regForm);
      showToast('Regularization request submitted');
      setShowRegModal(false);
      setRegForm({ date: '', requestedIn: '', requestedOut: '', requestedOutNotYet: false, requestedBreaks: [], reason: '' });
      loadRegRequests(regScope);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setRegSaving(false); }
  };

  const reviewRegularization = async (id, action) => {
    try {
      const result = await api.put('/api/attendance/regularize', { id, action });
      showToast('Request ' + action);
      loadRegRequests('approvals'); // always reload approvals after review
      // A reopened "still working" day affects the live record — refresh it so
      // tasks become endable and the Clock Out button reflects the new state.
      if (result?.date === today) loadTodayRecord();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleOverrideAction = async (attendanceId, action) => {
    try {
      await api.put('/api/attendance', { attendanceId, action });
      showToast(action === 'approve_override' ? 'Override approved' : 'Override rejected');
      loadTeamToday();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const clockedIn  = !!todayRecord?.clockIn;
  const clockedOut = !!todayRecord?.clockOut;
  const todayDetails = new Set((todayRecord?.workProgress || []).map(r => r.taskDetails));
  const pendingCarried = carriedTasks.filter(t => t && !todayDetails.has(t));
  const todayIncompleteTasks = [...new Set(
    (todayRecord?.workProgress || [])
      .filter(r => r.type === 'task' && r.status !== 'completed' && !r.carriedForward && !(r.startTime && !r.endTime) && r.taskDetails && String(r.taskDetails).trim())
      .map(r => String(r.taskDetails).trim())
  )];
  const todayStr = new Date().toLocaleDateString('en-CA');
  const breakRules = useMemo(() => (shiftConfig?.breaks?.length ? shiftConfig.breaks : DEFAULT_BREAK_RULES), [shiftConfig]);
  const activeRule = breakRules[breakRuleIdx] || breakRules[0];

  const breakInstances = useMemo(() => {
    const result = [];
    breakRules.forEach((rule, ruleIdx) => {
      const count = rule.maxCount || 1;
      const style = breakStyle(rule.type);
      for (let i = 0; i < count; i++) {
        result.push({
          key: `${ruleIdx}-${i}`,
          ruleIdx,
          type: rule.type,
          name: rule.name || '',
          label: rule.name || rule.type || 'Break',
          icon: style.icon,
          color: style.color,
          bgColor: style.bg,
          borderColor: style.borderColor,
          index: i,
        });
      }
    });
    return result;
  }, [breakRules]);

  const tabs = useMemo(() => ['today', 'team', 'regularize', ...(isAdmin ? ['progress'] : [])], [isAdmin]);
  const tabLabels = { today: 'Today', team: 'Team', regularize: 'Timing requests', progress: 'View Daily Progress' };

  const regBreakTypes = useMemo(
    () => [...new Set(regRequests.flatMap(r => (r.requestedBreaks || []).map(b => b.type).filter(Boolean)))],
    [regRequests]
  );

  // Break/Lunch UI helpers
  const renderBreakPanel = (rule, ruleIdx) => {
    const type      = rule.type;
    const label     = breakLabelForRule(rule);
    const style     = breakStyle(type);
    const allowance = getRuleAllowance(rule);
    const maxCount  = rule.maxCount ?? 1;
    const taken     = getRuleBreaks(rule, ruleIdx).length;
    const color     = style.color;
    const bgColor   = style.bg;
    const icon      = style.icon;
    const active    = activeBreakForRule(rule, ruleIdx);
    const totalMins = totalRuleMins(rule, ruleIdx);
    const over      = overMinsForRule(rule, ruleIdx);
    const history   = getRuleBreaks(rule, ruleIdx).filter(b => b.end);

    return (
      <div style={{ background: bgColor, border: `1px solid ${color}30`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`bi ${icon}`} style={{ color, fontSize: 15 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{label}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Allowance: {allowance} min · Taken: {taken}/{maxCount}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: over > 0 ? '#ef4444' : '#10b981' }}>
              {totalMins} / {allowance} min
            </div>
            {over > 0 && <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>−{over} min deducted</div>}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 6, borderRadius: 4, background: '#e2e8f0', marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 4, width: Math.min(100, (totalMins / allowance) * 100) + '%', background: over > 0 ? '#ef4444' : color, transition: 'width 0.3s' }} />
        </div>

        {/* Clock button */}
        {!clockedOut && (
          <button
            className="btn btn-sm w-100"
            disabled={breakLoading}
            onClick={() => handleBreakClock(rule, ruleIdx)}
            style={{ fontSize: 13, fontWeight: 600, background: active ? '#ef444415' : color + '15', color: active ? '#ef4444' : color, border: `1px solid ${active ? '#ef4444' : color}30` }}>
            {breakLoading
              ? <span className="spinner-border spinner-border-sm" />
              : active
                ? <><i className="bi bi-stop-circle me-2" />End {label} (started {formatTime(active.start)})</>
                : <><i className="bi bi-play-circle me-2" />Start {label}</>}
          </button>
        )}

        {/* History */}
        {history.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {history.map((b, i) => {
              const dur = diffMins(b.start, b.end);
              const exceeded = dur > allowance;
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: '#64748b', padding: '4px 0', borderBottom: i < history.length - 1 ? '1px solid #e2e8f033' : 'none' }}>
                  <span><Time value={b.start} fallback="—" /> → <Time value={b.end} fallback="—" /></span>
                  <span style={{ fontWeight: 700, color: exceeded ? '#ef4444' : '#10b981' }}>{dur} min{exceeded ? ` (${dur - allowance} over)` : ''}</span>
                </div>
              );
            })}
          </div>
        )}

        {active && (
          <div style={{ marginTop: 10, fontSize: 12, color, background: color + '10', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="spinner-grow spinner-grow-sm" style={{ width: 8, height: 8, background: color }} />
            {label} in progress since {formatTime(active.start)}
          </div>
        )}
      </div>
    );
  };

  const renderWorkProgressSheet = () => {
    const dbRows = getWorkProgress();
    const activeIdx = activeWorkIndex();
    const canEndTask = clockedIn && !clockedOut && !anyActiveBreak() && activeIdx !== -1 && dbRows[activeIdx]?.type === 'task';

    // Build virtual rows with dbIdx so edits point to the right array elements
    const rows = dbRows.map((row, dbIdx) => ({
      ...(row.toObject ? row.toObject() : row),
      dbIdx
    }));

    if (todayRecord?.clockIn) {
      rows.unshift({
        type: 'clock_in',
        taskDetails: 'Clocked In',
        startTime: todayRecord.clockIn,
        endTime: todayRecord.clockIn,
        status: 'completed',
        remarks: '',
        feedback: '',
        dbIdx: -1
      });
    }

    if (todayRecord?.clockOut) {
      rows.push({
        type: 'clock_out',
        taskDetails: 'Clocked Out',
        startTime: todayRecord.clockOut,
        endTime: todayRecord.clockOut,
        status: 'completed',
        remarks: '',
        feedback: '',
        dbIdx: -1
      });
    }

    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <i className="bi bi-list-check" style={{ color: '#2563eb', fontSize: 16 }} />
          <span style={{ fontWeight: 750, fontSize: 14.5 }}>Daily Work Progress Sheet</span>
          <span className="badge" style={{ 
            background: clockedOut ? '#fee2e2' : clockedIn ? '#dcfce7' : '#f1f5f9', 
            color: clockedOut ? '#dc2626' : clockedIn ? '#16a34a' : '#64748b',
            fontSize: '11px',
            fontWeight: 700,
            marginLeft: 8
          }}>
            {clockedOut ? 'Clocked Out' : clockedIn ? 'Clocked In' : 'Not Clocked In'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {clockedOut && (
              <button className="btn btn-sm btn-outline-success" style={{ fontSize: 12 }} onClick={downloadExcel}>
                <i className="bi bi-file-earmark-excel me-1" />Download Progress (Excel)
              </button>
            )}
            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 12 }} disabled={saveWorkLoading || !clockedIn} onClick={handleSaveWork}>
              {saveWorkLoading ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />Saving...</> : <><i className="bi bi-floppy me-1" />Save</>}
            </button>
            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 12 }} disabled={!canEndTask} onClick={endCurrentTask}>
              <i className="bi bi-check2-circle me-1" />End Current Task
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state"><i className="bi bi-list-task" /><p>Clock in to start today&apos;s first task</p></div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>S.no</th>
                  <th style={{ minWidth: 220 }}>Task Details</th>
                  <th style={{ width: 110 }}>Start Time</th>
                  <th style={{ width: 110 }}>End Time</th>
                  <th style={{ width: 90 }}>Duration</th>
                  <th style={{ minWidth: 160 }}>Status</th>
                  <th style={{ minWidth: 190 }}>Remarks</th>
                  <th style={{ minWidth: 190 }}>Feedback</th>
                  <th style={{ width: 80 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isVirtual = row.type === 'clock_in' || row.type === 'clock_out';
                  const isBreakRow = !isVirtual && isBreakType(row.type);
                  const active = row.startTime && !row.endTime;
                  return (
                    <tr key={idx} style={{ background: isBreakRow ? '#f8fafc' : isVirtual ? '#f1f5f9' : 'transparent' }}>
                      <td style={{ fontSize: 13, fontWeight: 700 }}>{idx + 1}</td>
                      <td>
                        {isVirtual ? (
                          row.type === 'clock_in' ? (
                            <span className="badge" style={{ background: '#dcfce7', color: '#16a34a', fontSize: '11.5px', fontWeight: 700 }}>
                              <i className="bi bi-box-arrow-in-right me-1" />Clocked In
                            </span>
                          ) : (
                            <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: '11.5px', fontWeight: 700 }}>
                              <i className="bi bi-box-arrow-right me-1" />Clocked Out
                            </span>
                          )
                        ) : isBreakRow ? (
                          <span className="badge" style={{ background: breakStyle(row.type).bg, color: breakStyle(row.type).color }}>
                            <i className={`bi ${breakStyle(row.type).icon} me-1`} />{row.taskDetails || breakLabel(row.type)}
                          </span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                            <textarea
                              className="form-control hide-scrollbar"
                              rows={2}
                              placeholder={active ? 'Enter current task details' : 'Task details'}
                              value={row.taskDetails || ''}
                              onChange={e => updateWorkRow(row.dbIdx, { taskDetails: e.target.value })}
                              onBlur={() => saveWorkProgress()}
                              style={{ fontSize: 12, minWidth: 210 }}
                            />
                            {active && clockedIn && (availableTasks.length > 0 || pendingCarried.length > 0 || todayIncompleteTasks.length > 0) && (
                              <span ref={taskPickerRef} style={{ position: 'relative', flexShrink: 0 }}>
                                {pendingCarried.length > 0 && (
                                  <span
                                    title={`${pendingCarried.length} incomplete task(s) carried forward`}
                                    style={{
                                      position: 'absolute', top: -3, right: -3, width: 8, height: 8,
                                      borderRadius: '50%', background: '#ef4444', border: '1.5px solid #fff',
                                      zIndex: 2,
                                    }}
                                  />
                                )}
                                <button
                                  className="btn btn-outline-primary"
                                  style={{ padding: '0 4px', fontSize: 11, lineHeight: '18px', borderRadius: 3, minWidth: 22, height: 22 }}
                                  onClick={(e) => { e.stopPropagation(); setShowTaskPicker(p => !p); }}
                                  title="Select from assigned tasks"
                                >
                                  <i className="bi bi-plus" style={{ fontSize: 12 }} />
                                </button>
                                {showTaskPicker && (
                                  <div style={{
                                    position: 'absolute', top: '100%', left: 0, zIndex: 1050,
                                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 280,
                                    maxHeight: 260, overflowY: 'auto', marginTop: 4,
                                  }}>
                                    <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>
                                      Select a task
                                    </div>
                                    {pendingCarried.map((t, i) => (
                                      <div
                                        key={'carried-' + i}
                                        onClick={() => selectTask({ title: t })}
                                        style={{
                                          padding: '10px 12px', cursor: 'pointer', fontSize: 12,
                                          borderBottom: '1px solid #f8fafc', transition: 'background 0.1s',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                      >
                                        <div style={{ fontWeight: 600, color: '#1e293b' }}>
                                          {t}
                                          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#ef4444', verticalAlign: 'middle' }}>
                                            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#ef4444', marginRight: 3 }} />
                                            Carried
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                    {todayIncompleteTasks.length > 0 && (
                                      <>
                                        <div style={{ padding: '6px 12px', fontSize: 10, fontWeight: 700, color: '#94a3b8', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                                          Today's incomplete tasks
                                        </div>
                                        {todayIncompleteTasks.map((t, i) => (
                                          <div
                                            key={'today-' + i}
                                            onClick={() => selectTask({ title: t })}
                                            style={{
                                              padding: '10px 12px', cursor: 'pointer', fontSize: 12,
                                              borderBottom: '1px solid #f8fafc', transition: 'background 0.1s',
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                          >
                                            <div style={{ fontWeight: 600, color: '#1e293b' }}>{t}</div>
                                          </div>
                                        ))}
                                      </>
                                    )}
                                    {availableTasks.map(task => (
                                      <div
                                        key={task._id}
                                        onClick={() => selectTask(task)}
                                        style={{
                                          padding: '10px 12px', cursor: 'pointer', fontSize: 12,
                                          borderBottom: '1px solid #f8fafc', transition: 'background 0.1s',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                      >
                                        <div style={{ fontWeight: 600, color: '#1e293b' }}>
                                          {task.projectId?.name && <span style={{ color: '#3b82f6' }}>[{task.projectId.name}] </span>}
                                          {task.title}
                                        </div>
                                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                                          <span className="badge" style={{
                                            background: task.priority === 'high' ? '#fee2e2' : task.priority === 'medium' ? '#fef3c7' : '#f1f5f9',
                                            color: task.priority === 'high' ? '#dc2626' : task.priority === 'medium' ? '#d97706' : '#64748b',
                                            fontSize: 9,
                                          }}>{task.priority}</span>
                                          <span className="badge" style={{
                                            background: task.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
                                            color: task.status === 'In Progress' ? '#2563eb' : '#64748b',
                                            fontSize: 9,
                                          }}>{task.status}</span>
                                          {task.due && <span style={{ fontSize: 10, color: '#94a3b8' }}>Due: {formatDate(task.due)}</span>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}><Time value={row.startTime} fallback="--:--" /></td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}><Time value={row.endTime} fallback={active ? 'Running' : '--:--'} /></td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{isVirtual ? '—' : formatTaskDuration(row)}</td>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={row.carriedForward ? 'pending' : (row.status || (active ? 'work_in_progress' : 'pending'))}
                          disabled={isBreakRow || isVirtual}
                          onChange={e => commitWorkRow(row.dbIdx, { status: e.target.value })}
                          style={{ fontSize: 12 }}>
                          {isVirtual ? <option value="completed">Completed</option> : WORK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      <td>
                        {isVirtual ? null : (
                          <textarea
                            className="form-control hide-scrollbar"
                            rows={2}
                            placeholder="Remarks"
                            value={row.remarks || ''}
                            onChange={e => updateWorkRow(row.dbIdx, { remarks: e.target.value })}
                            onBlur={() => saveWorkProgress()}
                            style={{ fontSize: 12 }}
                          />
                        )}
                      </td>
                      <td>
                        {isVirtual ? null : (
                          <>
                            {renderCompletionMeta(row)}
                            <textarea
                              className="form-control hide-scrollbar"
                              rows={2}
                              placeholder="Feedback"
                              value={row.feedback || ''}
                              onChange={e => updateWorkRow(row.dbIdx, { feedback: e.target.value })}
                              onBlur={() => saveWorkProgress()}
                              style={{ fontSize: 12 }}
                            />
                          </>
                        )}
                      </td>
                      <td>
                        {isVirtual ? null : isBreakRow ? null : (
                          row.dbIdx === 0 && row.type === 'task' ? (
                            <i className="bi bi-lock-fill" style={{ color: '#94a3b8', fontSize: 14 }} title="First task cannot be deleted" />
                          ) : deleteConfirmIdx === row.dbIdx ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {row.startTime && !row.endTime && (
                                <span style={{ fontSize: 10, color: '#ef4444', marginBottom: 2 }}>Previous task will resume</span>
                              )}
                              <span style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Delete?</span>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => deleteWorkRow(row.dbIdx)}>Yes</button>
                                <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setDeleteConfirmIdx(null)}>No</button>
                              </div>
                            </div>
                          ) : (
                            <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => setDeleteConfirmIdx(row.dbIdx)} title="Delete task">
                              <i className="bi bi-trash" />
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <AppShell title="Attendance">
      {toastQueue.length > 0 && (
        <div className="toast-container-custom" role="alert" aria-live="polite">
          {toastQueue.map(t => (
            <div key={t.id} className={'toast-custom ' + t.type}>
              <i className={'bi ' + (t.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle')} /> {t.msg}
            </div>
          ))}
        </div>
      )}

      {clockLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(15, 23, 42, 0.55)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }} onClick={e => e.stopPropagation()}>
          <div className="spinner-border" role="status" style={{ width: 48, height: 48, borderWidth: 4, color: '#fff' }} />
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>
            {clockAction === 'out' ? 'Clocking out...' : 'Clocking in...'}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div className="spinner-border text-primary" />
        </div>
      ) : (
        <>
      <div className="page-header">
        <div>
          <h4>Time & Attendance{shiftConfig ? <span className="badge bg-secondary ms-2" style={{ fontSize: 11, fontWeight: 400, verticalAlign: 'middle' }}>{shiftConfig.name} (<Time value={shiftConfig.startTime} fallback="?" />-<Time value={shiftConfig.endTime} fallback="?" />)</span> : ''}</h4>
          <p>{isSuperAdmin ? 'Team-wide attendance overview' : 'Track daily attendance, shifts, and working hours'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isSuperAdmin && (
            <>
              {!clockedIn && !clockedOut && (
                <button className="btn btn-success" onClick={() => handleClockButton('in')} disabled={clockLoading || !shiftsLoaded}>
                  {clockLoading ? <><span className="spinner-border spinner-border-sm me-2" />Clocking in...</> : !shiftsLoaded ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-play-circle me-2" />}Clock In
                </button>
              )}
              {clockedIn && !clockedOut && (
                <button className="btn btn-danger" onClick={() => handleClockButton('out')} disabled={clockLoading || !shiftsLoaded}>
                  {clockLoading ? <><span className="spinner-border spinner-border-sm me-2" />Clocking out...</> : !shiftsLoaded ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-stop-circle me-2" />}Clock Out
                </button>
              )}
              {clockedIn && clockedOut && (
                <>
                  <span className="badge bg-success d-flex align-items-center px-3" style={{ fontSize: 13 }}>
                    <i className="bi bi-check-circle me-2" />Attendance Complete
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 4, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'max-content', minWidth: '100%' }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', fontWeight: 600,
              fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#1e293b' : '#64748b',
              boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}>
              {tabLabels[t]}
            </button>
          ))}
        </div>
      </div>

      {/* TODAY TAB */}
      {tab === 'today' && (
        <>
          {isSuperAdmin ? (
            // Super Admin: Team overview stats
            <>
              <div className="row g-3 mb-4">
                {[
                  { label: 'Present', value: teamToday.filter(r => r.status === 'present').length, icon: 'bi-person-check', color: '#10b981' },
                  { label: 'Absent', value: teamToday.filter(r => r.status === 'absent').length, icon: 'bi-person-x', color: '#ef4444' },
                  { label: 'On Leave', value: teamToday.filter(r => r.status === 'leave').length, icon: 'bi-person-dash', color: '#3b82f6' },
                  { label: 'Late', value: teamToday.filter(r => r.status === 'late').length, icon: 'bi-clock', color: '#f59e0b' },
                  { label: 'Half Day', value: teamToday.filter(r => r.status === 'half_day').length, icon: 'bi-sun', color: '#ea580c' },
                  { label: 'Short Hours', value: teamToday.filter(r => r.shortHours).length, icon: 'bi-hourglass-split', color: '#7c3aed' },
                ].map((s, i) => (
                  <div key={i} className="col-6 col-xl">
                    <div className="stat-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                          <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                        </div>
                        <div className="stat-icon" style={{ background: s.color + '15', flexShrink: 0 }}>
                          <i className={'bi ' + s.icon} style={{ color: s.color }} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <i className="bi bi-people" style={{ color: '#3b82f6', fontSize: 15 }} />
                  <span style={{ fontWeight: 750, fontSize: 14.5 }}>Today's Attendance — {formatDate(today)}</span>
                  <span className="badge" style={{ background: '#eff6ff', color: '#2563eb', fontSize: 11, marginLeft: 'auto' }}>{teamToday.length} employees</span>
                </div>
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Flag</th></tr></thead>
                    <tbody>
                      {teamToday.slice((todayPage - 1) * pageSize, todayPage * pageSize).map(row => {
                        const s = STATUS_STYLE[row.status] || STATUS_STYLE.present;
                        const hasClockOut = !!row.clockOut;
                        return (
                          <tr key={row._id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                                  {row.userId?.avatar || (row.userId?.name || '?').slice(0, 2).toUpperCase()}
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{row.userId?.name || '—'}</span>
                              </div>
                            </td>
                            <td style={{ fontSize: 13, color: '#64748b' }}>{row.userId?.department || '—'}</td>
                            <td>
                              {hasClockOut ? (
                                <span className="badge" style={{ background: '#f1f5f9', color: '#64748b', fontSize: 11 }}>
                                  <i className="bi bi-box-arrow-right me-1" />Logged Out
                                </span>
                              ) : (
                                <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                              )}
                            </td>
                            <td style={{ fontSize: 13 }}><Time value={row.clockIn} fallback="—" /></td>
                            <td style={{ fontSize: 13 }}><Time value={row.clockOut} fallback="—" /></td>
                            <td style={{ fontSize: 13 }}>{row.hoursWorked ? formatMins(row.hoursWorked) : '—'}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {row.lateFlag && <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}><i className="bi bi-exclamation-triangle me-1" />Late</span>}
                                {row.shortHours && <span className="badge" style={{ background: '#f3e8ff', color: '#7c3aed', fontSize: 10 }}><i className="bi bi-hourglass-split me-1" />Short Hours</span>}
                                {row.approvedHalfDayLeave && <span className="badge" style={{ background: '#dbeafe', color: '#2563eb', fontSize: 10 }}>Present + Half-day Leave</span>}
                                {row.autoLoggedOut && <span className="badge" style={{ background: '#fffbeb', color: '#d97706', fontSize: 10 }}><i className="bi bi-clock-history me-1" />Auto Logout</span>}
                                {row.leaveOverride?.status === 'pending' && (
                                  <span className="badge bg-warning text-dark" style={{ fontSize: 11 }}>Pending Review</span>
                                )}
                              </div>
                              {row.leaveOverride?.status === 'pending' && isAdmin && (
                                <div className="mt-1">
                                  <button className="btn btn-sm btn-success me-1" style={{ fontSize: 11 }}
                                    onClick={() => handleOverrideAction(row._id, 'approve_override')}>
                                    <i className="bi bi-check-lg" />
                                  </button>
                                  <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }}
                                    onClick={() => handleOverrideAction(row._id, 'reject_override')}>
                                    <i className="bi bi-x-lg" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {teamToday.length > 0 && (
                  <Pagination
                    currentPage={todayPage}
                    totalPages={Math.ceil(teamToday.length / pageSize)}
                    onPageChange={setTodayPage}
                    totalItems={teamToday.length}
                    pageSize={pageSize}
                  />
                )}
              </div>
            </>
          ) : (
            // Regular user: personal attendance
            <div className="row g-3">
              <div className={clockedIn ? 'col-lg-6' : 'col-12'}>
                <div className="card p-3 p-md-4">
                  {todayRecord ? (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Today — {formatDate(today)}</div>
                      <div className="row g-3">
                        {[
                          ['Status',    <span key="st" className="badge" style={{ background: STATUS_STYLE[todayRecord.status]?.bg, color: STATUS_STYLE[todayRecord.status]?.color }}>{STATUS_STYLE[todayRecord.status]?.label || todayRecord.status}</span>],
                          ['Clock In',  formatTime(todayRecord.clockIn)  || '—'],
                          ['Clock Out', formatTime(todayRecord.clockOut) || '—'],
                          ['Hours',     todayRecord.hoursWorked ? formatMins(todayRecord.hoursWorked) : '—'],
                        ].map(([label, val]) => (
                          <div key={label} className="col-6 col-md-3">
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{val}</div>
                          </div>
                        ))}
                      </div>
                      {todayRecord?.earlyLogin && (
                        <span className="badge bg-info ms-2" style={{ fontSize: 11 }}>
                          <i className="bi bi-clock-history me-1" />Early Logged In
                        </span>
                      )}
                      {clockedIn && !clockedOut && shiftConfig?.endTime && (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
                          <i className="bi bi-clock me-1" />
                          Expected clock-out by <strong>{formatTime(shiftConfig.endTime)}</strong>
                        </div>
                      )}
                      {(todayRecord.breakDeduction > 0) && (
                        <div style={{ marginTop: 14, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#dc2626' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <i className="bi bi-dash-circle" />
                            <span><strong>{todayRecord.breakDeduction} min</strong> deducted from working hours (excess break/lunch time)</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#ef4444', marginLeft: 22 }}>
                            {(() => {
                              const ded = todayRecord.deductionBreakdown || {};
                              const parts = [];
                              if (ded.breakDeduction) parts.push(`Break: ${ded.breakDeduction}m`);
                              if (ded.lunchDeduction) parts.push(`Lunch: ${ded.lunchDeduction}m`);
                              return parts.length ? parts.join(' | ') : '';
                            })()}
                          </div>
                        </div>
                      )}
                      {todayRecord.lateFlag && (
                        <div className="alert alert-warning mt-3 py-2" style={{ fontSize: 13 }}>
                          <i className="bi bi-exclamation-triangle me-2" />Late login detected
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state">
                      {staleOpenSession && (
                        <div className="alert alert-warning" style={{ fontSize: 13, width: '100%' }}>
                          <i className="bi bi-exclamation-triangle me-2" />
                          You have an active session from {staleOpenSession.date} at {formatTime(staleOpenSession.clockIn)}. Clocking in will close it automatically.
                        </div>
                      )}
                      <i className="bi bi-clock" />
                      <h6>No attendance record for today</h6>
                      <p>Click &quot;Clock In&quot; to mark your attendance</p>
                    </div>
                  )}
                </div>
              </div>
              {/* Mobile-optimized clock widget */}
              <div className="d-md-none" style={{ marginTop: 12 }}>
                <div className="card p-3" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#1e293b', marginBottom: 4 }}>
                    {formatTime(nowTimeStr(), settings?.timeFormat || '24h')}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                    {todayRecord?.clockIn ? `Clocked in at ${formatTime(todayRecord.clockIn)}` : 'Not clocked in yet'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    {!clockedIn && (
                      <button className="btn btn-success btn-lg" style={{ flex: 1, borderRadius: 12, fontWeight: 700, fontSize: 16 }} onClick={() => handleClockButton('in')} disabled={clockLoading || !shiftsLoaded}>
                        {clockLoading ? <><span className="spinner-border spinner-border-sm me-2" />Clocking in...</> : <><i className="bi bi-play-circle me-2" />Clock In</>}
                      </button>
                    )}
                    {clockedIn && !clockedOut && (
                      <button className="btn btn-danger btn-lg" style={{ flex: 1, borderRadius: 12, fontWeight: 700, fontSize: 16 }} onClick={() => handleClockButton('out')} disabled={clockLoading || !shiftsLoaded}>
                        {clockLoading ? <><span className="spinner-border spinner-border-sm me-2" />Clocking out...</> : <><i className="bi bi-stop-circle me-2" />Clock Out</>}
                      </button>
                    )}
                    {clockedIn && clockedOut && (
                      <div className="py-2">
                        <i className="bi bi-check-circle text-success" style={{ fontSize: 24 }} />
                        <div style={{ fontSize: 13, color: '#10b981', fontWeight: 600, marginTop: 4 }}>Complete</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {clockedIn && (
                <div className="col-lg-6">
                  <div className="card" style={{ borderRadius: 14, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      {breakRules.map((rule, idx) => {
                        const style = breakStyle(rule.type);
                        const sameTypeCount = breakRules.filter(b => b.type === rule.type).length;
                        const key = rule.type + '-' + idx;
                        const label = (rule.name || rule.type || 'Break') + (sameTypeCount > 1 ? ` #${idx + 1}` : '');
                        return (
                           <button key={key} onClick={() => setBreakRuleIdx(idx)}
                          style={{
                            flex: 1, padding: '12px 8px', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                            background: 'transparent',
                            color: breakRuleIdx === idx ? style.color : '#94a3b8',
                            borderBottom: breakRuleIdx === idx ? `3px solid ${style.color}` : '3px solid transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            transition: 'all 0.15s',
                          }}>
                          <i className={`bi ${style.icon}`} style={{ fontSize: 14 }} />{label}
                          {overMinsForRule(rule, idx) > 0 && (
                            <span style={{ fontSize: 10, background: '#fef2f2', color: '#ef4444', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                              −{overMinsForRule(rule, idx)}m
                            </span>
                          )}
                        </button>
                      );
                    })}
                    </div>
                    <div style={{ padding: 16 }}>
                      {renderBreakPanel(activeRule, breakRuleIdx)}
                    </div>
                  </div>
                </div>
              )}
              <div className="col-12">
                {renderWorkProgressSheet()}
              </div>
            </div>
          )}
        </>
      )}

      {/* TEAM TAB — unified monthly view for all roles */}
      {tab === 'team' && (
        <div>
          {/* Employee selector (only for admins; non-admins see their own data) */}
          {isAdmin ? (
            <div className="mb-3">
              <select className="form-select" style={{ fontSize: 13, maxWidth: 300 }} value={showAllEmployees ? 'all' : selectedUserId} onChange={e => { const val = e.target.value; if (val === 'all') { setShowAllEmployees(true); setSelectedUserId(''); } else if (val === '') { setShowAllEmployees(false); setSelectedUserId(''); } else { setShowAllEmployees(false); setSelectedUserId(val); setTeamMonth(month); setTeamFromDate(''); setTeamToDate(''); } }}>
                <option value="">— Select Employee —</option>
                <option value="all">All Employees</option>
                {employees.filter(e => e.role !== 'super_admin').map(e => <option key={e.userId} value={e.userId}>{e.name} ({e.department || 'No Dept'})</option>)}
              </select>
            </div>
          ) : null}

          {/* Filters row */}
          <div className="card mb-3" style={{ borderRadius: 12 }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className="bi bi-funnel" style={{ color: '#3b82f6', fontSize: 14 }} />
              <span style={{ fontWeight: 750, fontSize: 13.5 }}>Filters</span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              <div className="row g-2 align-items-end">
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>Month</label>
                  <input type="month" className="form-control" style={{ fontSize: 13 }} value={teamMonth} onChange={e => { setTeamMonth(e.target.value); setTeamFromDate(''); setTeamToDate(''); }} />
                </div>
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>From Date</label>
                   <DateInput className="form-control" style={{ fontSize: 13 }} value={teamFromDate} onChange={e => setTeamFromDate(e.target.value)} max={teamToDate || undefined} />
                </div>
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>To Date</label>
                   <DateInput className="form-control" style={{ fontSize: 13 }} value={teamToDate} onChange={e => setTeamToDate(e.target.value)} min={teamFromDate || undefined} />
                </div>
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>&nbsp;</label>
                  <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={() => { setTeamMonth(month); setTeamFromDate(''); setTeamToDate(''); setShowAllEmployees(false); setSelectedUserId(''); }}>
                    <i className="bi bi-arrow-counterclockwise me-1" />Reset
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* All Employees list panel */}
          {isAdmin && showAllEmployees && !selectedUserId && (
            <div className="card mb-3" style={{ borderRadius: 12 }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <i className="bi bi-people" style={{ color: '#3b82f6', fontSize: 14 }} />
                  <span style={{ fontWeight: 750, fontSize: 13.5 }}>All Employees ({employees.filter(e => e.role !== 'super_admin').length})</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>Click an employee to view their attendance</span>
                  <div className="dropdown">
                    <button className="btn btn-sm btn-outline-success dropdown-toggle" style={{ fontSize: 12 }} disabled={downloadLoading} data-bs-toggle="dropdown">
                      {downloadLoading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-download me-1" />}
                      Download
                    </button>
                    <ul className="dropdown-menu dropdown-menu-end" style={{ fontSize: 13 }}>
                      <li><button className="dropdown-item" onClick={() => handleDownload('excel')}><i className="bi bi-file-earmark-excel me-2 text-success" />Excel (.xlsx)</button></li>
                      <li><button className="dropdown-item" onClick={() => handleDownload('pdf')}><i className="bi bi-file-earmark-pdf me-2 text-danger" />PDF (.pdf)</button></li>
                    </ul>
                  </div>
                </div>
              </div>
              <div style={{ padding: '12px 18px' }}>
                <div className="row g-2">
                  {employees.filter(e => e.role !== 'super_admin').map(emp => (
                    <div key={emp.userId} className="col-6 col-md-4 col-lg-3">
                      <div
                        className="card"
                        style={{
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          border: '1px solid #e2e8f0',
                          borderRadius: 10,
                          padding: '10px 12px',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(59,130,246,0.15)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
                        onClick={() => { setSelectedUserId(emp.userId); setShowAllEmployees(false); }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                            {emp.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                            <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.department || 'No Dept'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Data */}
          {(() => {
            const uid = isAdmin ? selectedUserId : user?._id;
            if (!uid) {
              if (showAllEmployees && isAdmin) return null;
              return (
                <div className="card"><div className="empty-state"><i className="bi bi-person" /><p>Select an employee to view attendance</p></div></div>
              );
            }

            // Build date filter query params
            let query = `?scope=team&userId=${uid}&month=${teamMonth}`;
            if (teamFromDate) query += `&fromDate=${teamFromDate}`;
            if (teamToDate) query += `&toDate=${teamToDate}`;

            return (
              <>
                {isAdmin && selectedUserId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                    <button
                      className="btn btn-link btn-sm p-0"
                      style={{ fontSize: 13, textDecoration: 'none' }}
                      onClick={() => { setSelectedUserId(''); setShowAllEmployees(true); }}
                    >
                      <i className="bi bi-arrow-left me-1" />Back to All Employees
                    </button>
                    <div className="dropdown">
                      <button className="btn btn-sm btn-outline-success dropdown-toggle" style={{ fontSize: 12 }} disabled={downloadLoading} data-bs-toggle="dropdown">
                        {downloadLoading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-download me-1" />}
                        Download
                      </button>
                      <ul className="dropdown-menu" style={{ fontSize: 13 }}>
                        <li><button className="dropdown-item" onClick={() => handleDownload('excel')}><i className="bi bi-file-earmark-excel me-2 text-success" />Excel (.xlsx)</button></li>
                        <li><button className="dropdown-item" onClick={() => handleDownload('pdf')}><i className="bi bi-file-earmark-pdf me-2 text-danger" />PDF (.pdf)</button></li>
                      </ul>
                    </div>
                  </div>
                )}
                {!isAdmin && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <div className="dropdown">
                      <button className="btn btn-sm btn-outline-success dropdown-toggle" style={{ fontSize: 12 }} disabled={downloadLoading} data-bs-toggle="dropdown">
                        {downloadLoading ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-download me-1" />}
                        Download
                      </button>
                      <ul className="dropdown-menu dropdown-menu-end" style={{ fontSize: 13 }}>
                        <li><button className="dropdown-item" onClick={() => handleDownload('excel')}><i className="bi bi-file-earmark-excel me-2 text-success" />Excel (.xlsx)</button></li>
                        <li><button className="dropdown-item" onClick={() => handleDownload('pdf')}><i className="bi bi-file-earmark-pdf me-2 text-danger" />PDF (.pdf)</button></li>
                      </ul>
                    </div>
                  </div>
                )}
                <TeamAttendanceView
                  query={query}
                  uid={uid}
                  month={teamMonth}
                  formatDate={formatDate}
                  formatMins={formatMins}
                  STATUS_STYLE={STATUS_STYLE}
                  DAYS={DAYS}
                  isAdmin={isAdmin}
                  handleOverrideAction={handleOverrideAction}
                />
              </>
            );
          })()}
        </div>
      )}

      {/* REGULARIZE TAB */}
      {tab === 'regularize' && (
        <>
          {canReview ? (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              {!isSuperAdmin && (
                <div onClick={() => { setRegScope('my'); loadRegRequests('my'); }} style={{
                  flex: 1, padding: '12px 16px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                  background: regScope === 'my' ? '#f0f4ff' : '#f8fafc',
                  border: regScope === 'my' ? '1.5px solid #3b82f6' : '1.5px solid #e2e8f0',
                  boxShadow: regScope === 'my' ? '0 1px 6px rgba(59,130,246,0.1)' : 'none',
                }}>
                  <div style={{ fontSize: 12, color: regScope === 'my' ? '#3b82f6' : '#64748b', fontWeight: 600, marginBottom: 2 }}>
                    <i className="bi bi-person me-1" />My Requests
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>
                    {regRequests.filter(r => r.userId?._id?.toString() === user?._id?.toString()).length}
                  </div>
                </div>
              )}
              <div onClick={() => { setRegScope('approvals'); loadRegRequests('approvals'); }} style={{
                flex: 1, padding: '12px 16px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                background: regScope === 'approvals' ? '#fffbeb' : '#f8fafc',
                border: regScope === 'approvals' ? '1.5px solid #d97706' : '1.5px solid #e2e8f0',
                boxShadow: regScope === 'approvals' ? '0 1px 6px rgba(217,119,6,0.1)' : 'none',
              }}>
                <div style={{ fontSize: 12, color: regScope === 'approvals' ? '#d97706' : '#64748b', fontWeight: 600, marginBottom: 2 }}>
                  <i className="bi bi-inbox me-1" />Pending Approvals
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>
                  {regRequests.filter(r => r.status === 'pending').length}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>My Regularization Requests</div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {user?.role !== 'super_admin' && (
              <button className="btn btn-primary btn-sm" onClick={() => { setRegForm(p => ({ ...p, date: today })); setShowRegModal(true); }}>
                <i className="bi bi-plus-lg me-1" />New Request
              </button>
            )}
            <Link href="/attendance/regularization-history" className="btn btn-outline-secondary btn-sm">
              <i className="bi bi-clock-history me-1" />History
            </Link>
          </div>
          {regRequests.length === 0 ? (
            <div className="card"><div className="empty-state"><i className="bi bi-clock-history" /><p>No regularization requests</p></div></div>
          ) : (
            <>
              <div className="card d-none d-md-block">
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        {canReview && <th>Employee</th>}
                        <th>Date</th><th>Req. In</th><th>Req. Out</th>
                        {regBreakTypes.map(type => <th key={type}>Req. {type}</th>)}
                        <th>Reason</th><th>Status</th>
                        {canReview && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {regRequests.slice((regPage - 1) * pageSize, regPage * pageSize).map(r => (
                        <tr key={r._id}>
                          {canReview && (
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{r.userId?.avatar}</div>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</span>
                              </div>
                            </td>
                          )}
                          <td style={{ fontSize: 13 }}>{formatDate(r.date)}</td>
                          <td style={{ fontSize: 13 }}>{formatTime(r.requestedIn)  || '—'}</td>
                          <td style={{ fontSize: 13 }}>{r.requestedOutNotYet ? 'Not yet' : (formatTime(r.requestedOut) || '—')}</td>
                          {regBreakTypes.map(type => (
                            <td key={type} style={{ fontSize: 13 }}>
                              {(() => {
                                const typeBreaks = (r.requestedBreaks || []).filter(b => b.type === type);
                                if (typeBreaks.length === 0) return '—';
                                return typeBreaks.map((b, i) => {
                                  if (b.notYet) return <span key={i} style={{ color: breakStyle(type).color, fontStyle: 'italic' }}>Not yet</span>;
                                  return `${formatTime(b.start) || '—'} → ${formatTime(b.end) || '—'}`;
                                }).reduce((acc, el, i) => i === 0 ? [el] : [...acc, ', ', el], []);
                              })()}
                            </td>
                          ))}
                          <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160 }}>{r.reason}</td>
                          <td>
                            <span className="badge" style={{ background: STATUS_STYLE[r.status]?.bg, color: STATUS_STYLE[r.status]?.color, fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <i className={`bi ${r.status === 'pending' ? 'bi-clock' : r.status === 'approved' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} />
                              {r.status}
                            </span>
                          </td>
                          {canReview && regScope === 'approvals' && (
                            <td>
                              {r.status === 'pending' && (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => reviewRegularization(r._id, 'approved')}>Approve</button>
                                  <button className="btn btn-sm btn-danger"  style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => reviewRegularization(r._id, 'rejected')}>Reject</button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="d-md-none" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {regRequests.slice((regPage - 1) * pageSize, regPage * pageSize).map(r => (
                  <div key={r._id} className="card p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        {canReview && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{r.userId?.name}</div>}
                        <div style={{ fontSize: 13, color: '#64748b' }}>{formatDate(r.date)}</div>
                      </div>
                      <span className="badge" style={{ background: STATUS_STYLE[r.status]?.bg, color: STATUS_STYLE[r.status]?.color, fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <i className={`bi ${r.status === 'pending' ? 'bi-clock' : r.status === 'approved' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} />
                        {r.status}
                      </span>
                    </div>
                    <div className="row g-2 mb-2">
                      <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. In</div><div style={{ fontSize: 13, fontWeight: 600 }}>{formatTime(r.requestedIn) || '—'}</div></div>
                      <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. Out</div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.requestedOutNotYet ? 'Not yet' : (formatTime(r.requestedOut) || '—')}</div></div>
                      {regBreakTypes.map(type => (
                        <div className="col-6" key={type}><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. {type}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{(() => { const tb = (r.requestedBreaks || []).filter(b => b.type === type); if (tb.length === 0) return '—'; return tb.map(b => b.notYet ? <span key={b.idx ?? 0} style={{ color: breakStyle(type).color, fontStyle: 'italic' }}>Not yet</span> : `${formatTime(b.start) || '—'} → ${formatTime(b.end) || '—'}`).reduce((acc, el, i) => i === 0 ? [el] : [...acc, ', ', el], []); })()}</div></div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: canReview && r.status === 'pending' ? 10 : 0 }}>{r.reason}</div>
                    {canReview && regScope === 'approvals' && r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-success flex-fill" onClick={() => reviewRegularization(r._id, 'approved')}>Approve</button>
                        <button className="btn btn-sm btn-danger  flex-fill" onClick={() => reviewRegularization(r._id, 'rejected')}>Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {regRequests.length > 0 && (
                <Pagination
                  currentPage={regPage}
                  totalPages={Math.ceil(regRequests.length / pageSize)}
                  onPageChange={setRegPage}
                  totalItems={regRequests.length}
                  pageSize={pageSize}
                />
              )}
            </>
          )}
          {showRegModal && (
            <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 520 }}>
                <div className="modal-content" style={{ border: 'none', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>
                        <i className="bi bi-pencil-square" />
                      </div>
                      <div>
                        <h5 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Regularization Request</h5>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>Update your attendance for a past date</div>
                      </div>
                    </div>
                    <button className="btn-close" onClick={() => setShowRegModal(false)} />
                  </div>
                  <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <i className="bi bi-calendar" style={{ color: '#3b82f6', fontSize: 14 }} />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>Date</span>
                      </div>
                      <DateInput className="form-control" value={regForm.date} max={todayStr} onChange={e => setRegForm(p => ({ ...p, date: e.target.value }))} />
                    </div>
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <i className="bi bi-clock" style={{ color: '#3b82f6', fontSize: 14 }} />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>Timing</span>
                      </div>
                      <div className="row g-2">
                        <div className="col-6">
                          <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4, display: 'block' }}>Actual Clock In</label>
                          <input type="time" className="form-control" style={{ fontSize: 13 }} value={regForm.requestedIn} onChange={e => setRegForm(p => ({ ...p, requestedIn: e.target.value }))} />
                        </div>
                        <div className="col-6">
                          <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4, display: 'block' }}>Actual Clock Out</label>
                          <input type="time" className="form-control" style={{ fontSize: 13 }} value={regForm.requestedOut} onChange={e => setRegForm(p => ({ ...p, requestedOut: e.target.value }))} disabled={regForm.requestedOutNotYet} />
                          {regForm.date === today && (
                            <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#64748b', marginTop: 6 }}>
                              <input type="checkbox" checked={regForm.requestedOutNotYet}
                                onChange={e => setRegForm(p => ({ ...p, requestedOutNotYet: e.target.checked, requestedOut: e.target.checked ? '' : p.requestedOut }))} />
                              I'm still working — remove my clock-out
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                    {breakInstances.map(bi => {
                      const entryIndex = regForm.requestedBreaks.findIndex(rb => rb.ruleIdx === bi.ruleIdx && rb.idx === bi.index);
                      const entry = entryIndex !== -1 ? regForm.requestedBreaks[entryIndex] : null;

                      const updateBreak = (field, value) => {
                        setRegForm(prev => {
                          const breaks = [...(prev.requestedBreaks || [])];
                          const idx = breaks.findIndex(rb => rb.ruleIdx === bi.ruleIdx && rb.idx === bi.index);
                          const updated = { ...(breaks[idx] || { type: bi.type, name: bi.name, ruleIdx: bi.ruleIdx, idx: bi.index }), [field]: value };
                          if (idx !== -1) breaks[idx] = updated;
                          else breaks.push(updated);
                          return { ...prev, requestedBreaks: breaks };
                        });
                      };

                      const getVal = (field) => {
                        if (entry) return entry[field] || '';
                        return '';
                      };

                      const notYet = getVal('notYet') === true;

                      return (
                        <div key={bi.key} style={{ background: bi.bgColor, borderRadius: 12, padding: 16, border: `1px solid ${bi.borderColor}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                            <i className={`bi ${bi.icon}`} style={{ color: bi.color, fontSize: 14 }} />
                            <span style={{ fontSize: 13, fontWeight: 700 }}>{bi.label}{breakInstances.filter(b => b.ruleIdx === bi.ruleIdx).length > 1 ? ` #${bi.index + 1}` : ''}</span>
                          </div>
                          <div className="row g-2">
                            <div className="col-6">
                              <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4, display: 'block' }}>Start</label>
                              <input type="time" className="form-control" style={{ fontSize: 13 }}
                                value={getVal('start')}
                                onChange={e => updateBreak('start', e.target.value)}
                                disabled={notYet} />
                            </div>
                            <div className="col-6">
                              <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4, display: 'block' }}>End</label>
                              <input type="time" className="form-control" style={{ fontSize: 13 }}
                                value={getVal('end')}
                                onChange={e => updateBreak('end', e.target.value)}
                                disabled={notYet} />
                              {regForm.date === today && (
                                <label style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#64748b', marginTop: 6 }}>
                                  <input type="checkbox" checked={notYet}
                                    onChange={e => {
                                      const checked = e.target.checked;
                                      setRegForm(prev => {
                                        const breaks = [...(prev.requestedBreaks || [])];
                                        const idx = breaks.findIndex(rb => rb.ruleIdx === bi.ruleIdx && rb.idx === bi.index);
                                        const updated = { type: bi.type, name: bi.name, ruleIdx: bi.ruleIdx, idx: bi.index, start: checked ? '' : (breaks[idx]?.start || ''), end: checked ? '' : (breaks[idx]?.end || ''), notYet: checked };
                                        if (idx !== -1) breaks[idx] = updated;
                                        else breaks.push(updated);
                                        return { ...prev, requestedBreaks: breaks };
                                      });
                                    }} />
                                  Not yet
                                </label>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ background: '#f8fafc', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <i className="bi bi-chat-dots" style={{ color: '#3b82f6', fontSize: 14 }} />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>Reason</span>
                        <span style={{ color: '#ef4444', fontSize: 11 }}>*</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>{regForm.reason.length}/1000</span>
                      </div>
                      <textarea className="form-control hide-scrollbar" rows={3} style={{ fontSize: 13 }} value={regForm.reason} onChange={e => setRegForm(p => ({ ...p, reason: e.target.value }))} placeholder="Explain why you need to regularize..." />
                    </div>
                  </div>
                  <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn btn-sm" onClick={() => setShowRegModal(false)}
                      style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', color: '#64748b' }}>
                      Cancel
                    </button>
                    <button className="btn btn-sm" onClick={submitRegularization} disabled={regSaving}
                      style={{ padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 10, background: 'linear-gradient(135deg,#3b82f6,#1e293b)', color: '#fff', border: 'none', opacity: regSaving ? 0.7 : 1 }}>
                      {regSaving ? <><span className="spinner-border spinner-border-sm me-2" />Submitting...</> : 'Submit Request'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}



      {/* VIEW DAILY PROGRESS TAB */}
      {tab === 'progress' && isAdmin && (
        <div className="row g-3">
          {/* Left Panel: Employee list */}
          <div className="col-md-4 col-lg-3">
            <div className="card p-3">
              <h6 style={{ fontWeight: 700, marginBottom: 12 }}>Employees</h6>
              <div className="input-group mb-3">
                <span className="input-group-text bg-transparent border-end-0">
                  <i className="bi bi-search text-muted" style={{ fontSize: 13 }} />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0"
                  placeholder="Search name..."
                  value={progressSearch}
                  onChange={e => setProgressSearch(e.target.value)}
                  style={{ fontSize: 13 }}
                />
              </div>
              <div style={{ maxHeight: 500, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(() => {
                  const filteredEmps = employees.filter(e => {
                    // Search filter
                    if (progressSearch && !e.name.toLowerCase().includes(progressSearch.toLowerCase())) return false;
                    // RBAC filters
                    if (['super_admin', 'admin_full'].includes(user?.role)) return true;
                    if (user?.role === 'team_lead') return true;
                    if (user?.role === 'team_admin') return e.role !== 'team_lead';
                    return false;
                  });
                  const paginated = filteredEmps.slice((progressEmpPage - 1) * pageSize, progressEmpPage * pageSize);
                  return (
                    <>
                      {paginated.map(e => {
                        const todayRec = teamToday.find(r => r.userId?._id === e.userId);
                        const isClockedIn = !!todayRec?.clockIn;
                        const isClockedOut = !!todayRec?.clockOut;
                        const isSelected = selectedProgressUserId === e.userId;

                        return (
                          <div
                            key={e._id}
                            onClick={() => setSelectedProgressUserId(e.userId)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '10px 12px',
                              borderRadius: 10,
                              cursor: 'pointer',
                              background: isSelected ? '#3b82f615' : 'transparent',
                              border: isSelected ? '1px solid #3b82f650' : '1px solid transparent',
                              transition: 'all 0.15s',
                              marginBottom: 4
                            }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                              {e.avatar || e.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{e.name}</div>
                              <div style={{ fontSize: 10, color: '#64748b' }}>{e.designation || e.role}</div>
                            </div>
                            {/* Attendance status indicator dot */}
                            <div style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: isClockedOut ? '#ef4444' : isClockedIn ? '#10b981' : '#cbd5e1'
                            }} title={isClockedOut ? 'Clocked Out' : isClockedIn ? 'Clocked In' : 'Not Clocked In'} />
                          </div>
                        );
                      })}
                      {filteredEmps.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Pagination
                            currentPage={progressEmpPage}
                            totalPages={Math.ceil(filteredEmps.length / pageSize)}
                            onPageChange={setProgressEmpPage}
                            totalItems={filteredEmps.length}
                            pageSize={pageSize}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Right Panel: Employee work progress sheet */}
          <div className="col-md-8 col-lg-9">
            {selectedProgressUserId ? (
              progressLoading ? (
                <div className="card p-5 text-center"><div className="spinner-border text-primary" /></div>
              ) : progressRecord ? (
                <div className="card">
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
                        {progressRecord.userId?.avatar || progressRecord.userId?.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <span style={{ fontWeight: 750, fontSize: 14.5 }}>{progressRecord.userId?.name}&apos;s Progress Sheet</span>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{formatDate(today)}</div>
                      </div>
                    </div>

                    <span className="badge ms-2" style={{
                      background: progressRecord.clockOut ? '#fee2e2' : progressRecord.clockIn ? '#dcfce7' : '#f1f5f9',
                      color: progressRecord.clockOut ? '#dc2626' : progressRecord.clockIn ? '#16a34a' : '#64748b',
                      fontSize: '11px',
                      fontWeight: 700
                    }}>
                      {progressRecord.clockOut ? 'Clocked Out' : progressRecord.clockIn ? 'Clocked In' : 'Not Clocked In'}
                    </span>

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      {progressRecord.clockOut && (
                        <button className="btn btn-sm btn-outline-success" style={{ fontSize: 12 }} onClick={() => {
                          // Download Excel/CSV for this selected employee
                          const exportRows = [...(progressRecord.workProgress || [])];
                          if (progressRecord.clockIn) {
                            exportRows.unshift({
                              type: 'clock_in',
                              taskDetails: 'Clocked In',
                              startTime: progressRecord.clockIn,
                              endTime: progressRecord.clockIn,
                              status: 'completed',
                              remarks: '',
                              feedback: ''
                            });
                          }
                          if (progressRecord.clockOut) {
                            exportRows.push({
                              type: 'clock_out',
                              taskDetails: 'Clocked Out',
                              startTime: progressRecord.clockOut,
                              endTime: progressRecord.clockOut,
                              status: 'completed',
                              remarks: '',
                              feedback: ''
                            });
                          }

                          const headers = ['S.No', 'Type', 'Task Details', 'Start Time', 'End Time', 'Duration', 'Status', 'Remarks', 'Feedback'];
                          const csvRows = [headers.join(',')];

                          exportRows.forEach((row, idx) => {
                            const values = [
                              idx + 1,
                              row.type || 'task',
                              `"${(row.taskDetails || '').replace(/"/g, '""')}"`,
                              row.startTime || '',
                              row.endTime || '',
                              computeWorkRowDuration(row) ?? '',
                              (row.carriedForward ? 'pending' : row.status) || '',
                              `"${(row.remarks || '').replace(/"/g, '""')}"`,
                              `"${([completionMetaText(row), row.feedback].filter(Boolean).join(' ')).replace(/"/g, '""')}"`
                            ];
                            csvRows.push(values.join(','));
                          });

                          const csvContent = '\uFEFF' + csvRows.join('\n');
                          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.setAttribute('href', url);
                          link.setAttribute('download', `work_progress_${progressRecord.userId?.name}_${today}.csv`);
                          link.style.visibility = 'hidden';
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}>
                          <i className="bi bi-file-earmark-excel me-1" />Download Progress (Excel)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Work Progress Table */}
                  <div className="table-responsive">
                    <table className="table mb-0">
                      <thead>
                        <tr>
                          <th style={{ width: 56 }}>S.no</th>
                          <th style={{ minWidth: 220 }}>Task Details</th>
                          <th style={{ width: 110 }}>Start Time</th>
                          <th style={{ width: 110 }}>End Time</th>
                          <th style={{ width: 90 }}>Duration</th>
                          <th style={{ minWidth: 160 }}>Status</th>
                          <th style={{ minWidth: 190 }}>Remarks</th>
                  <th style={{ minWidth: 190 }}>Feedback</th>
                  <th style={{ width: 80 }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const dbRows = progressRecord.workProgress || [];
                          const rows = [...dbRows];
                          if (progressRecord.clockIn) {
                            rows.unshift({
                              type: 'clock_in',
                              taskDetails: 'Clocked In',
                              startTime: progressRecord.clockIn,
                              endTime: progressRecord.clockIn,
                              status: 'completed',
                              remarks: '',
                              feedback: ''
                            });
                          }
                          if (progressRecord.clockOut) {
                            rows.push({
                              type: 'clock_out',
                              taskDetails: 'Clocked Out',
                              startTime: progressRecord.clockOut,
                              endTime: progressRecord.clockOut,
                              status: 'completed',
                              remarks: '',
                              feedback: ''
                            });
                          }

                          return rows.map((row, idx) => {
                            const isVirtual = row.type === 'clock_in' || row.type === 'clock_out';
                            const isBreakRow = !isVirtual && isBreakType(row.type);
                            return (
                              <tr key={idx} style={{ background: isBreakRow ? '#f8fafc' : isVirtual ? '#f1f5f9' : 'transparent' }}>
                                <td style={{ fontSize: 13, fontWeight: 700 }}>{idx + 1}</td>
                                <td>
                                  {isVirtual ? (
                                    row.type === 'clock_in' ? (
                                      <span className="badge" style={{ background: '#dcfce7', color: '#16a34a', fontSize: '11.5px', fontWeight: 700 }}>
                                        <i className="bi bi-box-arrow-in-right me-1" />Clocked In
                                      </span>
                                    ) : (
                                      <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: '11.5px', fontWeight: 700 }}>
                                        <i className="bi bi-box-arrow-right me-1" />Clocked Out
                                      </span>
                                    )
                                  ) : isBreakRow ? (
                                    <span className="badge" style={{ background: breakStyle(row.type).bg, color: breakStyle(row.type).color }}>
                                      <i className={`bi ${breakStyle(row.type).icon} me-1`} />{row.taskDetails || breakLabel(row.type)}
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 12 }}>{row.taskDetails || '—'}</span>
                                  )}
                                </td>
                                <td style={{ fontSize: 13, fontWeight: 600 }}><Time value={row.startTime} fallback="--:--" /></td>
                                <td style={{ fontSize: 13, fontWeight: 600 }}><Time value={row.endTime} fallback="--:--" /></td>
                                <td style={{ fontSize: 13, fontWeight: 600 }}>{isVirtual ? '—' : formatTaskDuration(row)}</td>
                                <td>
                                  <span className="badge" style={{ background: '#e2e8f0', color: '#475569', fontSize: 12 }}>
                                    {(row.carriedForward ? 'pending' : row.status) || 'pending'}
                                  </span>
                                </td>
                                <td style={{ fontSize: 12, color: '#475569' }}>{row.remarks || '—'}</td>
                                <td style={{ fontSize: 12, color: '#475569' }}>
                                  {renderCompletionMeta(row)}
                                  {row.feedback || (!row.completedDate ? '—' : null)}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="card p-5 text-center">
                  <i className="bi bi-calendar-x text-muted" style={{ fontSize: 32 }} />
                  <h6 className="mt-3" style={{ fontWeight: 700 }}>No record today</h6>
                  <p style={{ fontSize: 13, color: '#64748b' }}>This employee has not clocked in or has no attendance record for today.</p>
                </div>
              )
            ) : (
              <div className="card p-5 text-center">
                <i className="bi bi-people text-muted" style={{ fontSize: 32 }} />
                <h6 className="mt-3" style={{ fontWeight: 700 }}>Select an Employee</h6>
                <p style={{ fontSize: 13, color: '#64748b' }}>Select an employee from the left panel to view their daily progress sheet.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clock Out Confirmation Modal */}
      {confirmClockOut && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99998, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setConfirmClockOut(false)}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <h6 style={{ margin: 0, fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Confirm Clock Out</h6>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>You are currently clocked in. Are you sure you want to clock out?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmClockOut(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { setConfirmClockOut(false); handleClock('out'); }}>Clock Out</button>
            </div>
          </div>
        </div>
      )}

      {/* Early Clock Reason Modal */}
      {showEarlyClockModal && (
        <div className="modal-overlay" onClick={() => setShowEarlyClockModal(false)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <h6>Early Clock-In Reason</h6>
            <p style={{ fontSize: 13, color: '#64748b' }}>You are clocking in more than 2 hours before your shift. Please provide a reason.</p>
            <textarea className="form-control hide-scrollbar" rows={3} placeholder="Reason (min 10 characters)..."
              value={earlyClockReason} onChange={e => setEarlyClockReason(e.target.value)} style={{ fontSize: 13 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowEarlyClockModal(false)}>Cancel</button>
              <button className="btn btn-sm btn-primary" onClick={submitEarlyClock} disabled={earlyClockReason.trim().length < 10}>Submit</button>
            </div>
          </div>
        </div>
      )}

        </>
      )}

    </AppShell>
  );
}

// ── Team Attendance View (used inside the Team tab) ──────────────────────
function TeamAttendanceView({ query, uid, month, formatDate, formatMins, STATUS_STYLE, DAYS, isAdmin, handleOverrideAction }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recordsPage, setRecordsPage] = useState(1);
  const pageSize = 10;

  const handleAbsenceReasonChange = async (recordId, reason) => {
    try {
      await api.put('/api/attendance', { recordId, absenceReason: reason });
      setRecords(prev => prev.map(r => r._id === recordId ? { ...r, absenceReason: reason } : r));
    } catch (e) {
      console.error('Failed to update absence reason:', e);
    }
  };

  useEffect(() => {
    setRecordsPage(1);
  }, [query, uid]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    api.get('/api/attendance' + query)
      .then(r => setRecords(Array.isArray(r) ? r : []))
      .catch(e => {
        setRecords([]);
        setError(e?.message || 'Failed to load attendance records');
      })
      .finally(() => setLoading(false));
  }, [query, uid]);

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const leave = records.filter(r => r.status === 'leave').length;
  const late = records.filter(r => r.status === 'late').length;
  const shortHours = records.filter(r => r.shortHours).length;

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>;
  }

  if (error) {
    const isAccessDenied = /access denied/i.test(error);
    return (
      <div className="card">
        <div className="empty-state">
          <i className="bi bi-shield-exclamation" />
          <p>{isAccessDenied ? "Access denied. You don't have permission to view this employee's attendance records." : error}</p>
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return <div className="card"><div className="empty-state"><i className="bi bi-calendar2" /><p>No records found for this period</p></div></div>;
  }

  return (
    <>
      {/* Stat cards */}
      <div className="row g-3 mb-3">
        {[
          { label: 'Days Present', value: present, color: '#10b981' },
          { label: 'Days Absent', value: absent, color: '#ef4444' },
          { label: 'Days of Leave', value: leave, color: '#3b82f6' },
          { label: 'Late Clock-ins', value: late, color: '#f59e0b' },
          { label: 'Short-hour Days', value: shortHours, color: '#7c3aed' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="stat-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="card d-none d-md-block">
        <div className="table-responsive">
          <table className="table mb-0">
            <thead><tr><th>Date</th><th>Day</th><th>Status</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Absence Reason</th><th>Flag</th></tr></thead>
            <tbody>
              {records.slice((recordsPage - 1) * pageSize, recordsPage * pageSize).map(row => {
                const d = new Date(row.date + 'T00:00:00');
                const s = STATUS_STYLE[row.status] || STATUS_STYLE.present;
                return (
                  <tr key={row._id}>
                    <td style={{ fontSize: 13 }}>{formatDate(row.date)}</td>
                    <td style={{ fontSize: 13, color: '#64748b' }}>{DAYS[d.getDay()]}</td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
                    <td style={{ fontSize: 13 }}><Time value={row.clockIn} fallback="—" /></td>
                    <td style={{ fontSize: 13 }}><Time value={row.clockOut} fallback="—" /></td>
                    <td style={{ fontSize: 13 }}>{row.hoursWorked ? formatMins(row.hoursWorked) : '—'}</td>
                    <td style={{ fontSize: 13, maxWidth: 160 }}>
                      {isAdmin && (row.status === 'absent' || row.status === 'late') ? (
                        <input className="form-control form-control-sm" style={{ fontSize: 11 }}
                          defaultValue={row.absenceReason || ''} placeholder="Add reason..."
                          onBlur={e => { handleAbsenceReasonChange(row._id, e.target.value); }} />
                      ) : (
                        <span style={{ color: row.absenceReason ? '#1e293b' : '#94a3b8' }}>{row.absenceReason || '—'}</span>
                      )}
                    </td>
                    <td>
                      {row.leaveOverride?.status === 'pending' && (
                        <span className="badge bg-warning text-dark" style={{ fontSize: 11 }}>Pending Review</span>
                      )}
                      {row.shortHours && <span className="badge ms-1" style={{ background: '#f3e8ff', color: '#7c3aed', fontSize: 10 }}>Short Hours</span>}
                      {row.approvedHalfDayLeave && <span className="badge ms-1" style={{ background: '#dbeafe', color: '#2563eb', fontSize: 10 }}>Present + Half-day Leave</span>}
                      {row.leaveOverride?.status === 'pending' && isAdmin && (
                        <div className="mt-1">
                          <button className="btn btn-sm btn-success me-1" style={{ fontSize: 11 }}
                            onClick={() => handleOverrideAction(row._id, 'approve_override')}>
                            <i className="bi bi-check-lg" />
                          </button>
                          <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }}
                            onClick={() => handleOverrideAction(row._id, 'reject_override')}>
                            <i className="bi bi-x-lg" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="d-md-none" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.slice((recordsPage - 1) * pageSize, recordsPage * pageSize).map(row => {
          const d = new Date(row.date + 'T00:00:00');
          const s = STATUS_STYLE[row.status] || STATUS_STYLE.present;
          return (
            <div key={row._id} className="card p-3">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{formatDate(row.date)}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{DAYS[d.getDay()]}</div>
                </div>
                <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
              </div>
              <div className="row g-2">
                {[['Clock In', formatTime(row.clockIn)], ['Clock Out', formatTime(row.clockOut)], ['Hours', row.hoursWorked ? formatMins(row.hoursWorked) : null]].map(([lbl, val]) => (
                  <div key={lbl} className="col-4">
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{val || '—'}</div>
                  </div>
                ))}
              </div>
              {(row.status === 'absent' || row.status === 'late') && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                  <strong>Absence Reason:</strong>{' '}
                  {isAdmin ? (
                    <input className="form-control form-control-sm d-inline-block" style={{ fontSize: 11, width: 'auto' }}
                      defaultValue={row.absenceReason || ''} placeholder="Add reason..."
                      onBlur={e => { handleAbsenceReasonChange(row._id, e.target.value); }} />
                  ) : (
                    <span style={{ color: row.absenceReason ? '#1e293b' : '#94a3b8' }}>{row.absenceReason || 'Not provided'}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {records.length > 0 && (
        <Pagination
          currentPage={recordsPage}
          totalPages={Math.ceil(records.length / pageSize)}
          onPageChange={setRecordsPage}
          totalItems={records.length}
          pageSize={pageSize}
        />
      )}
    </>
  );
}
