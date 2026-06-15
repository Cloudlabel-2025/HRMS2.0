'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a', label: 'Present' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent' },
  late:    { bg: '#fef3c7', color: '#d97706', label: 'Late' },
  leave:   { bg: '#dbeafe', color: '#2563eb', label: 'Leave' },
  sunday:  { bg: '#f8fafc', color: '#94a3b8', label: 'Sunday' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Break = 30 min allowance, Lunch = 60 min allowance
const BREAK_ALLOWANCE_MINS = 30;
const LUNCH_ALLOWANCE_MINS = 60;
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
  const { formatDate } = useSettings();
  const [tab, setTab]                   = useState('today');
  const [todayRecord, setTodayRecord]   = useState(null);
  const [teamToday, setTeamToday]       = useState([]);
  const [employees, setEmployees]       = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [clockLoading, setClockLoading] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [toast, setToast]               = useState(null);
  const [regRequests, setRegRequests]   = useState([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm]           = useState({ date: '', requestedIn: '', requestedOut: '', reason: '' });
  const [regSaving, setRegSaving]       = useState(false);

  // Break / Lunch local state (client-side only — stored in todayRecord.breaks)
  const [breakTab, setBreakTab]         = useState('break'); // 'break' | 'lunch'
  const [breakLoading, setBreakLoading] = useState(false);

  // Progress tab states
  const [progressSearch, setProgressSearch] = useState('');
  const [selectedProgressUserId, setSelectedProgressUserId] = useState('');
  const [progressRecord, setProgressRecord] = useState(null);
  const [progressLoading, setProgressLoading] = useState(false);

  // Work progress save
  const [saveWorkLoading, setSaveWorkLoading] = useState(false);
  const handleSaveWork = async () => {
    setSaveWorkLoading(true);
    try {
      await persistTodayRecord({ workProgress: todayRecord?.workProgress || [] });
      showToast('Work progress saved');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaveWorkLoading(false); }
  };

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const isAdmin = ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role);
  const isSuperAdmin = user?.role === 'super_admin';
  const today   = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })();
  const month   = today.slice(0, 7);

  // Team tab filters
  const [teamMonth, setTeamMonth] = useState(month);
  const [teamFromDate, setTeamFromDate] = useState('');
  const [teamToDate, setTeamToDate] = useState('');

  const loadTodayRecord = async () => {
    try {
      const records = await api.get('/api/attendance?date=' + today + '&scope=my');
      setTodayRecord(Array.isArray(records) && records.length > 0 ? records[0] : null);
    } catch { setTodayRecord(null); }
  };

  const loadTeamToday = async () => {
    try { const r = await api.get('/api/attendance?scope=team&date=' + today); setTeamToday(Array.isArray(r) ? r : []); }
    catch { setTeamToday([]); }
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

  useEffect(() => {
    if (tab === 'progress' && selectedProgressUserId) {
      loadProgressRecord(selectedProgressUserId);
    }
  }, [selectedProgressUserId, tab]);

  // Fire page-view audit exactly once per mount — useRef prevents double-fire in React Strict Mode
  const pageViewFired = useRef(false);
  useEffect(() => {
    if (!user || pageViewFired.current) return;
    pageViewFired.current = true;
    api.post('/api/audit/page-view', { module: 'Attendance', details: 'Opened Attendance module' }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      loadTodayRecord(),
      isAdmin ? loadTeamToday() : Promise.resolve(),
      isAdmin ? loadEmployees() : Promise.resolve(),
      loadRegRequests(isAdmin ? 'approvals' : 'my'),
    ]).finally(() => setLoading(false));
  }, [user]);

  const handleClock = async (action) => {
    setClockLoading(true);
    try {
      const result = await api.post('/api/attendance/clock', { action });
      setTodayRecord(result.record);
      showToast('Clocked ' + (action === 'in' ? 'in' : 'out') + ' at ' + result.time);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setClockLoading(false); }
  };

  // ── Break / Lunch helpers ──────────────────────────────────────────────────
  // We store breaks in todayRecord locally; in a real app you'd persist via API.
  // Structure: todayRecord.breaks = [{ type:'break'|'lunch', start, end }]

  const getBreaks = (type) => (todayRecord?.breaks || []).filter(b => b.type === type);

  const activeBreak = (type) => getBreaks(type).find(b => b.start && !b.end);
  const anyActiveBreak = () => (todayRecord?.breaks || []).find(b => b.start && !b.end);
  const getWorkProgress = () => todayRecord?.workProgress || [];
  const activeWorkIndex = () => getWorkProgress().findIndex(row => row.startTime && !row.endTime);

  const persistTodayRecord = async (updates) => {
    const updated = await api.put('/api/attendance', { date: today, ...updates });
    setTodayRecord(updated);
    return updated;
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

  const buildBreakRow = (type, startTime) => ({
    type,
    taskDetails: type === 'lunch' ? 'Lunch break' : 'Break',
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
    setTodayRecord(prev => ({
      ...prev,
      workProgress: (prev?.workProgress || []).map((row, i) => i === idx ? { ...row, ...patch } : row),
    }));
  };

  const saveWorkProgress = async (rows = todayRecord?.workProgress || []) => {
    try { await persistTodayRecord({ workProgress: rows }); }
    catch (e) { showToast(e.message, 'error'); }
  };

  const commitWorkRow = async (idx, patch) => {
    const rows = (todayRecord?.workProgress || []).map((row, i) => i === idx ? { ...row, ...patch } : row);
    try { await persistTodayRecord({ workProgress: rows }); }
    catch (e) { showToast(e.message, 'error'); }
  };

  const endCurrentTask = async () => {
    if (!clockedIn || clockedOut || anyActiveBreak()) return;
    const now = nowTimeStr();
    let rows = closeActiveWork([...(todayRecord?.workProgress || [])], now, 'completed');
    rows.push(buildTaskRow(now));
    try {
      await persistTodayRecord({ workProgress: rows });
      showToast('Task ended at ' + now);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const totalBreakMins = (type) =>
    getBreaks(type).reduce((acc, b) => acc + (b.end ? diffMins(b.start, b.end) : 0), 0);

  const overMins = (type) => {
    const allowance = type === 'break' ? BREAK_ALLOWANCE_MINS : LUNCH_ALLOWANCE_MINS;
    return Math.max(0, totalBreakMins(type) - allowance);
  };

  const handleBreakClock = async (type) => {
    setBreakLoading(true);
    try {
      const now = nowTimeStr();
      const active = activeBreak(type);
      let updatedBreaks = [...(todayRecord?.breaks || [])];

      let updatedWorkProgress = [...(todayRecord?.workProgress || [])];

      if (!active) {
        // Start break/lunch
        // Limit to 1 break and 1 lunch per day
        if (getBreaks(type).length > 0) {
          showToast(`You have already taken your ${type === 'break' ? 'break' : 'lunch break'} for today. Only 1 is allowed.`, 'error');
          setBreakLoading(false);
          return;
        }
        updatedBreaks.push({ type, start: now, end: null });
        updatedWorkProgress = closeActiveWork(updatedWorkProgress, now, 'stopped');
        updatedWorkProgress.push(buildBreakRow(type, now));
        showToast(`${type === 'break' ? 'Break' : 'Lunch'} started at ${now}`);
      } else {
        // End break/lunch
        const idx = updatedBreaks.findIndex(b => b.type === type && b.start && !b.end);
        if (idx !== -1) updatedBreaks[idx] = { ...updatedBreaks[idx], end: now };
        const workIdx = updatedWorkProgress.findIndex(row => row.type === type && row.startTime && !row.endTime);
        if (workIdx !== -1) updatedWorkProgress[workIdx] = { ...updatedWorkProgress[workIdx], endTime: now, status: 'completed' };
        const lastTask = [...updatedWorkProgress].reverse().find(row => row.type === 'task' && row.taskDetails);
        if (!clockedOut) updatedWorkProgress.push(buildTaskRow(now, lastTask?.taskDetails || ''));
        const elapsed = diffMins(active.start, now);
        const allowance = type === 'break' ? BREAK_ALLOWANCE_MINS : LUNCH_ALLOWANCE_MINS;
        const over = Math.max(0, elapsed - allowance);
        if (over > 0) {
          showToast(`${type === 'break' ? 'Break' : 'Lunch'} ended — exceeded by ${over} min(s). Working hours reduced.`, 'error');
        } else {
          showToast(`${type === 'break' ? 'Break' : 'Lunch'} ended at ${now}`);
        }
      }

      // Recalculate deduction: total over-time for all break types
      const allBreaks = updatedBreaks;
      const breakOver = allBreaks.filter(b => b.type === 'break' && b.end)
        .reduce((acc, b) => acc + Math.max(0, diffMins(b.start, b.end) - BREAK_ALLOWANCE_MINS), 0);
      const lunchOver = allBreaks.filter(b => b.type === 'lunch' && b.end)
        .reduce((acc, b) => acc + Math.max(0, diffMins(b.start, b.end) - LUNCH_ALLOWANCE_MINS), 0);
      const totalDeduction = breakOver + lunchOver;

      // Recalculate effective hours (base hoursWorked minus deductions)
      const baseHours = todayRecord?.baseHoursWorked ?? todayRecord?.hoursWorked ?? 0;
      const effectiveHours = Math.max(0, baseHours - totalDeduction);

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

    const headers = ['S.No', 'Type', 'Task Details', 'Start Time', 'End Time', 'Status', 'Remarks', 'Feedback'];
    const csvRows = [headers.join(',')];

    exportRows.forEach((row, idx) => {
      const values = [
        idx + 1,
        row.type || 'task',
        `"${(row.taskDetails || '').replace(/"/g, '""')}"`,
        row.startTime || '',
        row.endTime || '',
        row.status || '',
        `"${(row.remarks || '').replace(/"/g, '""')}"`,
        `"${(row.feedback || '').replace(/"/g, '""')}"`
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
    setRegSaving(true);
    try {
      await api.post('/api/attendance/regularize', regForm);
      showToast('Regularization request submitted');
      setShowRegModal(false);
      setRegForm({ date: '', requestedIn: '', requestedOut: '', reason: '' });
      loadRegRequests('my');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setRegSaving(false); }
  };

  const reviewRegularization = async (id, action) => {
    try {
      await api.put('/api/attendance/regularize', { id, action });
      showToast('Request ' + action);
      loadRegRequests('approvals');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const clockedIn  = !!todayRecord?.clockIn;
  const clockedOut = !!todayRecord?.clockOut;

  const formatMins = (mins) => { if (!mins) return '--'; return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'; };

  const tabs = ['today', 'team', 'regularize', ...(isAdmin ? ['progress'] : [])];
  const tabLabels = { today: 'Today', team: 'Team', regularize: 'Regularize', progress: 'View Daily Progress' };

  // Break/Lunch UI helpers
  const renderBreakLunchPanel = (type) => {
    const label     = type === 'break' ? 'Break' : 'Lunch';
    const allowance = type === 'break' ? BREAK_ALLOWANCE_MINS : LUNCH_ALLOWANCE_MINS;
    const color     = type === 'break' ? '#f59e0b' : '#8b5cf6';
    const bgColor   = type === 'break' ? '#fffbeb' : '#f5f3ff';
    const icon      = type === 'break' ? 'bi-cup-hot' : 'bi-egg-fried';
    const active    = activeBreak(type);
    const totalMins = totalBreakMins(type);
    const over      = overMins(type);
    const history   = getBreaks(type).filter(b => b.end);

    return (
      <div style={{ background: bgColor, border: `1px solid ${color}30`, borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`bi ${icon}`} style={{ color, fontSize: 15 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{label}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Allowance: {allowance} min</div>
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
            onClick={() => handleBreakClock(type)}
            style={{ fontSize: 13, fontWeight: 600, background: active ? '#ef444415' : color + '15', color: active ? '#ef4444' : color, border: `1px solid ${active ? '#ef4444' : color}30` }}>
            {breakLoading
              ? <span className="spinner-border spinner-border-sm" />
              : active
                ? <><i className="bi bi-stop-circle me-2" />End {label} (started {active.start})</>
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
                  <span>{b.start} → {b.end}</span>
                  <span style={{ fontWeight: 700, color: exceeded ? '#ef4444' : '#10b981' }}>{dur} min{exceeded ? ` (${dur - allowance} over)` : ''}</span>
                </div>
              );
            })}
          </div>
        )}

        {active && (
          <div style={{ marginTop: 10, fontSize: 12, color, background: color + '10', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="spinner-grow spinner-grow-sm" style={{ width: 8, height: 8, background: color }} />
            {label} in progress since {active.start}
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
                  <th style={{ minWidth: 160 }}>Status</th>
                  <th style={{ minWidth: 190 }}>Remarks</th>
                  <th style={{ minWidth: 190 }}>Feedback</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isBreakRow = row.type === 'break' || row.type === 'lunch';
                  const isVirtual = row.type === 'clock_in' || row.type === 'clock_out';
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
                          <span className="badge" style={{ background: row.type === 'lunch' ? '#f5f3ff' : '#fffbeb', color: row.type === 'lunch' ? '#7c3aed' : '#d97706' }}>
                            <i className={`bi ${row.type === 'lunch' ? 'bi-egg-fried' : 'bi-cup-hot'} me-1`} />{row.taskDetails || (row.type === 'lunch' ? 'Lunch break' : 'Break')}
                          </span>
                        ) : (
                          <textarea
                            className="form-control"
                            rows={2}
                            placeholder={active ? 'Enter current task details' : 'Task details'}
                            value={row.taskDetails || ''}
                            onChange={e => updateWorkRow(row.dbIdx, { taskDetails: e.target.value })}
                            onBlur={() => saveWorkProgress()}
                            style={{ fontSize: 12, minWidth: 210 }}
                          />
                        )}
                      </td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{row.startTime || '--:--'}</td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{row.endTime || (active ? 'Running' : '--:--')}</td>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={row.status || (active ? 'work_in_progress' : 'pending')}
                          disabled={isBreakRow || isVirtual}
                          onChange={e => commitWorkRow(row.dbIdx, { status: e.target.value })}
                          style={{ fontSize: 12 }}>
                          {isVirtual ? <option value="completed">Completed</option> : WORK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      <td>
                        {isVirtual ? null : (
                          <textarea
                            className="form-control"
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
                          <textarea
                            className="form-control"
                            rows={2}
                            placeholder="Feedback"
                            value={row.feedback || ''}
                            onChange={e => updateWorkRow(row.dbIdx, { feedback: e.target.value })}
                            onBlur={() => saveWorkProgress()}
                            style={{ fontSize: 12 }}
                          />
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
      {toast && (
        <div className="toast-container-custom">
          <div className={'toast-custom ' + toast.type}>
            <i className={'bi ' + (toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle')} /> {toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h4>Time & Attendance</h4>
          <p>{isSuperAdmin ? 'Team-wide attendance overview' : 'Track daily attendance, shifts, and working hours'}</p>
        </div>
        {!isSuperAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            {!clockedIn && !clockedOut && (
              <button className="btn btn-success" onClick={() => handleClock('in')} disabled={clockLoading}>
                {clockLoading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-play-circle me-2" />}Clock In
              </button>
            )}
            {clockedIn && !clockedOut && (
              <button className="btn btn-danger" onClick={() => handleClock('out')} disabled={clockLoading}>
                {clockLoading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-stop-circle me-2" />}Clock Out
              </button>
            )}
            {clockedIn && clockedOut && (
              <span className="badge bg-success d-flex align-items-center px-3" style={{ fontSize: 13 }}>
                <i className="bi bi-check-circle me-2" />Attendance Complete
              </span>
            )}
          </div>
        )}
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
                  { label: 'Working on Task', value: teamToday.filter(r => r.clockIn && !r.clockOut && r.workProgress?.length > 0).length, icon: 'bi-list-check', color: '#8b5cf6' },
                ].map((s, i) => (
                  <div key={i} className="col-6 col-xl-3">
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
                      {teamToday.map(row => {
                        const s = STATUS_STYLE[row.status] || STATUS_STYLE.present;
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
                            <td><span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
                            <td style={{ fontSize: 13 }}>{row.clockIn || '—'}</td>
                            <td style={{ fontSize: 13 }}>{row.clockOut || '—'}</td>
                            <td style={{ fontSize: 13 }}>{row.hoursWorked ? formatMins(row.hoursWorked) : '—'}</td>
                            <td>{row.lateFlag && <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}><i className="bi bi-exclamation-triangle me-1" />Late</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                          ['Clock In',  todayRecord.clockIn  || '—'],
                          ['Clock Out', todayRecord.clockOut || '—'],
                          ['Hours',     todayRecord.hoursWorked ? formatMins(todayRecord.hoursWorked) : '—'],
                        ].map(([label, val]) => (
                          <div key={label} className="col-6 col-md-3">
                            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{val}</div>
                          </div>
                        ))}
                      </div>
                      {(todayRecord.breakDeduction > 0) && (
                        <div style={{ marginTop: 14, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="bi bi-dash-circle" />
                          <span><strong>{todayRecord.breakDeduction} min</strong> deducted from working hours (excess break/lunch time)</span>
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
                      <i className="bi bi-clock" />
                      <h6>No attendance record for today</h6>
                      <p>Click &quot;Clock In&quot; to mark your attendance</p>
                    </div>
                  )}
                </div>
              </div>
              {clockedIn && (
                <div className="col-lg-6">
                  <div className="card" style={{ borderRadius: 14, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      {[
                        { key: 'break', label: 'Break', icon: 'bi-cup-hot',    color: '#f59e0b' },
                        { key: 'lunch', label: 'Lunch', icon: 'bi-egg-fried', color: '#8b5cf6' },
                      ].map(bt => (
                        <button key={bt.key} onClick={() => setBreakTab(bt.key)}
                          style={{
                            flex: 1, padding: '12px 8px', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                            background: 'transparent',
                            color: breakTab === bt.key ? bt.color : '#94a3b8',
                            borderBottom: breakTab === bt.key ? `3px solid ${bt.color}` : '3px solid transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            transition: 'all 0.15s',
                          }}>
                          <i className={`bi ${bt.icon}`} style={{ fontSize: 14 }} />{bt.label}
                          {overMins(bt.key) > 0 && (
                            <span style={{ fontSize: 10, background: '#fef2f2', color: '#ef4444', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
                              −{overMins(bt.key)}m
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div style={{ padding: 16 }}>
                      {renderBreakLunchPanel(breakTab)}
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
              <select className="form-select" style={{ fontSize: 13, maxWidth: 300 }} value={selectedUserId} onChange={e => { setSelectedUserId(e.target.value); setTeamMonth(month); setTeamFromDate(''); setTeamToDate(''); }}>
                <option value="">— Select Employee —</option>
                {employees.map(e => <option key={e.userId} value={e.userId}>{e.name} ({e.department || 'No Dept'})</option>)}
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
                  <input type="date" className="form-control" style={{ fontSize: 13 }} value={teamFromDate} onChange={e => setTeamFromDate(e.target.value)} max={teamToDate || undefined} />
                </div>
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>To Date</label>
                  <input type="date" className="form-control" style={{ fontSize: 13 }} value={teamToDate} onChange={e => setTeamToDate(e.target.value)} min={teamFromDate || undefined} />
                </div>
                <div className="col-md-3">
                  <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={() => { setTeamMonth(month); setTeamFromDate(''); setTeamToDate(''); }}>
                    <i className="bi bi-arrow-counterclockwise me-1" />Reset
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Data */}
          {(() => {
            const uid = isAdmin ? selectedUserId : user?._id;
            if (!uid) {
              return (
                <div className="card"><div className="empty-state"><i className="bi bi-person" /><p>Select an employee to view attendance</p></div></div>
              );
            }

            // Build date filter query params
            let query = `?scope=team&userId=${uid}&month=${teamMonth}`;
            if (teamFromDate) query += `&fromDate=${teamFromDate}`;
            if (teamToDate) query += `&toDate=${teamToDate}`;

            return <TeamAttendanceView
              query={query}
              uid={uid}
              month={teamMonth}
              formatDate={formatDate}
              formatMins={formatMins}
              STATUS_STYLE={STATUS_STYLE}
              DAYS={DAYS}
            />;
          })()}
        </div>
      )}

      {/* REGULARIZE TAB */}
      {tab === 'regularize' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{isAdmin ? 'Pending Regularization Requests' : 'My Regularization Requests'}</span>
            {!isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowRegModal(true)}>
                <i className="bi bi-plus-lg me-1" />New Request
              </button>
            )}
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
                        {isAdmin && <th>Employee</th>}
                        <th>Date</th><th>Req. In</th><th>Req. Out</th><th>Reason</th><th>Status</th>
                        {isAdmin && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {regRequests.map(r => (
                        <tr key={r._id}>
                          {isAdmin && (
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{r.userId?.avatar}</div>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</span>
                              </div>
                            </td>
                          )}
                          <td style={{ fontSize: 13 }}>{formatDate(r.date)}</td>
                          <td style={{ fontSize: 13 }}>{r.requestedIn  || '—'}</td>
                          <td style={{ fontSize: 13 }}>{r.requestedOut || '—'}</td>
                          <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160 }}>{r.reason}</td>
                          <td><span className={'badge status-' + r.status}>{r.status}</span></td>
                          {isAdmin && (
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
                {regRequests.map(r => (
                  <div key={r._id} className="card p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        {isAdmin && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{r.userId?.name}</div>}
                        <div style={{ fontSize: 13, color: '#64748b' }}>{formatDate(r.date)}</div>
                      </div>
                      <span className={'badge status-' + r.status}>{r.status}</span>
                    </div>
                    <div className="row g-2 mb-2">
                      <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. In</div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.requestedIn || '—'}</div></div>
                      <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. Out</div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.requestedOut || '—'}</div></div>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: isAdmin && r.status === 'pending' ? 10 : 0 }}>{r.reason}</div>
                    {isAdmin && r.status === 'pending' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-success flex-fill" onClick={() => reviewRegularization(r._id, 'approved')}>Approve</button>
                        <button className="btn btn-sm btn-danger  flex-fill" onClick={() => reviewRegularization(r._id, 'rejected')}>Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {showRegModal && (
            <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header">
                    <h5 className="modal-title">Regularization Request</h5>
                    <button className="btn-close" onClick={() => setShowRegModal(false)} />
                  </div>
                  <div className="modal-body">
                    <div className="row g-3">
                      <div className="col-12">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Date *</label>
                        <input type="date" className="form-control" value={regForm.date} onChange={e => setRegForm(p => ({ ...p, date: e.target.value }))} />
                      </div>
                      <div className="col-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Actual Clock In</label>
                        <input type="time" className="form-control" value={regForm.requestedIn} onChange={e => setRegForm(p => ({ ...p, requestedIn: e.target.value }))} />
                      </div>
                      <div className="col-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Actual Clock Out</label>
                        <input type="time" className="form-control" value={regForm.requestedOut} onChange={e => setRegForm(p => ({ ...p, requestedOut: e.target.value }))} />
                      </div>
                      <div className="col-12">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason *</label>
                        <textarea className="form-control" rows={3} value={regForm.reason} onChange={e => setRegForm(p => ({ ...p, reason: e.target.value }))} />
                      </div>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button className="btn btn-outline-secondary" onClick={() => setShowRegModal(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={submitRegularization} disabled={regSaving}>
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
                {employees
                  .filter(e => {
                    // Search filter
                    if (progressSearch && !e.name.toLowerCase().includes(progressSearch.toLowerCase())) return false;
                    // RBAC filters
                    if (['super_admin', 'admin_full'].includes(user?.role)) return true;
                    if (user?.role === 'team_lead') return true;
                    if (user?.role === 'team_admin') return e.role !== 'team_lead';
                    return false;
                  })
                  .map(e => {
                    // Find if clocked in today from teamToday
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
                          transition: 'all 0.15s'
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

                          const headers = ['S.No', 'Type', 'Task Details', 'Start Time', 'End Time', 'Status', 'Remarks', 'Feedback'];
                          const csvRows = [headers.join(',')];

                          exportRows.forEach((row, idx) => {
                            const values = [
                              idx + 1,
                              row.type || 'task',
                              `"${(row.taskDetails || '').replace(/"/g, '""')}"`,
                              row.startTime || '',
                              row.endTime || '',
                              row.status || '',
                              `"${(row.remarks || '').replace(/"/g, '""')}"`,
                              `"${(row.feedback || '').replace(/"/g, '""')}"`
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
                          <th style={{ minWidth: 160 }}>Status</th>
                          <th style={{ minWidth: 190 }}>Remarks</th>
                          <th style={{ minWidth: 190 }}>Feedback</th>
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
                            const isBreakRow = row.type === 'break' || row.type === 'lunch';
                            const isVirtual = row.type === 'clock_in' || row.type === 'clock_out';
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
                                    <span className="badge" style={{ background: row.type === 'lunch' ? '#f5f3ff' : '#fffbeb', color: row.type === 'lunch' ? '#7c3aed' : '#d97706' }}>
                                      <i className={`bi ${row.type === 'lunch' ? 'bi-egg-fried' : 'bi-cup-hot'} me-1`} />{row.taskDetails || (row.type === 'lunch' ? 'Lunch break' : 'Break')}
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 12 }}>{row.taskDetails || '—'}</span>
                                  )}
                                </td>
                                <td style={{ fontSize: 13, fontWeight: 600 }}>{row.startTime || '--:--'}</td>
                                <td style={{ fontSize: 13, fontWeight: 600 }}>{row.endTime || '--:--'}</td>
                                <td>
                                  <span className="badge" style={{ background: '#e2e8f0', color: '#475569', fontSize: 12 }}>
                                    {row.status || 'pending'}
                                  </span>
                                </td>
                                <td style={{ fontSize: 12, color: '#475569' }}>{row.remarks || '—'}</td>
                                <td style={{ fontSize: 12, color: '#475569' }}>{row.feedback || '—'}</td>
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
    </AppShell>
  );
}

// ── Team Attendance View (used inside the Team tab) ──────────────────────
function TeamAttendanceView({ query, uid, month, formatDate, formatMins, STATUS_STYLE, DAYS }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    api.get('/api/attendance' + query)
      .then(r => setRecords(Array.isArray(r) ? r : []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [query, uid]);

  const present = records.filter(r => r.status === 'present').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const leave = records.filter(r => r.status === 'leave').length;
  const late = records.filter(r => r.status === 'late').length;

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>;
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
            <thead><tr><th>Date</th><th>Day</th><th>Status</th><th>Clock In</th><th>Clock Out</th><th>Hours</th></tr></thead>
            <tbody>
              {records.map(row => {
                const d = new Date(row.date + 'T00:00:00');
                const s = STATUS_STYLE[row.status] || STATUS_STYLE.present;
                return (
                  <tr key={row._id}>
                    <td style={{ fontSize: 13 }}>{formatDate(row.date)}</td>
                    <td style={{ fontSize: 13, color: '#64748b' }}>{DAYS[d.getDay()]}</td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
                    <td style={{ fontSize: 13 }}>{row.clockIn || '—'}</td>
                    <td style={{ fontSize: 13 }}>{row.clockOut || '—'}</td>
                    <td style={{ fontSize: 13 }}>{row.hoursWorked ? formatMins(row.hoursWorked) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="d-md-none" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {records.map(row => {
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
                {[['Clock In', row.clockIn], ['Clock Out', row.clockOut], ['Hours', row.hoursWorked ? formatMins(row.hoursWorked) : null]].map(([lbl, val]) => (
                  <div key={lbl} className="col-4">
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{val || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
