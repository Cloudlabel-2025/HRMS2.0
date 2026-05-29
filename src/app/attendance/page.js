'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a', label: 'Present' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent' },
  late:    { bg: '#fef3c7', color: '#d97706', label: 'Late' },
  leave:   { bg: '#dbeafe', color: '#2563eb', label: 'Leave' },
  sunday:  { bg: '#f8fafc', color: '#94a3b8', label: 'Sunday' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function AttendancePage() {
  const { user } = useAuth();
  const [tab, setTab]               = useState('today');
  const [todayRecord, setTodayRecord] = useState(null);
  const [monthly, setMonthly]       = useState([]);
  const [teamToday, setTeamToday]   = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [clockLoading, setClockLoading] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [regRequests, setRegRequests] = useState([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm]       = useState({ date: '', requestedIn: '', requestedOut: '', reason: '' });
  const [regSaving, setRegSaving]   = useState(false);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const isAdmin = ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role);
  const today   = new Date().toISOString().split('T')[0];
  const month   = today.slice(0, 7);

  // Load today's own record
  const loadTodayRecord = async () => {
    try {
      const records = await api.get(`/api/attendance?date=${today}`);
      const mine = Array.isArray(records) ? records.find(r => r.userId?._id === user?._id || r.userId === user?._id) : null;
      setTodayRecord(mine || null);
    } catch {}
  };

  // Load monthly for selected user
  const loadMonthly = async (uid) => {
    try {
      const url = uid ? `/api/attendance?userId=${uid}&month=${month}` : `/api/attendance?month=${month}`;
      const records = await api.get(url);
      setMonthly(Array.isArray(records) ? records : []);
    } catch {}
  };

  // Load team today
  const loadTeamToday = async () => {
    try {
      const records = await api.get(`/api/attendance?date=${today}`);
      setTeamToday(Array.isArray(records) ? records : []);
    } catch {}
  };

  // Load employees list for admin selector
  const loadEmployees = async () => {
    try {
      const emps = await api.get('/api/employees');
      setEmployees(Array.isArray(emps) ? emps : []);
      if (emps.length > 0 && !selectedUserId) setSelectedUserId(emps[0]._id);
    } catch {}
  };

  const loadRegRequests = async (scope) => {
    try {
      const data = await api.get(`/api/attendance/regularize?scope=${scope}`);
      setRegRequests(Array.isArray(data) ? data : []);
    } catch {}
  };

  useEffect(() => {
    if (!user) return;
    Promise.all([
      loadTodayRecord(),
      loadMonthly(isAdmin ? selectedUserId : null),
      isAdmin ? loadTeamToday() : Promise.resolve(),
      isAdmin ? loadEmployees() : Promise.resolve(),
      loadRegRequests(isAdmin ? 'approvals' : 'my'),
    ]).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (selectedUserId) loadMonthly(selectedUserId);
  }, [selectedUserId]);

  const handleClock = async (action) => {
    setClockLoading(true);
    try {
      const result = await api.post('/api/attendance/clock', { action });
      showToast(`Clocked ${action === 'in' ? 'in' : 'out'} at ${result.time}`);
      await loadTodayRecord();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setClockLoading(false);
    }
  };

  const submitRegularization = async () => {
    if (!regForm.date || !regForm.reason) { showToast('Date and reason are required', 'error'); return; }
    setRegSaving(true);
    try {
      await api.post('/api/attendance/regularize', regForm);
      showToast('Regularization request submitted');
      setShowRegModal(false);
      setRegForm({ date: '', requestedIn: '', requestedOut: '', reason: '' });
      loadRegRequests('my');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setRegSaving(false);
    }
  };

  const reviewRegularization = async (id, action) => {
    try {
      await api.put('/api/attendance/regularize', { id, action });
      showToast(`Request ${action}`);
      loadRegRequests('approvals');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const clockedIn  = !!todayRecord?.clockIn;
  const clockedOut = !!todayRecord?.clockOut;

  const presentCount = monthly.filter(r => r.status === 'present').length;
  const lateCount    = monthly.filter(r => r.status === 'late').length;
  const absentCount  = monthly.filter(r => r.status === 'absent').length;
  const leaveCount   = monthly.filter(r => r.status === 'leave').length;

  const formatMins = (mins) => mins ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '--';

  return (
    <AppShell title="Attendance">
      {toast && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div><h4>Time & Attendance</h4><p>Track daily attendance, shifts, and working hours</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!clockedIn && !clockedOut && (
            <button className="btn btn-success" onClick={() => handleClock('in')} disabled={clockLoading} style={{ fontWeight: 600 }}>
              {clockLoading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-play-circle me-2" />}Clock In
            </button>
          )}
          {clockedIn && !clockedOut && (
            <button className="btn btn-danger" onClick={() => handleClock('out')} disabled={clockLoading} style={{ fontWeight: 600 }}>
              {clockLoading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-stop-circle me-2" />}Clock Out
            </button>
          )}
        </div>
      </div>

      {/* Status cards */}
      <div className="row g-3 mb-4">
        {[
          { label: 'Status',       value: clockedOut ? 'Completed' : clockedIn ? 'Clocked In' : 'Not Clocked In', icon: 'bi-circle-fill', color: clockedOut ? '#8b5cf6' : clockedIn ? '#10b981' : '#94a3b8' },
          { label: 'Clock In',     value: todayRecord?.clockIn  || '--:--', icon: 'bi-box-arrow-in-right', color: '#3b82f6' },
          { label: 'Clock Out',    value: todayRecord?.clockOut || '--:--', icon: 'bi-box-arrow-right',    color: '#f59e0b' },
          { label: 'Hours Today',  value: todayRecord?.hoursWorked ? formatMins(todayRecord.hoursWorked) : '--', icon: 'bi-clock', color: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{s.value}</div>
                </div>
                <div className="stat-icon" style={{ background: s.color + '15' }}>
                  <i className={`bi ${s.icon}`} style={{ color: s.color }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['today', 'monthly', ...(isAdmin ? ['team'] : []), 'regularize'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'today' ? "Today's View" : t === 'monthly' ? 'Monthly View' : t === 'team' ? 'Team View' : 'Regularize'}
          </button>
        ))}
      </div>

      {/* Today tab */}
      {tab === 'today' && (
        <div className="card p-4">
          {todayRecord ? (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Today — {today}</div>
              <div className="row g-3">
                {[
                  ['Status',    <span className="badge" style={{ background: STATUS_STYLE[todayRecord.status]?.bg, color: STATUS_STYLE[todayRecord.status]?.color }}>{STATUS_STYLE[todayRecord.status]?.label || todayRecord.status}</span>],
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
              {todayRecord.lateFlag && (
                <div className="alert alert-warning mt-3 py-2" style={{ fontSize: 13 }}>
                  <i className="bi bi-exclamation-triangle me-2" />Late login detected — flagged automatically
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <i className="bi bi-clock" />
              <h6>No attendance record for today</h6>
              <p>Click "Clock In" to mark your attendance</p>
            </div>
          )}
        </div>
      )}

      {/* Monthly tab */}
      {tab === 'monthly' && (
        <div>
          {isAdmin && employees.length > 0 && (
            <div className="mb-3">
              <select className="form-select" style={{ width: 240, fontSize: 13 }} value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                {employees.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}
              </select>
            </div>
          )}
          <div className="row g-3 mb-3">
            {[['Present', presentCount, '#10b981'], ['Late', lateCount, '#f59e0b'], ['Absent', absentCount, '#ef4444'], ['On Leave', leaveCount, '#3b82f6']].map(([l, v, c]) => (
              <div key={l} className="col-6 col-md-3">
                <div className="stat-card" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: c }}>{v}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{l}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            {loading ? <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div> : (
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Date</th><th>Day</th><th>Status</th><th>Clock In</th><th>Clock Out</th><th>Hours</th></tr></thead>
                  <tbody>
                    {monthly.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-calendar2" /><p>No records for this month</p></div></td></tr>
                    ) : monthly.map(row => {
                      const d = new Date(row.date);
                      const style = STATUS_STYLE[row.status] || STATUS_STYLE.present;
                      return (
                        <tr key={row._id}>
                          <td style={{ fontSize: 13 }}>{row.date}</td>
                          <td style={{ fontSize: 13, color: '#64748b' }}>{DAYS[d.getDay()]}</td>
                          <td><span className="badge" style={{ background: style.bg, color: style.color }}>{style.label}</span></td>
                          <td style={{ fontSize: 13 }}>{row.clockIn  || '—'}</td>
                          <td style={{ fontSize: 13 }}>{row.clockOut || '—'}</td>
                          <td style={{ fontSize: 13 }}>{row.hoursWorked ? formatMins(row.hoursWorked) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Regularize tab */}
      {tab === 'regularize' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{isAdmin ? 'Pending Regularization Requests' : 'My Regularization Requests'}</span>
            {!isAdmin && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowRegModal(true)}>
                <i className="bi bi-plus-lg me-1" />New Request
              </button>
            )}
          </div>
          <div className="card">
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
                  {regRequests.length === 0 ? (
                    <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-clock-history" /><p>No regularization requests</p></div></td></tr>
                  ) : regRequests.map(r => (
                    <tr key={r._id}>
                      {isAdmin && (
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{r.userId?.avatar}</div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</span>
                          </div>
                        </td>
                      )}
                      <td style={{ fontSize: 13 }}>{r.date}</td>
                      <td style={{ fontSize: 13 }}>{r.requestedIn || '—'}</td>
                      <td style={{ fontSize: 13 }}>{r.requestedOut || '—'}</td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160 }}>{r.reason}</td>
                      <td>
                        <span className={`badge ${r.status === 'approved' ? 'status-approved' : r.status === 'rejected' ? 'status-rejected' : 'status-pending'}`}>{r.status}</span>
                      </td>
                      {isAdmin && r.status === 'pending' && (
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => reviewRegularization(r._id, 'approved')}>Approve</button>
                            <button className="btn btn-sm btn-danger"  style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => reviewRegularization(r._id, 'rejected')}>Reject</button>
                          </div>
                        </td>
                      )}
                      {isAdmin && r.status !== 'pending' && <td />}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showRegModal && (
            <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header"><h5 className="modal-title">Regularization Request</h5><button className="btn-close" onClick={() => setShowRegModal(false)} /></div>
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

      {/* Team tab */}
      {tab === 'team' && isAdmin && (
        <div className="card">
          {loading ? <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div> : (
            <div className="table-responsive">
              <table className="table mb-0">
                <thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Flag</th></tr></thead>
                <tbody>
                  {teamToday.length === 0 ? (
                    <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-people" /><p>No attendance records for today</p></div></td></tr>
                  ) : teamToday.map(row => {
                    const style = STATUS_STYLE[row.status] || STATUS_STYLE.present;
                    return (
                      <tr key={row._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                              {row.userId?.avatar || row.userId?.name?.slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{row.userId?.name || '—'}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: 13, color: '#64748b' }}>{row.userId?.department || '—'}</td>
                        <td><span className="badge" style={{ background: style.bg, color: style.color }}>{style.label}</span></td>
                        <td style={{ fontSize: 13 }}>{row.clockIn  || '—'}</td>
                        <td style={{ fontSize: 13 }}>{row.clockOut || '—'}</td>
                        <td style={{ fontSize: 13 }}>{row.hoursWorked ? formatMins(row.hoursWorked) : '—'}</td>
                        <td>{row.lateFlag && <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}><i className="bi bi-exclamation-triangle me-1" />Late</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
