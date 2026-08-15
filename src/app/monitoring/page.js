'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import Time from '@/components/Time';
import { getAttendanceDate } from '@/lib/attendance-date';
import { isBreakType, breakStyle } from '@/lib/attendance-breaks';
import { formatTaskDuration } from '@/lib/attendance-constants';

const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a', label: 'Present', icon: 'bi-check-circle' },
  not_arrived: { bg: '#f1f5f9', color: '#64748b', label: 'Not arrived', icon: 'bi-hourglass-split' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent',  icon: 'bi-x-circle' },
  late:    { bg: '#fef3c7', color: '#d97706', label: 'Late',    icon: 'bi-clock' },
  leave:   { bg: '#dbeafe', color: '#2563eb', label: 'On Leave',icon: 'bi-calendar-check' },
  logged_out: { bg: '#f1f5f9', color: '#64748b', label: 'Logged Out', icon: 'bi-box-arrow-right' },
};

function formatDuration(start, end) {
  if (!start || !end) return '--';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff <= 0) return '--';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h}h ${m}m`;
}

function totalBreakDuration(breaks, type) {
  const filtered = breaks.filter(b => b.type === type && b.start && b.end);
  let total = 0;
  for (const b of filtered) {
    const [sh, sm] = b.start.split(':').map(Number);
    const [eh, em] = b.end.split(':').map(Number);
    total += (eh * 60 + em) - (sh * 60 + sm);
  }
  if (total <= 0) return '--';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

export default function MonitoringPage() {
  const { user } = useAuth();
  const { formatTime } = useSettings();
  const [team, setTeam] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [departments, setDepartments] = useState([]);
  const [workProgressEmp, setWorkProgressEmp] = useState(null);
  const [patternFlags, setPatternFlags] = useState([]);

  const isSuperAdmin = user?.role === 'super_admin';

  const fetchData = async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const now = new Date();
      const calToday = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      const calYesterday = yesterday.getFullYear() + '-' + String(yesterday.getMonth()+1).padStart(2,'0') + '-' + String(yesterday.getDate()).padStart(2,'0');

      const [deptData, shiftData] = await Promise.all([
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=shifts'),
      ]);
      setDepartments(Array.isArray(deptData) ? deptData.map(d => d.name) : []);
      const allShifts = Array.isArray(shiftData) ? shiftData : [];

      let employees = [];
      if (isSuperAdmin) {
        employees = await api.get('/api/employees');
      } else {
        employees = await api.get(`/api/employees?department=${user.department}`);
      }

      const [attendanceToday, attendanceYest, leaves] = await Promise.all([
        api.get(`/api/attendance?date=${calToday}&scope=team`),
        api.get(`/api/attendance?date=${calYesterday}&scope=team`),
        api.get('/api/leave?scope=team&status=approved'),
      ]);

      const leaveArr = Array.isArray(leaves) ? leaves : [];

      const attMap = {};
      for (const r of [...(Array.isArray(attendanceYest) ? attendanceYest : [])]) {
        const uid = r.userId?._id?.toString() || r.userId?.toString();
        if (uid) attMap[`${uid}::${r.date}`] = r;
      }
      for (const r of [...(Array.isArray(attendanceToday) ? attendanceToday : [])]) {
        const uid = r.userId?._id?.toString() || r.userId?.toString();
        if (uid) attMap[`${uid}::${r.date}`] = r;
      }

      const empMap = {};
      for (const emp of employees) {
        const uid = emp.userId?.toString();
        if (!uid) continue;

        // Determine this employee's shift-aware today
        const empShiftName = emp.shift || 'Morning (9AM-6PM)';
        const matchedShift = allShifts.find(s => (emp.shiftId && s._id === emp.shiftId) || s.name === empShiftName);
        const empToday = (matchedShift?.startTime && matchedShift?.endTime)
          ? getAttendanceDate(now, matchedShift.startTime, matchedShift.endTime)
          : calToday;

        const attRecord = attMap[`${uid}::${empToday}`];
        const isOnLeave = leaveArr.some(leave => {
          const leaveUserId = leave.userId?._id?.toString() || leave.userId?.toString();
          return leaveUserId === uid && leave.from <= empToday && leave.to >= empToday;
        });

        let status = 'not_arrived';
        let clockIn = '—';
        let clockOut = '—';
        let breaks = [];
        let workProgress = [];
        let lateFlag = false;
        let onBreak = false;
        let activeBreakType = '';
        let autoLoggedOut = false;

        const breakLabels = {};
        for (const b of (matchedShift?.breaks || [])) {
          if (b.type) breakLabels[b.type] = b.name || b.type;
        }

        if (isOnLeave) {
          status = 'leave';
        } else if (attRecord) {
          status = attRecord.status || 'present';
          clockIn = attRecord.clockIn || '—';
          clockOut = attRecord.clockOut || '—';
          lateFlag = attRecord.lateFlag === true;
          autoLoggedOut = attRecord.autoLoggedOut === true;
          breaks = Array.isArray(attRecord.breaks) ? attRecord.breaks : [];
          workProgress = Array.isArray(attRecord.workProgress) ? attRecord.workProgress : [];
          const openBreak = breaks.find(b => b.start && !b.end);
          onBreak = !!openBreak;
          activeBreakType = openBreak?.type || '';
        } else {
          const [shiftHour, shiftMinute] = (matchedShift?.startTime || '09:00').split(':').map(Number);
          let elapsedSinceStart = now.getHours() * 60 + now.getMinutes() - (shiftHour * 60 + shiftMinute);
          if (elapsedSinceStart < -720) elapsedSinceStart += 1440;
          if (elapsedSinceStart > 720) elapsedSinceStart -= 1440;
          if (elapsedSinceStart >= (matchedShift.halfDayThreshold ?? 180)) status = 'absent';
        }

        const hasClockOut = clockOut !== '—' && clockOut !== null;

        empMap[uid] = {
          _id: uid,
          name: emp.name,
          avatar: emp.avatar,
          dept: emp.department,
          designation: emp.designation,
          employeeNumber: emp.employeeNumber,
          employmentStatus: emp.employmentStatus,
          status,
          clockIn,
          clockOut,
          breaks,
          workProgress,
          lateFlag,
          onBreak,
          activeBreakType,
          breakLabels,
          autoLoggedOut,
          isLoggedOut: hasClockOut,
        };
      }

      const teamArr = Object.values(empMap);

      const alertList = [];
      for (const emp of teamArr) {
        if (emp.lateFlag) alertList.push({ type: 'late', icon: 'bi-clock', color: '#f59e0b', text: `${emp.name} logged in late (${formatTime(emp.clockIn)})`, time: emp.clockIn });
        if (emp.autoLoggedOut) alertList.push({ type: 'auto_logout', icon: 'bi-clock-history', color: '#f59e0b', text: `${emp.name} was auto-logged out at ${formatTime(emp.clockOut)}`, time: emp.clockOut });
      }

      setTeam(teamArr);
      setAlerts(alertList.slice(0, 10));
      api.get('/api/monitoring/patterns')
        .then(data => setPatternFlags(Array.isArray(data?.flags) ? data.flags : []))
        .catch(() => setPatternFlags([]));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchData();
  }, [user]);

  const depts = departments;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = team.filter(e =>
    (!filterStatus || e.status === filterStatus) &&
    (!filterDept   || e.dept === filterDept) &&
    (!normalizedSearch || [e.name, e.employeeNumber, e.dept, e.designation].some(value => String(value || '').toLowerCase().includes(normalizedSearch)))
  );

  const counts = {
    present: team.filter(e => e.status === 'present').length,
    late:    team.filter(e => e.status === 'late').length,
    not_arrived: team.filter(e => e.status === 'not_arrived').length,
    absent:  team.filter(e => e.status === 'absent').length,
    leave:   team.filter(e => e.status === 'leave').length,
  };

  return (
    <AppShell title="Monitoring">
      <div className="page-header">
        <div><h4>Employee Monitoring</h4><p>Real-time attendance status, breaks, and alerts</p></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
          <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>Live</span>
        </div>
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Present', key: 'present', color: '#10b981', icon: 'bi-person-check' },
          { label: 'Late',    key: 'late',    color: '#f59e0b', icon: 'bi-clock' },
          { label: 'Not Arrived', key: 'not_arrived', color: '#64748b', icon: 'bi-hourglass-split' },
          { label: 'Absent',  key: 'absent',  color: '#ef4444', icon: 'bi-person-x' },
          { label: 'On Leave',key: 'leave',   color: '#3b82f6', icon: 'bi-calendar-check' },
        ].map(s => (
          <div key={s.key} className="col-6 col-xl">
            <div className="stat-card" style={{ cursor: 'pointer', border: filterStatus === s.key ? `2px solid ${s.color}` : '' }}
              onClick={() => setFilterStatus(filterStatus === s.key ? '' : s.key)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{counts[s.key]}</div>
                </div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {patternFlags.length > 0 && <div className="card p-3 mb-4" style={{ border: '1px solid #fde68a', background: '#fffbeb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><i className="bi bi-flag-fill" style={{ color: '#d97706' }} /><span style={{ fontSize: 14, fontWeight: 750, color: '#92400e' }}>Attendance Pattern Review Flags</span><span style={{ fontSize: 11, color: '#a16207' }}>Evidence-based signals — not disciplinary findings</span></div>
        <div className="row g-2">{patternFlags.map((flag, index) => <div key={`${flag.employee?.userId || flag.employee?._id}-${flag.type}-${index}`} className="col-md-6 col-xl-4"><div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}><div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{flag.employee?.name}</div><div style={{ fontSize: 11.5, color: '#d97706', fontWeight: 700, marginTop: 3 }}>{flag.type}</div><div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>{flag.evidence}</div><div style={{ fontSize: 10.5, color: '#a16207', marginTop: 6 }}>{flag.reviewState}</div></div></div>)}</div>
      </div>}

      {(loading && !refreshing) ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div className="row g-3">
          <div className="col-lg-8">
            <div className="card p-3">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div className="section-title" style={{ margin: 0 }}>Team Status</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ position: 'relative', minWidth: 200, flex: '1 1 200px' }}>
                    <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12 }} />
                    <input className="form-control" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search employees" style={{ paddingLeft: 30, fontSize: 12 }} aria-label="Search employees" />
                  </div>
                  <select className="form-select" style={{ width: 160, fontSize: 12 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                    <option value="">All Departments</option>
                    {depts.map(d => <option key={d}>{d}</option>)}
                  </select>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => fetchData(true)} disabled={refreshing} style={{ fontSize: 12 }}>
                    <i className={`bi ${refreshing ? 'bi-arrow-repeat' : 'bi-arrow-clockwise'}`} /> Refresh
                  </button>
                </div>
              </div>

              {filtered.length === 0 && (
                <div className="empty-state"><i className="bi bi-people" /><h6>{filterStatus || filterDept || searchTerm ? 'No employees match current filters' : 'No employees found'}</h6></div>
              )}

              <div className="row g-2">
                {filtered.map(emp => {
                  const style = STATUS_STYLE[emp.status] || STATUS_STYLE.absent;
                  const activeBreakStyle = emp.onBreak ? breakStyle(emp.activeBreakType) : null;
                  const dotColor = emp.isLoggedOut ? '#64748b' : emp.onBreak ? activeBreakStyle.color : style.color;
                  const breakChips = [];
                  const seenTypes = new Set();
                  for (const b of emp.breaks) {
                    if (b.start && b.end && !seenTypes.has(b.type)) {
                      seenTypes.add(b.type);
                      const total = totalBreakDuration(emp.breaks, b.type);
                      if (total !== '--') breakChips.push({ type: b.type, total, label: emp.breakLabels?.[b.type] || b.type, style: breakStyle(b.type) });
                    }
                  }
                  return (
                    <div key={emp._id} className="col-md-6">
                      <div
                        style={{
                          background: '#f8fafc',
                          border: emp.autoLoggedOut ? '1px solid #f59e0b' : '1px solid #e2e8f0',
                          borderRadius: 12,
                          padding: 14,
                          cursor: isSuperAdmin ? 'pointer' : 'default',
                          transition: 'box-shadow 0.15s',
                        }}
                        onClick={() => isSuperAdmin && setWorkProgressEmp(emp)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ position: 'relative' }}>
                              {emp.avatar && (emp.avatar.startsWith('http') || emp.avatar.startsWith('/')) ? (
                                <img src={emp.avatar} alt={emp.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
                                  {emp.avatar || emp.name?.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: dotColor, border: '2px solid #fff' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.dept}</div>
                              {emp.designation && <div style={{ fontSize: 11, color: '#64748b' }}>{emp.designation}</div>}
                              {emp.employeeNumber && <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{emp.employeeNumber}</div>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                            {emp.isLoggedOut ? (
                              <span className="badge" style={{ background: '#f1f5f9', color: '#64748b', fontSize: 10 }}>
                                <i className="bi bi-box-arrow-right me-1" />Logged Out
                              </span>
                            ) : (
                              <span className="badge" style={{ background: style.bg, color: style.color, fontSize: 10 }}>{style.label}</span>
                            )}
                            {emp.autoLoggedOut && (
                              <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}>
                                <i className="bi bi-clock-history me-1" />Auto Logged Out
                              </span>
                            )}
                            {emp.onBreak && activeBreakStyle && (
                              <span className="badge" style={{ background: activeBreakStyle.bg, color: activeBreakStyle.color, fontSize: 10 }}>
                                <i className={`bi ${activeBreakStyle.icon} me-1`} />{emp.breakLabels?.[emp.activeBreakType] || emp.activeBreakType || 'On Break'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#64748b' }}>
                          <span><i className="bi bi-box-arrow-in-right me-1" />Login: {formatTime(emp.clockIn)}</span>
                          {breakChips.map(c => (
                            <span key={c.type}><i className={`bi ${c.style.icon} me-1`} style={{ color: c.style.color }} />{c.label}: {c.total}</span>
                          ))}
                          <span><i className="bi bi-box-arrow-right me-1" />Logout: {formatTime(emp.clockOut)}</span>
                        </div>
                        {emp.lateFlag && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className="bi bi-exclamation-triangle" />Late login flagged
                          </div>
                        )}
                        {isSuperAdmin && (
                          <div style={{ marginTop: 8, fontSize: 10, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className="bi bi-eye" /> Click to view work progress
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="col-lg-4">
            <div className="card p-3">
              <div className="section-title mb-3">
                <i className="bi bi-bell me-2 text-danger" />Alerts & Flags
              </div>
              {alerts.length === 0
                ? <div className="empty-state" style={{ padding: '20px 0' }}><i className="bi bi-bell" /><h6>No alerts today</h6></div>
                : alerts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: a.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={`bi ${a.icon}`} style={{ color: a.color, fontSize: 13 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.4 }}>{a.text}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{a.time}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Work Progress Modal */}
      {isSuperAdmin && workProgressEmp && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setWorkProgressEmp(null)}>
          <div className="modal-dialog modal-dialog-centered modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-clipboard-data me-2" />{workProgressEmp.name} — Work Progress
                </h5>
                <button className="btn-close" onClick={() => setWorkProgressEmp(null)} />
              </div>
              <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {['not_arrived', 'absent', 'leave'].includes(workProgressEmp.status) ? (
                  <div className="empty-state"><i className="bi bi-person-x" /><h6>No work progress — employee is {workProgressEmp.status}</h6></div>
                ) : workProgressEmp.workProgress.length === 0 ? (
                  <div className="empty-state"><i className="bi bi-journal" /><h6>No work progress entries for today</h6></div>
                ) : (
                  <table className="table table-sm" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Type</th>
                        <th>Task Details</th>
                        <th>Start</th>
                        <th>End</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workProgressEmp.workProgress.map((wp, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>
                            {isBreakType(wp.type) ? (
                              <span className="badge" style={{ background: breakStyle(wp.type).bg, color: breakStyle(wp.type).color, fontSize: 10 }}>
                                {workProgressEmp.breakLabels?.[wp.type] || wp.type}
                              </span>
                            ) : (
                              <span className="badge bg-primary" style={{ fontSize: 10 }}>{wp.type}</span>
                            )}
                          </td>
                          <td style={{ maxWidth: 200, wordBreak: 'break-word' }}>{wp.taskDetails || '—'}</td>
                          <td><Time value={wp.startTime} fallback="—" /></td>
                          <td><Time value={wp.endTime} fallback="—" /></td>
                          <td>{formatTaskDuration(wp)}</td>
                          <td>
                            <span className={`badge ${
                              (wp.status === 'completed' && !wp.carriedForward) ? 'bg-success' :
                              wp.status === 'work_in_progress' ? 'bg-primary' :
                              wp.status === 'task_blocked' ? 'bg-danger' :
                              wp.status === 'stopped' ? 'bg-secondary' : 'bg-warning'
                            }`} style={{ fontSize: 10 }}>
                              {(wp.carriedForward ? 'pending' : wp.status)?.replace(/_/g, ' ') || '—'}
                            </span>
                          </td>
                          <td style={{ maxWidth: 150, wordBreak: 'break-word' }}>{wp.remarks || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setWorkProgressEmp(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
