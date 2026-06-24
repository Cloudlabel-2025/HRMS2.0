'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave', 'Paternity Leave', 'Compensatory Leave', 'Loss of Pay'];
const STATUS_STYLE = {
  pending:  { bg: '#fef3c7', color: '#d97706' },
  approved: { bg: '#dcfce7', color: '#16a34a' },
  rejected: { bg: '#fee2e2', color: '#dc2626' },
  held:     { bg: '#ede9fe', color: '#7c3aed' },
};
const EMPTY_FORM = { type: 'Casual Leave', from: '', to: '', reason: '' };

function ApprovalBadge({ value, holdReason }) {
  const s = STATUS_STYLE[value] || STATUS_STYLE.pending;
  return (
    <span title={value === 'held' && holdReason ? `Hold reason: ${holdReason}` : ''}>
      <span className="badge" style={{ background: s.bg, color: s.color, cursor: value === 'held' ? 'help' : 'default' }}>
        {value}{value === 'held' ? ' ⚠' : ''}
      </span>
    </span>
  );
}

export default function LeavePage() {
  const { user } = useAuth();
  const [leaves, setLeaves]         = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [tab, setTab]               = useState('my');
  const [showModal, setShowModal]   = useState(false);
  const [holdModal, setHoldModal]   = useState(null); // { id, action }
  const [holdReason, setHoldReason] = useState('');
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [loading, setLoading]       = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [toast, setToast]           = useState(null);
  const [fieldErrs, setFieldErrs]   = useState({});
  const fieldErrTimers = typeof window !== 'undefined' ? (window.__leaveErrTimers = window.__leaveErrTimers || {}) : {};
  const setFErrs = (obj) => { setFieldErrs(obj); Object.keys(obj).forEach(k => { if(fieldErrTimers[k]) clearTimeout(fieldErrTimers[k]); fieldErrTimers[k] = setTimeout(() => setFieldErrs(p => { const n={...p}; delete n[k]; return n; }), 10000); }); };
  const clearFErr = (k) => { if(fieldErrTimers[k]) { clearTimeout(fieldErrTimers[k]); delete fieldErrTimers[k]; } setFieldErrs(p => { const n={...p}; delete n[k]; return n; }); };

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin     = ['super_admin', 'admin_full'].includes(user?.role);
  const isTeamLead  = user?.role === 'team_lead';
  const isTeamAdmin = user?.role === 'team_admin';
  const isSme       = user?.role === 'sme';
  const canApprove  = isAdmin || isTeamLead || isTeamAdmin;

  const load = async (scope) => {
    setLoading(true);
    try {
      if (scope === 'my' && isSuperAdmin && selectedEmpId) {
        const [leavesData, empsData] = await Promise.all([
          api.get(`/api/leave?scope=my&userId=${selectedEmpId}`),
          employees.length ? Promise.resolve([]) : api.get('/api/employees'),
        ]);
        setLeaves(Array.isArray(leavesData) ? leavesData : []);
        if (empsData.length) setEmployees(empsData);
      } else {
        const apiScope = scope === 'all' ? 'all' : scope;
        const [leavesData, empsData] = await Promise.all([
          api.get(`/api/leave?scope=${apiScope}`),
          (scope === 'my' && isSuperAdmin && !employees.length) ? api.get('/api/employees') : Promise.resolve([]),
        ]);
        setLeaves(Array.isArray(leavesData) ? leavesData : []);
        if (empsData.length) setEmployees(empsData);
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(tab); }, [user, tab, selectedEmpId]);

  useEffect(() => {
    setFilterStatus('');
    if (tab !== 'my' && isSuperAdmin) setSelectedEmpId('');
  }, [tab]);

  const handleApply = async () => {
    if (!form.from || !form.to || !form.reason) { showToast('Please fill all fields', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/leave', form);
      showToast('Leave application submitted');
      setShowModal(false);
      setForm(EMPTY_FORM);
      load('my');
      setTab('my');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id, action, reason) => {
    try {
      await api.put(`/api/leave/${id}`, { action, ...(reason ? { holdReason: reason } : {}) });
      showToast(`Leave ${action}`);
      setHoldModal(null);
      setHoldReason('');
      load(tab);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const openHold = (id) => { setHoldModal({ id, action: 'held' }); setHoldReason(''); };

  // Who can act on a given leave
  const canActOn = (l) => {
    if (isAdmin)     return l.adminApproval === 'pending' || (l.adminApproval === 'approved' && (l.teamAdminApproval === 'held' || l.tlApproval === 'held' || l.teamAdminApproval === 'rejected' || l.tlApproval === 'rejected'));
    if (isTeamAdmin) return l.adminApproval === 'approved' && l.teamAdminApproval === 'pending';
    if (isTeamLead)  return l.adminApproval === 'approved' && l.tlApproval === 'pending';
    return false;
  };

  // For admin reviewing objections — show override buttons
  const hasObjection = (l) => l.adminApproval === 'approved' && (l.teamAdminApproval === 'held' || l.tlApproval === 'held' || l.teamAdminApproval === 'rejected' || l.tlApproval === 'rejected');

  const selectedEmployee = useMemo(() => employees.find(emp => emp.userId?.toString() === selectedEmpId) || null, [employees, selectedEmpId]);

  const filtered = leaves.filter(l => !filterStatus || l.status === filterStatus);

  const balanceSummary = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave'].map((type, i) => {
    const used = leaves.filter(l => l.type === type && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    return { type, total: [12, 10, 15, 3][i], used };
  });

  return (
    <AppShell title="Leave Management">
      {toast && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div><h4>Leave Management</h4><p>Apply, track, and approve leave requests</p></div>
        {!isSuperAdmin && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <i className="bi bi-plus-lg me-2" />Apply Leave
          </button>
        )}
      </div>

      {isSuperAdmin && tab === 'my' && selectedEmployee && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 20px', background: '#f8fafc', borderRadius: 12, border: '1px solid #f1f5f9' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
            {selectedEmployee.avatar || selectedEmployee.name?.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{selectedEmployee.name}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedEmployee.department}{selectedEmployee.designation ? ` · ${selectedEmployee.designation}` : ''}</div>
          </div>
        </div>
      )}

      {tab === 'my' && (!isSuperAdmin || selectedEmpId) && !isSme && (
        <div className="row g-3 mb-4">
          {balanceSummary.map((b, i) => {
            const avail = b.total - b.used;
            const pct   = Math.min(Math.round((b.used / b.total) * 100), 100);
            const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b'];
            return (
              <div key={i} className="col-6 col-xl-3">
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{b.type}</span>
                    <span style={{ fontSize: 12, color: colors[i], fontWeight: 700 }}>{avail} left</span>
                  </div>
                  <div className="progress mb-2">
                    <div className="progress-bar" style={{ width: `${pct}%`, background: colors[i] }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Used: {b.used}</span><span>Total: {b.total}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'my', label: isSuperAdmin ? 'Employee Leaves' : 'My Leaves' },
          ...(canApprove && !isSme ? [{ key: 'approvals', label: 'Pending Approvals' }] : []),
          ...(isAdmin && !isSme    ? [{ key: 'all',       label: 'All Leaves' }]        : []),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      {isSuperAdmin && tab === 'my' && !selectedEmpId ? (
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Select an Employee</span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{employees.length} employees</span>
          </div>
          {employees.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
          ) : (
            <div style={{ maxHeight: 500, overflow: 'auto' }}>
              {employees.map(emp => (
                <div key={emp._id} onClick={() => emp.userId && setSelectedEmpId(emp.userId.toString())}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                    cursor: 'pointer', borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {emp.avatar || emp.name?.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{emp.name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{emp.department}{emp.designation ? ` · ${emp.designation}` : ''}</div>
                  </div>
                  <i className="bi bi-chevron-right" style={{ color: '#cbd5e1', fontSize: 14 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {tab !== 'approvals' && (
              <select className="form-select" style={{ width: 160, fontSize: 13 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            )}
            {isSuperAdmin && tab === 'my' && selectedEmpId && (
              <button className="btn btn-outline-secondary" style={{ fontSize: 13 }} onClick={() => { setSelectedEmpId(''); setLeaves([]); }}>
                <i className="bi bi-arrow-left me-1" /> Back to Employees
              </button>
            )}
          </div>

          <div className="card">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
            ) : (
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead>
                    <tr>
                      {(tab === 'all' || tab === 'approvals' || (tab === 'my' && selectedEmpId)) && !isSme && <th>Employee</th>}
                      <th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th>
                      {!isSme && <th>Admin</th>}
                      {!isSme && <th>Team Admin</th>}
                      {!isSme && <th>Team Lead</th>}
                      <th>Status</th>
                      {tab === 'approvals' && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={isSme ? 6 : 11}><div className="empty-state"><i className="bi bi-calendar-check" /><h6>No leave records found</h6></div></td></tr>
                    ) : filtered.map(l => (
                      <tr key={l._id} style={hasObjection(l) ? { background: '#fff7ed' } : {}}>
                        {(tab === 'all' || tab === 'approvals' || (tab === 'my' && selectedEmpId)) && !isSme && (
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                                {l.userId?.avatar || l.userId?.name?.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{l.userId?.name}</div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{l.userId?.department}</div>
                              </div>
                            </div>
                          </td>
                        )}
                        <td style={{ fontSize: 13 }}>{l.type}</td>
                        <td style={{ fontSize: 13 }}>{l.from}</td>
                        <td style={{ fontSize: 13 }}>{l.to}</td>
                        <td><span className="badge" style={{ background: '#f1f5f9', color: '#1e293b' }}>{l.days}d</span></td>
                        <td style={{ fontSize: 12, color: '#64748b', maxWidth: 140 }}>{l.reason}</td>
                        {!isSme && <td><ApprovalBadge value={l.adminApproval} holdReason={l.adminHoldReason} /></td>}
                        {!isSme && (
                          <td>
                            <ApprovalBadge value={l.teamAdminApproval} holdReason={l.teamAdminHoldReason} />
                            {l.teamAdminHoldReason && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 2, maxWidth: 120 }}>{l.teamAdminHoldReason}</div>}
                          </td>
                        )}
                        {!isSme && (
                          <td>
                            <ApprovalBadge value={l.tlApproval} holdReason={l.tlHoldReason} />
                            {l.tlHoldReason && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 2, maxWidth: 120 }}>{l.tlHoldReason}</div>}
                          </td>
                        )}
                        <td><span className="badge" style={{ background: STATUS_STYLE[l.status]?.bg, color: STATUS_STYLE[l.status]?.color }}>{l.status}</span></td>
                        {tab === 'approvals' && (
                          <td>
                            {canActOn(l) && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {/* Admin reviewing an objection gets approve/reject only */}
                                {isAdmin && hasObjection(l) ? (
                                  <>
                                    <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleAction(l._id, 'approved')}>Override Approve</button>
                                    <button className="btn btn-sm btn-danger"  style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleAction(l._id, 'rejected')}>Reject</button>
                                  </>
                                ) : (
                                  <>
                                    <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleAction(l._id, 'approved')}>Approve</button>
                                    <button className="btn btn-sm btn-warning"  style={{ fontSize: 11, padding: '3px 8px', color: '#fff' }} onClick={() => openHold(l._id)}>Hold</button>
                                    <button className="btn btn-sm btn-danger"  style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleAction(l._id, 'rejected')}>Reject</button>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Hold Reason Modal */}
      {holdModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Hold Leave — Provide Reason</h5>
                <button className="btn-close" onClick={() => setHoldModal(null)} />
              </div>
              <div className="modal-body">
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                  Your objection reason will be visible to the Admin who approved this leave.
                </p>
                <textarea className="form-control" rows={3} placeholder="Explain why you are holding this leave request..." value={holdReason} onChange={e => setHoldReason(e.target.value)} />
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setHoldModal(null)}>Cancel</button>
                <button className="btn btn-warning" style={{ color: '#fff' }} disabled={!holdReason.trim()} onClick={() => handleAction(holdModal.id, 'held', holdReason)}>
                  Submit Hold
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Apply Leave Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Apply for Leave</h5>
                <button className="btn-close" onClick={() => { setShowModal(false); setFieldErrs({}); }} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Leave Type</label>
                  <select className="form-select" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="row g-3 mb-3">
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>From Date</label>
                    <DateInput className={`form-control ${fieldErrs.from?'is-invalid':''}`} value={form.from} onChange={e => { setForm(p => ({ ...p, from: e.target.value })); clearFErr('from'); }} />
                    {fieldErrs.from && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fieldErrs.from}</div>}
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>To Date</label>
                    <DateInput className={`form-control ${fieldErrs.to?'is-invalid':''}`} value={form.to} onChange={e => { setForm(p => ({ ...p, to: e.target.value })); clearFErr('to'); }} />
                    {fieldErrs.to && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fieldErrs.to}</div>}
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason</label>
                  <textarea className={`form-control ${fieldErrs.reason?'is-invalid':''}`} rows={3} value={form.reason} onChange={e => { setForm(p => ({ ...p, reason: e.target.value })); clearFErr('reason'); }} />
                  {fieldErrs.reason && <div style={{ color:'#ef4444', fontSize:11, marginTop:3, display:'flex', alignItems:'center', gap:4 }}><i className="bi bi-exclamation-circle-fill" style={{ fontSize:10 }} />{fieldErrs.reason}</div>}
                </div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#64748b' }}>
                  <i className="bi bi-info-circle me-2 text-primary" />
                  {isSme
                    ? 'Your leave will be reviewed by the Super Admin. You will be notified once a decision is made.'
                    : 'Approval flow: <strong>Admin</strong> approves first → Team Admin &amp; Team Lead are notified for any objection. Silence = no objection.'
                  }
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleApply} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Submitting...</> : 'Submit Application'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
