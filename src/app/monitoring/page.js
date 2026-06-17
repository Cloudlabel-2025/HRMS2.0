'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import { getAttendanceDate } from '@/lib/attendance-date';

const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a', label: 'Present', icon: 'bi-check-circle' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent',  icon: 'bi-x-circle' },
  late:    { bg: '#fef3c7', color: '#d97706', label: 'Late',    icon: 'bi-clock' },
  leave:   { bg: '#dbeafe', color: '#2563eb', label: 'On Leave',icon: 'bi-calendar-check' },
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
  const [team, setTeam] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [departments, setDepartments] = useState([]);
  const [workProgressEmp, setWorkProgressEmp] = useState(null);

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
        api.get('/api/leave?status=approved'),
      ]);

      const attArr = [
        ...(Array.isArray(attendanceToday) ? attendanceToday : []),
        ...(Array.isArray(attendanceYest) ? attendanceYest : []),
      ];
      const leaveArr = Array.isArray(leaves) ? leaves : [];

      const attMap = {};
      for (const r of attArr) {
        const uid = r.userId?._id?.toString() || r.userId?.toString();
        // Keep the latest record per user (prefer the one matching their shift-aware date)
        if (uid) attMap[uid] = r;
      }

      const onLeaveIds = new Set(
        leaveArr
          .filter(l => l.from <= calToday && l.to >= calToday)
          .map(l => l.userId?._id?.toString() || l.userId?.toString())
      );

      const empMap = {};
      for (const emp of employees) {
        const uid = emp.userId?.toString();
        if (!uid) continue;

        // Determine this employee's shift-aware today
        const empShiftName = emp.shift || 'Morning (9AM-6PM)';
        const matchedShift = allShifts.find(s => s.name === empShiftName);
        const empToday = (matchedShift?.startTime && matchedShift?.endTime)
          ? getAttendanceDate(now, matchedShift.startTime, matchedShift.endTime)
          : calToday;

        const attRecord = attMap[uid];
        const isOnLeave = onLeaveIds.has(uid);

        let status = 'absent';
        let clockIn = '—';
        let clockOut = '—';
        let breaks = [];
        let workProgress = [];
        let lateFlag = false;
        let onBreak = false;
        let onLunch = false;

        if (isOnLeave) {
          status = 'leave';
        } else if (attRecord) {
          status = attRecord.status || 'present';
          clockIn = attRecord.clockIn || '—';
          clockOut = attRecord.clockOut || '—';
          lateFlag = attRecord.lateFlag === true;
          breaks = Array.isArray(attRecord.breaks) ? attRecord.breaks : [];
          workProgress = Array.isArray(attRecord.workProgress) ? attRecord.workProgress : [];
          onBreak = breaks.some(b => b.type === 'break' && b.start && !b.end);
          onLunch = breaks.some(b => b.type === 'lunch' && b.start && !b.end);
        }

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
          onLunch,
        };
      }

      const teamArr = Object.values(empMap);

      const alertList = [];
      for (const emp of teamArr) {
        if (emp.lateFlag) alertList.push({ type: 'late', icon: 'bi-clock', color: '#f59e0b', text: `${emp.name} logged in late (${emp.clockIn})`, time: emp.clockIn });
      }

      setTeam(teamArr);
      setAlerts(alertList.slice(0, 10));
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
  const filtered = team.filter(e =>
    (!filterStatus || e.status === filterStatus) &&
    (!filterDept   || e.dept === filterDept)
  );

  const counts = {
    present: team.filter(e => e.status === 'present').length,
    late:    team.filter(e => e.status === 'late').length,
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
          { label: 'Absent',  key: 'absent',  color: '#ef4444', icon: 'bi-person-x' },
          { label: 'On Leave',key: 'leave',   color: '#3b82f6', icon: 'bi-calendar-check' },
        ].map(s => (
          <div key={s.key} className="col-6 col-xl-3">
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

      {(loading && !refreshing) ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div className="row g-3">
          <div className="col-lg-8">
            <div className="card p-3">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div className="section-title" style={{ margin: 0 }}>Team Status</div>
                <div style={{ display: 'flex', gap: 8 }}>
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
                <div className="empty-state"><i className="bi bi-people" /><h6>{filterStatus || filterDept ? 'No employees match current filters' : 'No employees found'}</h6></div>
              )}

              <div className="row g-2">
                {filtered.map(emp => {
                  const style = STATUS_STYLE[emp.status] || STATUS_STYLE.absent;
                  const breakTotal = totalBreakDuration(emp.breaks, 'break');
                  const lunchTotal = totalBreakDuration(emp.breaks, 'lunch');
                  return (
                    <div key={emp._id} className="col-md-6">
                      <div
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
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
                              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: style.color, border: '2px solid #fff' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.dept}</div>
                              {emp.designation && <div style={{ fontSize: 11, color: '#64748b' }}>{emp.designation}</div>}
                              {emp.employeeNumber && <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{emp.employeeNumber}</div>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                            <span className="badge" style={{ background: style.bg, color: style.color, fontSize: 10 }}>{style.label}</span>
                            {emp.onBreak && (
                              <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}>On Break</span>
                            )}
                            {emp.onLunch && (
                              <span className="badge" style={{ background: '#dbeafe', color: '#2563eb', fontSize: 10 }}>On Lunch</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: '#64748b' }}>
                          <span><i className="bi bi-box-arrow-in-right me-1" />Login: {emp.clockIn}</span>
                          <span><i className="bi bi-cup-hot me-1" />Break: {breakTotal}</span>
                          <span><i className="bi bi-egg-fried me-1" />Lunch: {lunchTotal}</span>
                          <span><i className="bi bi-box-arrow-right me-1" />Logout: {emp.clockOut}</span>
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
                {workProgressEmp.status === 'absent' || workProgressEmp.status === 'leave' ? (
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
                        <th>Status</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workProgressEmp.workProgress.map((wp, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><span className={`badge ${wp.type === 'break' ? 'bg-warning' : wp.type === 'lunch' ? 'bg-info' : 'bg-primary'}`} style={{ fontSize: 10 }}>{wp.type}</span></td>
                          <td style={{ maxWidth: 200, wordBreak: 'break-word' }}>{wp.taskDetails || '—'}</td>
                          <td>{wp.startTime || '—'}</td>
                          <td>{wp.endTime || '—'}</td>
                          <td>
                            <span className={`badge ${
                              wp.status === 'completed' ? 'bg-success' :
                              wp.status === 'work_in_progress' ? 'bg-primary' :
                              wp.status === 'task_blocked' ? 'bg-danger' :
                              wp.status === 'stopped' ? 'bg-secondary' : 'bg-warning'
                            }`} style={{ fontSize: 10 }}>
                              {wp.status?.replace(/_/g, ' ') || '—'}
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
