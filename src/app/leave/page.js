'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';
import Pagination from '@/components/Pagination';

const STATUS_STYLE = {
  pending:  { bg: '#fef3c7', color: '#d97706' },
  approved: { bg: '#dcfce7', color: '#16a34a' },
  rejected: { bg: '#fee2e2', color: '#dc2626' },
  held:     { bg: '#ede9fe', color: '#7c3aed' },
};
const EMPTY_FORM = { typeId: '', from: '', to: '', reason: '', halfDay: false, documents: [] };

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
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [balanceData, setBalanceData] = useState(null);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [tab, setTab]               = useState('my');
  const [showModal, setShowModal]   = useState(false);
  const [holdModal, setHoldModal]   = useState(null);
  const [holdReason, setHoldReason] = useState('');
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [loading, setLoading]       = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [toast, setToast]           = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, tab, selectedEmpId]);
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

  const targetUserId = useMemo(() => {
    if (tab === 'my' && isSuperAdmin && selectedEmpId) return selectedEmpId;
    return null;
  }, [tab, isSuperAdmin, selectedEmpId]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      api.get('/api/settings/leave-types').then(d => setLeaveTypes(Array.isArray(d) ? d : [])).catch(() => {}),
      api.get('/api/leave/balance').then(d => setBalanceData(d)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (user && targetUserId) {
      api.get(`/api/leave/balance?userId=${targetUserId}`).then(d => setBalanceData(d)).catch(() => {});
    } else if (user && tab === 'my') {
      api.get('/api/leave/balance').then(d => setBalanceData(d)).catch(() => {});
    }
  }, [targetUserId, tab]);

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
    if (!form.typeId || !form.from || !form.to || !form.reason) { showToast('Please fill all fields', 'error'); return; }
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

  const canActOn = (l) => {
    if (l.workflowApprovals?.length > 0) {
      const pendingStep = l.workflowApprovals.find(s => s.action === 'pending');
      if (!pendingStep) {
        const heldStep = l.workflowApprovals.find(s => s.action === 'held' || s.action === 'rejected');
        return !!heldStep && isAdmin;
      }
      return true;
    }
    if (isAdmin)     return l.adminApproval === 'pending' || (l.adminApproval === 'approved' && (l.teamAdminApproval === 'held' || l.tlApproval === 'held' || l.teamAdminApproval === 'rejected' || l.tlApproval === 'rejected'));
    if (isTeamAdmin) return l.adminApproval === 'approved' && l.teamAdminApproval === 'pending';
    if (isTeamLead)  return l.adminApproval === 'approved' && l.tlApproval === 'pending';
    return false;
  };

  const hasObjection = (l) => l.adminApproval === 'approved' && (l.teamAdminApproval === 'held' || l.tlApproval === 'held' || l.teamAdminApproval === 'rejected' || l.tlApproval === 'rejected');

  const selectedEmployee = useMemo(() => employees.find(emp => emp.userId?.toString() === selectedEmpId) || null, [employees, selectedEmpId]);

  const filtered = leaves.filter(l => !filterStatus || l.status === filterStatus);

  const typeMap = useMemo(() => {
    const m = {};
    leaveTypes.forEach(t => { m[t._id] = t; });
    return m;
  }, [leaveTypes]);

  const workflowColumns = useMemo(() => {
    if (!leaves.length) return ['Admin', 'Team Admin', 'Team Lead'];
    const l = leaves.find(x => x.workflowApprovals?.length > 0);
    if (l?.workflowApprovals) {
      return l.workflowApprovals.map(s => s.label || `Step ${s.step}`);
    }
    return ['Admin', 'Team Admin', 'Team Lead'];
  }, [leaves]);

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

      {tab === 'my' && (!isSuperAdmin || selectedEmpId) && !isSme && balanceData?.balances && (
        <div className="row g-3 mb-4">
          {balanceData.balances.map(b => {
            const lt = typeMap[b.typeId?._id || b.typeId];
            const available = b.allocated + b.carriedForward - b.used - b.pending;
            const total = b.allocated + b.carriedForward;
            const pct = total > 0 ? Math.min(Math.round(((b.used + b.pending) / total) * 100), 100) : 0;
            const color = lt?.color || '#3b82f6';

            // Find matching config for period cap details
            const cfg = balanceData.policy?.leaveTypeConfigs?.find(
              c => c.typeId === (b.typeId?._id || b.typeId)
            );
            let periodText = null;
            if (cfg && cfg.maxUsagePerPeriod > 0) {
              const unit = cfg.usagePeriod || 'annual';
              const now = new Date();
              const cycleStart = new Date(balanceData.cycleStart || new Date(now.getFullYear(), 0, 1));
              const monthsDiff = (now.getFullYear() - cycleStart.getFullYear()) * 12 + now.getMonth() - cycleStart.getMonth();
              let periodCode = 'A0';
              if (unit === 'monthly') periodCode = `M${monthsDiff}`;
              else if (unit === 'quarterly') periodCode = `Q${Math.floor(monthsDiff / 3)}`;
              else if (unit === 'half_yearly') periodCode = `H${Math.floor(monthsDiff / 6)}`;

              const periodUsageEntry = b.periodUsage?.find(p => p.periodCode === periodCode);
              const periodUsed = periodUsageEntry ? (periodUsageEntry.used + periodUsageEntry.pending) : 0;
              const periodLeft = Math.max(0, cfg.maxUsagePerPeriod - periodUsed);
              periodText = `${periodLeft} left of ${cfg.maxUsagePerPeriod} this ${unit.replace('_', '-')}`;
            }

            return (
              <div key={b.typeId?._id || b.typeId} className="col-6 col-xl-3">
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                      <span className="badge me-1" style={{ background: color, color: '#fff', fontSize: 10 }}>{lt?.code || '?'}</span>
                      {lt?.name || 'Unknown'}
                    </span>
                    <span style={{ fontSize: 12, color, fontWeight: 700 }}>{available} left</span>
                  </div>
                  <div className="progress mb-2">
                    <div className="progress-bar" style={{ width: `${pct}%`, background: color }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                    <span>Used: {b.used}{b.pending > 0 ? ` (+${b.pending})` : ''}</span>
                    <span>Total: {total}</span>
                  </div>
                  {b.carriedForward > 0 && (
                    <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 2 }}>
                      Carry fwd: +{b.carriedForward}
                    </div>
                  )}
                  {periodText && (
                    <div style={{ fontSize: 10, color: '#0ea5e9', marginTop: 4, borderTop: '1px dashed #e2e8f0', paddingTop: 4 }}>
                      <i className="bi bi-hourglass-split me-1" />{periodText}
                    </div>
                  )}
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
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}
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
                      {!isSme && workflowColumns.map((col, i) => <th key={i}>{col}</th>)}
                      {isSme && <th>Admin</th>}
                      <th>Status</th>
                      {tab === 'approvals' && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={isSme ? 7 : 12}><div className="empty-state"><i className="bi bi-calendar-check" /><h6>No leave records found</h6></div></td></tr>
                    ) : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(l => (
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
                        <td style={{ fontSize: 13 }}>
                          {l.typeId ? (
                            <span className="badge" style={{ background: typeMap[l.typeId]?.color || '#e2e8f0', color: '#fff' }}>
                              {typeMap[l.typeId]?.code || l.type}
                            </span>
                          ) : l.type}
                          {l.halfDay && <span className="badge ms-1" style={{ background: '#fef3c7', color: '#d97706' }}>½</span>}
                        </td>
                        <td style={{ fontSize: 13 }}>{l.from}</td>
                        <td style={{ fontSize: 13 }}>{l.to}</td>
                        <td><span className="badge" style={{ background: '#f1f5f9', color: '#1e293b' }}>{l.days}d</span></td>
                        <td style={{ fontSize: 12, color: '#64748b', maxWidth: 140 }}>{l.reason}</td>
                        {isSme ? (
                          <td><ApprovalBadge value={l.adminApproval} holdReason={l.adminHoldReason} /></td>
                        ) : l.workflowApprovals?.length > 0 ? (
                          l.workflowApprovals.map(s => (
                            <td key={s.step}>
                              <ApprovalBadge value={s.action} holdReason={s.holdReason} />
                              {s.holdReason && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 2, maxWidth: 120 }}>{s.holdReason}</div>}
                            </td>
                          ))
                        ) : (
                          <>
                            <td><ApprovalBadge value={l.adminApproval} holdReason={l.adminHoldReason} /></td>
                            <td>
                              <ApprovalBadge value={l.teamAdminApproval} holdReason={l.teamAdminHoldReason} />
                              {l.teamAdminHoldReason && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 2, maxWidth: 120 }}>{l.teamAdminHoldReason}</div>}
                            </td>
                            <td>
                              <ApprovalBadge value={l.tlApproval} holdReason={l.tlHoldReason} />
                              {l.tlHoldReason && <div style={{ fontSize: 10, color: '#7c3aed', marginTop: 2, maxWidth: 120 }}>{l.tlHoldReason}</div>}
                            </td>
                          </>
                        )}
                        <td><span className="badge" style={{ background: STATUS_STYLE[l.status]?.bg, color: STATUS_STYLE[l.status]?.color }}>{l.status}</span></td>
                        {tab === 'approvals' && (
                          <td>
                            {canActOn(l) && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
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
            {!loading && filtered.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(filtered.length / pageSize)}
                onPageChange={setCurrentPage}
                totalItems={filtered.length}
                pageSize={pageSize}
              />
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
                  Your objection reason will be visible to the approving authority.
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
                  {leaveTypes.filter(t => t.isActive && (!balanceData?.balances || balanceData.balances.some(b => (b.typeId?._id || b.typeId) === t._id))).length === 0 ? (
                    <div className="alert alert-warning py-2 px-3 m-0" style={{ fontSize: 12 }}>
                      <i className="bi bi-exclamation-triangle-fill me-2" />
                      No leave types are available. This happens if you have no active leave policy assigned to your role, or if you do not meet the eligibility rules of any leave types.
                    </div>
                  ) : (
                    <select className="form-select" value={form.typeId} onChange={e => { const t = leaveTypes.find(x => x._id === e.target.value); setForm(p => ({ ...p, typeId: e.target.value, halfDay: false })); }}>
                      <option value="">— Select —</option>
                      {leaveTypes
                        .filter(t => t.isActive && (!balanceData?.balances || balanceData.balances.some(b => (b.typeId?._id || b.typeId) === t._id)))
                        .map(t => (
                          <option key={t._id} value={t._id}>
                            {t.code} — {t.name}
                          </option>
                        ))
                      }
                    </select>
                  )}
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
                    : 'Leave policy will determine the approval workflow and available balance.'
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
