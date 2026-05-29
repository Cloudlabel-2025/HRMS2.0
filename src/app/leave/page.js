'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave', 'Compensatory Leave'];
const STATUS_STYLE = {
  pending:  { bg: '#fef3c7', color: '#d97706' },
  approved: { bg: '#dcfce7', color: '#16a34a' },
  rejected: { bg: '#fee2e2', color: '#dc2626' },
};
const EMPTY_FORM = { type: 'Casual Leave', from: '', to: '', reason: '' };

export default function LeavePage() {
  const { user } = useAuth();
  const [leaves, setLeaves]     = useState([]);
  const [tab, setTab]           = useState('my');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [toast, setToast]       = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const isAdmin      = ['super_admin', 'admin_full'].includes(user?.role);
  const isTeamLead   = user?.role === 'team_lead';
  const isTeamAdmin  = user?.role === 'team_admin';
  const canApprove   = isAdmin || isTeamLead || isTeamAdmin;

  const load = async (scope) => {
    setLoading(true);
    try {
      const data = await api.get(`/api/leave?scope=${scope}`);
      setLeaves(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(tab); }, [user, tab]);

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

  const handleApprove = async (id, action) => {
    try {
      await api.put(`/api/leave/${id}`, { action });
      showToast(`Leave ${action}`);
      load(tab);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const filtered = leaves.filter(l => !filterStatus || l.status === filterStatus);

  const balanceSummary = LEAVE_TYPES.slice(0, 4).map((type, i) => {
    const used = leaves.filter(l => l.type === type && l.status === 'approved').reduce((s, l) => s + l.days, 0);
    return { type, total: [12, 10, 15, 3][i], used };
  });

  const showApprovalActions = tab === 'approvals';

  // Determine what each approver can act on
  const canActOn = (l) => {
    if (isTeamAdmin) return l.teamAdminApproval === 'pending';
    if (isTeamLead)  return l.teamAdminApproval === 'approved' && l.tlApproval === 'pending';
    if (isAdmin)     return l.tlApproval === 'approved' && l.mgmtApproval === 'pending';
    return false;
  };

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
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <i className="bi bi-plus-lg me-2" />Apply Leave
        </button>
      </div>

      {tab === 'my' && (
        <div className="row g-3 mb-4">
          {balanceSummary.map((b, i) => {
            const avail = b.total - b.used;
            const pct   = Math.round((b.used / b.total) * 100);
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
          { key: 'my',        label: 'My Leaves' },
          ...(canApprove ? [{ key: 'approvals', label: 'Pending Approvals' }] : []),
          ...(isAdmin    ? [{ key: 'all',       label: 'All Leaves' }]        : []),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select className="form-select" style={{ width: 160, fontSize: 13 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  {(tab === 'all' || tab === 'approvals') && <th>Employee</th>}
                  <th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th>
                  <th>Team Admin</th><th>Team Lead</th><th>Mgmt</th><th>Status</th>
                  {showApprovalActions && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={11}><div className="empty-state"><i className="bi bi-calendar-check" /><h6>No leave records found</h6></div></td></tr>
                ) : filtered.map(l => (
                  <tr key={l._id}>
                    {(tab === 'all' || tab === 'approvals') && (
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
                    <td><span className="badge" style={{ background: STATUS_STYLE[l.teamAdminApproval]?.bg, color: STATUS_STYLE[l.teamAdminApproval]?.color }}>{l.teamAdminApproval}</span></td>
                    <td><span className="badge" style={{ background: STATUS_STYLE[l.tlApproval]?.bg, color: STATUS_STYLE[l.tlApproval]?.color }}>{l.tlApproval}</span></td>
                    <td><span className="badge" style={{ background: STATUS_STYLE[l.mgmtApproval]?.bg, color: STATUS_STYLE[l.mgmtApproval]?.color }}>{l.mgmtApproval}</span></td>
                    <td><span className="badge" style={{ background: STATUS_STYLE[l.status]?.bg, color: STATUS_STYLE[l.status]?.color }}>{l.status}</span></td>
                    {showApprovalActions && (
                      <td>
                        {canActOn(l) && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleApprove(l._id, 'approved')}>Approve</button>
                            <button className="btn btn-sm btn-danger"  style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleApprove(l._id, 'rejected')}>Reject</button>
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

      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Apply for Leave</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
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
                    <input type="date" className="form-control" value={form.from} onChange={e => setForm(p => ({ ...p, from: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>To Date</label>
                    <input type="date" className="form-control" value={form.to} onChange={e => setForm(p => ({ ...p, to: e.target.value }))} />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason</label>
                  <textarea className="form-control" rows={3} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
                </div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#64748b' }}>
                  <i className="bi bi-info-circle me-2 text-primary" />Approval flow: You → Team Admin → Team Lead → Admin
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
