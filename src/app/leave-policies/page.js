'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const TABS = [
  { key: 'types',    label: 'Leave Types',    icon: 'bi-tags' },
  { key: 'policies', label: 'Policies',       icon: 'bi-file-earmark-text' },
  { key: 'balances', label: 'Balances',       icon: 'bi-pie-chart' },
];

const ADMIN_ROLES = ['super_admin', 'admin_full'];

function Label({ text, color }) {
  return <span className="badge me-1" style={{ background: color || '#e2e8f0', color: '#fff', fontSize: 11 }}>{text}</span>;
}

export default function LeavePoliciesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('types');
  const [types, setTypes] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [balances, setBalances] = useState(null);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showModal, setShowModal] = useState(null);
  const [modalForm, setModalForm] = useState({});

  // Policy editor state
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [policyForm, setPolicyForm] = useState(null);
  const [editorTab, setEditorTab] = useState('general');
  const [expandedType, setExpandedType] = useState(null);
  const [adjModal, setAdjModal] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isAdmin = ADMIN_ROLES.includes(user?.role);

  const loadTypes = async () => {
    try {
      const data = await api.get('/api/settings/leave-types');
      setTypes(Array.isArray(data) ? data : []);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const loadPolicies = async () => {
    try {
      const data = await api.get('/api/settings/leave-policies');
      setPolicies(Array.isArray(data) ? data : []);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const loadEmployees = async () => {
    try {
      const data = await api.get('/api/employees');
      setEmployees(Array.isArray(data) ? data : []);
    } catch (e) {}
  };

  const loadBalance = async (empId) => {
    try {
      const data = await api.get(`/api/leave/balance?userId=${empId}`);
      setBalances(data);
    } catch (e) {
      showToast(e.message, 'error');
      setBalances(null);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    setLoading(true);
    Promise.all([loadTypes(), loadPolicies(), loadEmployees()]).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (tab === 'balances' && selectedEmpId) loadBalance(selectedEmpId);
  }, [tab, selectedEmpId]);

  if (!user) return null;
  if (!isAdmin) {
    return (
      <AppShell title="Leave Policies">
        <div className="empty-state"><i className="bi bi-lock" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>Only Super Admin and Admin can access this page.</p></div>
      </AppShell>
    );
  }

  // ── Leave Type CRUD ──
  const saveType = async (body) => {
    setSaving(true);
    try {
      if (body._id) {
        await api.put('/api/settings/leave-types', body);
      } else {
        await api.post('/api/settings/leave-types', body);
      }
      showToast('Leave type saved');
      setShowModal(null);
      loadTypes();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const deleteType = async (id) => {
    if (!confirm('Deactivate this leave type? Existing leave records will be preserved.')) return;
    try {
      await api.delete('/api/settings/leave-types', { id });
      showToast('Leave type deactivated');
      loadTypes();
    } catch (e) { showToast(e.message, 'error'); }
  };

  // ── Policy CRUD ──
  const savePolicy = async () => {
    if (!policyForm?.name?.trim()) { showToast('Policy name is required', 'error'); return; }
    setSaving(true);
    try {
      if (policyForm._id) {
        await api.put(`/api/settings/leave-policies/${policyForm._id}`, policyForm);
      } else {
        await api.post('/api/settings/leave-policies', policyForm);
      }
      showToast('Policy saved');
      setEditingPolicy(null);
      setPolicyForm(null);
      loadPolicies();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const archivePolicy = async (id) => {
    if (!confirm('Archive this policy? It will no longer be applied to new leave requests.')) return;
    try {
      await api.delete(`/api/settings/leave-policies/${id}`);
      showToast('Policy archived');
      loadPolicies();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const openPolicyEditor = (policy = null) => {
    if (policy) {
      setPolicyForm(JSON.parse(JSON.stringify(policy)));
    } else {
      setPolicyForm({
        name: '', description: '', isDefault: false, status: 'active',
        effectiveFrom: new Date().toISOString().split('T')[0],
        effectiveTo: null,
        applicableRoles: [], applicableDepartments: [], applicableEmploymentTypes: [],
        requireProbationCompletion: false, genderRestriction: 'all',
        leaveTypeConfigs: types.filter(t => t.isActive).map(t => ({
          typeId: t._id, enabled: true, annualAllocation: 0, isPaid: true,
          maxConsecutiveDays: 0, minGapDays: 0, requiresDocuments: false,
          allowHalfDay: false, genderRestriction: 'all',
          carryForwardAllowed: false, carryForwardMaxDays: 0, carryForwardExpiryMonths: 0,
          encashmentAllowed: false, encashmentMaxDays: 0, encashmentRatePercent: 100,
          probationAllowed: true, probationAllocation: 0,
          accrualMode: 'upfront', prorateForNewJoiners: false, 
          noticePeriodDays: 0, requireDocsIfConsecutiveDays: 0,
        })),
        approvalWorkflow: [
          { step: 1, label: 'Admin', approverRoles: ['super_admin', 'admin_full'], actionType: 'approve', required: true, escalateAfterHours: 0 },
        ],
        maxPendingApplications: 1, countWeekends: false, countHolidays: false,
      });
    }
    setEditorTab('general');
    setExpandedType(null);
    setEditingPolicy(true);
  };

  const workflowStepDefaults = { step: 1, label: '', approverRoles: [], actionType: 'approve', required: true, escalateAfterHours: 0 };

  if (editingPolicy && policyForm) {
    return (
      <AppShell title={policyForm._id ? 'Edit Policy' : 'New Policy'}>
        {toast && (
          <div className="toast-container-custom">
            <div className={'toast-custom ' + toast.type}>
              <i className={'bi ' + (toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle') + ' me-2'} />{toast.msg}
            </div>
          </div>
        )}
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <button className="btn btn-outline-secondary btn-sm me-3" onClick={() => { setEditingPolicy(null); setPolicyForm(null); }}>
                <i className="bi bi-arrow-left me-1" /> Back
              </button>
              <span style={{ fontWeight: 700, fontSize: 18 }}>{policyForm._id ? 'Edit' : 'New'} Leave Policy</span>
            </div>
            <button className="btn btn-primary" onClick={savePolicy} disabled={saving}>
              {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : <><i className="bi bi-check-lg me-2" />Save Policy</>}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 16, marginBottom: 24, borderBottom: '1px solid #e2e8f0', paddingBottom: 10 }}>
            {[
              { id: 'general', label: 'General Info' },
              { id: 'applicability', label: 'Applicability' },
              { id: 'entitlements', label: 'Entitlements' },
              { id: 'workflow', label: 'Approval Workflow' },
              { id: 'advanced', label: 'Advanced Rules' }
            ].map(t => (
              <div key={t.id} onClick={() => setEditorTab(t.id)} 
                   style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: editorTab === t.id ? '#2563eb' : '#64748b', borderBottom: editorTab === t.id ? '2px solid #2563eb' : 'none', paddingBottom: 8, marginBottom: -11 }}>
                {t.label}
              </div>
            ))}
          </div>

          <div className="card p-4 mb-3" style={{ minHeight: 400 }}>
            {editorTab === 'general' && (
              <div className="row g-4">
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Policy Name *</label>
                  <input className="form-control" placeholder="e.g. Standard US Leave Policy" value={policyForm.name} onChange={e => setPolicyForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                  <input className="form-control" placeholder="Brief explanation of this policy" value={policyForm.description} onChange={e => setPolicyForm(p => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Effective From *</label>
                  <input type="date" className="form-control" value={policyForm.effectiveFrom?.split('T')[0] || ''} onChange={e => setPolicyForm(p => ({ ...p, effectiveFrom: e.target.value }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Effective To (Optional)</label>
                  <input type="date" className="form-control" value={policyForm.effectiveTo?.split('T')[0] || ''} onChange={e => setPolicyForm(p => ({ ...p, effectiveTo: e.target.value || null }))} />
                </div>
                <div className="col-md-4 d-flex align-items-end gap-3" style={{ paddingBottom: 8 }}>
                  <div className="form-check form-switch" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input className="form-check-input" type="checkbox" checked={policyForm.isDefault} id="isDefault" onChange={e => setPolicyForm(p => ({ ...p, isDefault: e.target.checked }))} style={{ width: 40, height: 20 }} />
                    <label className="form-check-label" htmlFor="isDefault" style={{ fontSize: 14, fontWeight: 600 }}>Set as Default Policy</label>
                  </div>
                </div>
              </div>
            )}

            {editorTab === 'applicability' && (
              <div className="row g-4">
                <div className="col-12" style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
                  Define who this policy applies to. If multiple fields are selected, an employee must match ALL conditions to be eligible. Leave empty to apply to everyone.
                </div>
                <div className="col-md-4">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Roles</label>
                  <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', minHeight: 120 }}>
                    {['super_admin', 'admin_full', 'team_admin', 'team_lead', 'employee', 'intern', 'recruiter'].map(r => (
                      <div className="form-check" key={r}>
                        <input className="form-check-input" type="checkbox" id={`role-${r}`} 
                          checked={policyForm.applicableRoles.includes(r)} 
                          onChange={e => {
                            const roles = e.target.checked ? [...policyForm.applicableRoles, r] : policyForm.applicableRoles.filter(x => x !== r);
                            setPolicyForm(p => ({ ...p, applicableRoles: roles }));
                          }} />
                        <label className="form-check-label" htmlFor={`role-${r}`} style={{ fontSize: 13 }}>{r}</label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="col-md-4">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employment Types</label>
                  <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', minHeight: 120 }}>
                    {['full_time', 'part_time', 'contract', 'intern', 'consultant', 'apprentice'].map(t => (
                      <div className="form-check" key={t}>
                        <input className="form-check-input" type="checkbox" id={`type-${t}`} 
                          checked={policyForm.applicableEmploymentTypes.includes(t)} 
                          onChange={e => {
                            const typesArr = e.target.checked ? [...policyForm.applicableEmploymentTypes, t] : policyForm.applicableEmploymentTypes.filter(x => x !== t);
                            setPolicyForm(p => ({ ...p, applicableEmploymentTypes: typesArr }));
                          }} />
                        <label className="form-check-label" htmlFor={`type-${t}`} style={{ fontSize: 13 }}>{t}</label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="col-md-4">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Departments</label>
                  <textarea className="form-control" placeholder="E.g. Engineering, Sales, HR (comma separated)" rows={4} value={policyForm.applicableDepartments.join(', ')} onChange={e => setPolicyForm(p => ({ ...p, applicableDepartments: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Type department names separated by commas.</div>
                </div>
                
                <div className="col-12"><hr style={{ margin: '12px 0' }} /></div>
                
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Gender Restriction</label>
                  <select className="form-select" value={policyForm.genderRestriction} onChange={e => setPolicyForm(p => ({ ...p, genderRestriction: e.target.value }))}>
                    <option value="all">All Genders</option>
                    <option value="male">Male Only</option>
                    <option value="female">Female Only</option>
                  </select>
                </div>
                <div className="col-md-6 d-flex align-items-center" style={{ paddingTop: 28 }}>
                  <div className="form-check form-switch" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input className="form-check-input" type="checkbox" checked={policyForm.requireProbationCompletion} id="requireProbation" onChange={e => setPolicyForm(p => ({ ...p, requireProbationCompletion: e.target.checked }))} style={{ width: 40, height: 20 }} />
                    <label className="form-check-label" htmlFor="requireProbation" style={{ fontSize: 14, fontWeight: 600 }}>Require Probation Completion</label>
                  </div>
                </div>
              </div>
            )}

            {editorTab === 'entitlements' && (
              <div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                  Configure leave quotas and rules. Click a leave type to expand its advanced settings.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {policyForm.leaveTypeConfigs.map((cfg, i) => {
                    const lt = types.find(t => t._id === cfg.typeId);
                    const isExpanded = expandedType === cfg.typeId;
                    return (
                      <div key={cfg.typeId} style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', background: cfg.enabled ? '#fff' : '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer', background: isExpanded ? '#f8fafc' : 'transparent', borderBottom: isExpanded ? '1px solid #e2e8f0' : 'none' }} onClick={() => setExpandedType(isExpanded ? null : cfg.typeId)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div className="form-check form-switch m-0" onClick={e => e.stopPropagation()}>
                              <input className="form-check-input" type="checkbox" checked={cfg.enabled} style={{ width: 36, height: 18 }} onChange={e => {
                                const updated = [...policyForm.leaveTypeConfigs];
                                updated[i] = { ...updated[i], enabled: e.target.checked };
                                setPolicyForm(p => ({ ...p, leaveTypeConfigs: updated }));
                              }} />
                            </div>
                            <span className="badge" style={{ background: lt?.color || '#e2e8f0', color: '#fff', fontSize: 13 }}>
                              <i className={`${lt?.icon || 'bi-calendar'} me-1`} />{lt?.code}
                            </span>
                            <span style={{ fontWeight: 600, color: cfg.enabled ? '#0f172a' : '#94a3b8' }}>{lt?.name}</span>
                            {cfg.enabled && <span style={{ fontSize: 13, color: '#64748b' }}>— {cfg.annualAllocation} days/yr ({cfg.accrualMode})</span>}
                          </div>
                          <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'}`} style={{ color: '#94a3b8' }} />
                        </div>
                        {isExpanded && cfg.enabled && (
                          <div style={{ padding: 20 }}>
                            <div className="row g-4">
                              <div className="col-12" style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>Basic Settings</div>
                              <div className="col-md-3">
                                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Annual Allocation</label>
                                <input type="number" className="form-control form-control-sm" min={0} value={cfg.annualAllocation} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], annualAllocation: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Accrual Mode</label>
                                <select className="form-select form-select-sm" value={cfg.accrualMode} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], accrualMode: e.target.value }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }}>
                                  <option value="upfront">Upfront (Granted Jan 1st)</option>
                                  <option value="monthly">Monthly Accrual</option>
                                </select>
                              </div>
                              <div className="col-md-3 d-flex align-items-end">
                                <div className="form-check">
                                  <input className="form-check-input" type="checkbox" id={`prorate-${i}`} checked={cfg.prorateForNewJoiners} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], prorateForNewJoiners: e.target.checked }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                                  <label className="form-check-label" htmlFor={`prorate-${i}`} style={{ fontSize: 12 }}>Prorate for New Joiners</label>
                                </div>
                              </div>
                              <div className="col-md-3 d-flex align-items-end">
                                <div className="form-check">
                                  <input className="form-check-input" type="checkbox" id={`paid-${i}`} checked={cfg.isPaid} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], isPaid: e.target.checked }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                                  <label className="form-check-label" htmlFor={`paid-${i}`} style={{ fontSize: 12 }}>Is Paid Leave</label>
                                </div>
                              </div>

                              <div className="col-12" style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, marginTop: 24 }}>Restrictions & Rules</div>
                              <div className="col-md-3">
                                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Max Consecutive Days</label>
                                <input type="number" className="form-control form-control-sm" min={0} value={cfg.maxConsecutiveDays} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], maxConsecutiveDays: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Min Gap Days</label>
                                <input type="number" className="form-control form-control-sm" min={0} value={cfg.minGapDays} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], minGapDays: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Advance Notice (Days)</label>
                                <input type="number" className="form-control form-control-sm" min={0} value={cfg.noticePeriodDays} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], noticePeriodDays: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                              </div>
                              <div className="col-md-3">
                                <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Require Docs if (Days)</label>
                                <input type="number" className="form-control form-control-sm" min={0} value={cfg.requireDocsIfConsecutiveDays} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], requireDocsIfConsecutiveDays: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} placeholder="0 = disable" />
                              </div>

                              <div className="col-12" style={{ fontWeight: 600, fontSize: 14, color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: 8, marginTop: 24 }}>Carry Forward & Encashment</div>
                              <div className="col-md-6 d-flex flex-column gap-2">
                                <div className="form-check">
                                  <input className="form-check-input" type="checkbox" id={`cf-${i}`} checked={cfg.carryForwardAllowed} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], carryForwardAllowed: e.target.checked }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                                  <label className="form-check-label" htmlFor={`cf-${i}`} style={{ fontSize: 13, fontWeight: 600 }}>Allow Carry Forward</label>
                                </div>
                                {cfg.carryForwardAllowed && (
                                  <div style={{ display: 'flex', gap: 12, marginLeft: 24 }}>
                                    <div>
                                      <label style={{ fontSize: 11, color: '#64748b' }}>Max Days</label>
                                      <input type="number" className="form-control form-control-sm" min={0} value={cfg.carryForwardMaxDays} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], carryForwardMaxDays: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} style={{ width: 80 }} />
                                    </div>
                                    <div>
                                      <label style={{ fontSize: 11, color: '#64748b' }}>Expiry (Months)</label>
                                      <input type="number" className="form-control form-control-sm" min={0} value={cfg.carryForwardExpiryMonths} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], carryForwardExpiryMonths: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} style={{ width: 80 }} />
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="col-md-6 d-flex flex-column gap-2">
                                <div className="form-check">
                                  <input className="form-check-input" type="checkbox" id={`encash-${i}`} checked={cfg.encashmentAllowed} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], encashmentAllowed: e.target.checked }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} />
                                  <label className="form-check-label" htmlFor={`encash-${i}`} style={{ fontSize: 13, fontWeight: 600 }}>Allow Encashment</label>
                                </div>
                                {cfg.encashmentAllowed && (
                                  <div style={{ display: 'flex', gap: 12, marginLeft: 24 }}>
                                    <div>
                                      <label style={{ fontSize: 11, color: '#64748b' }}>Max Days</label>
                                      <input type="number" className="form-control form-control-sm" min={0} value={cfg.encashmentMaxDays} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], encashmentMaxDays: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} style={{ width: 80 }} />
                                    </div>
                                    <div>
                                      <label style={{ fontSize: 11, color: '#64748b' }}>Rate %</label>
                                      <input type="number" className="form-control form-control-sm" min={0} max={100} value={cfg.encashmentRatePercent} onChange={e => { const u = [...policyForm.leaveTypeConfigs]; u[i] = { ...u[i], encashmentRatePercent: Number(e.target.value) }; setPolicyForm(p => ({ ...p, leaveTypeConfigs: u })); }} style={{ width: 80 }} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {editorTab === 'workflow' && (
              <div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
                  Define the approval chain. Step 1 happens first. "Approve" steps block the request until approved. "Review" steps only notify the reviewer.
                </div>
                {policyForm.approvalWorkflow.map((step, i) => (
                  <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>Step {i + 1}</span>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => {
                        const updated = policyForm.approvalWorkflow.filter((_, idx) => idx !== i);
                        setPolicyForm(p => ({ ...p, approvalWorkflow: updated }));
                      }} disabled={policyForm.approvalWorkflow.length <= 1}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-3">
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Label / Name</label>
                        <input className="form-control form-control-sm" placeholder="e.g. Line Manager" value={step.label} onChange={e => {
                          const updated = [...policyForm.approvalWorkflow];
                          updated[i] = { ...updated[i], label: e.target.value };
                          setPolicyForm(p => ({ ...p, approvalWorkflow: updated }));
                        }} />
                      </div>
                      <div className="col-md-3">
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Approver Roles</label>
                        <div style={{ background: '#fff', border: '1px solid #dee2e6', borderRadius: 6, padding: 8, maxHeight: 100, overflowY: 'auto' }}>
                          {['super_admin', 'admin_full', 'team_admin', 'team_lead'].map(r => (
                            <div className="form-check form-check-sm mb-1" key={r}>
                              <input className="form-check-input" type="checkbox" id={`step-${i}-role-${r}`} 
                                checked={step.approverRoles?.includes(r)} 
                                onChange={e => {
                                  const roles = e.target.checked ? [...(step.approverRoles || []), r] : (step.approverRoles || []).filter(x => x !== r);
                                  const updated = [...policyForm.approvalWorkflow];
                                  updated[i] = { ...updated[i], approverRoles: roles };
                                  setPolicyForm(p => ({ ...p, approvalWorkflow: updated }));
                                }} />
                              <label className="form-check-label" htmlFor={`step-${i}-role-${r}`} style={{ fontSize: 11 }}>{r}</label>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Action Type</label>
                        <select className="form-select form-select-sm" value={step.actionType} onChange={e => {
                          const updated = [...policyForm.approvalWorkflow];
                          updated[i] = { ...updated[i], actionType: e.target.value };
                          setPolicyForm(p => ({ ...p, approvalWorkflow: updated }));
                        }}>
                          <option value="approve">Approve</option>
                          <option value="review">Review (Notify)</option>
                        </select>
                      </div>
                      <div className="col-md-2 d-flex flex-column align-items-start">
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Mandatory</label>
                        <div className="form-check form-switch mt-1">
                          <input className="form-check-input" type="checkbox" checked={step.required} onChange={e => {
                            const updated = [...policyForm.approvalWorkflow];
                            updated[i] = { ...updated[i], required: e.target.checked };
                            setPolicyForm(p => ({ ...p, approvalWorkflow: updated }));
                          }} />
                        </div>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Escalate After (hrs)</label>
                        <input type="number" className="form-control form-control-sm" min={0} value={step.escalateAfterHours} placeholder="0 = No escalation" onChange={e => {
                          const updated = [...policyForm.approvalWorkflow];
                          updated[i] = { ...updated[i], escalateAfterHours: Number(e.target.value) };
                          setPolicyForm(p => ({ ...p, approvalWorkflow: updated }));
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
                <button className="btn btn-outline-primary btn-sm mt-2" onClick={() => {
                  const lastStep = policyForm.approvalWorkflow[policyForm.approvalWorkflow.length - 1];
                  setPolicyForm(p => ({
                    ...p,
                    approvalWorkflow: [...p.approvalWorkflow, { ...workflowStepDefaults, step: (lastStep?.step || 0) + 1 }],
                  }));
                }}>
                  <i className="bi bi-plus-lg me-1" />Add Approval Step
                </button>
              </div>
            )}

            {editorTab === 'advanced' && (
              <div className="row g-4">
                <div className="col-12" style={{ fontSize: 13, color: '#64748b' }}>
                  Global rules that apply to all leave types under this policy.
                </div>
                <div className="col-md-4">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Max Pending Applications</label>
                  <input type="number" className="form-control" min={0} value={policyForm.maxPendingApplications} onChange={e => setPolicyForm(p => ({ ...p, maxPendingApplications: Number(e.target.value) }))} />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Maximum unapproved requests an employee can have at one time.</div>
                </div>
                <div className="col-md-8 d-flex flex-column gap-3 justify-content-center pt-3">
                  <div className="form-check form-switch" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input className="form-check-input" type="checkbox" checked={policyForm.countWeekends} id="countWeekends" onChange={e => setPolicyForm(p => ({ ...p, countWeekends: e.target.checked }))} style={{ width: 40, height: 20 }} />
                    <div>
                      <label className="form-check-label" htmlFor="countWeekends" style={{ fontSize: 14, fontWeight: 600 }}>Count Weekends</label>
                      <div style={{ fontSize: 11, color: '#64748b' }}>If enabled, weekends falling within a leave period are deducted from the leave balance.</div>
                    </div>
                  </div>
                  <div className="form-check form-switch" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input className="form-check-input" type="checkbox" checked={policyForm.countHolidays} id="countHolidays" onChange={e => setPolicyForm(p => ({ ...p, countHolidays: e.target.checked }))} style={{ width: 40, height: 20 }} />
                    <div>
                      <label className="form-check-label" htmlFor="countHolidays" style={{ fontSize: 14, fontWeight: 600 }}>Count Public Holidays</label>
                      <div style={{ fontSize: 11, color: '#64748b' }}>If enabled, holidays falling within a leave period are deducted from the leave balance.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Leave Policies">
      {toast && (
        <div className="toast-container-custom">
          <div className={'toast-custom ' + toast.type}>
            <i className={'bi ' + (toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle') + ' me-2'} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div><h4>Leave Policies</h4><p>Configure leave types, policies, and manage employee balances</p></div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            <i className={`${t.icon} me-2`} />{t.label}
          </button>
        ))}
      </div>

      {/* ── LEAVE TYPES TAB ── */}
      {tab === 'types' && (
        <div className="card p-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div className="section-title" style={{ margin: 0 }}>Leave Types</div>
            <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', code: '', color: '#3b82f6', icon: 'bi-calendar-check', description: '', sortOrder: types.length, isActive: true }); setShowModal('type'); }}>
              <i className="bi bi-plus-lg me-1" />Add Type
            </button>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
          ) : types.length === 0 ? (
            <div className="empty-state"><i className="bi bi-tags" /><h6>No leave types defined</h6></div>
          ) : (
            <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr><th>Order</th><th>Code</th><th>Name</th><th>Color</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {types.map(t => (
                    <tr key={t._id}>
                      <td style={{ fontSize: 13 }}>{t.sortOrder}</td>
                      <td><span className="badge" style={{ background: t.color, color: '#fff' }}>{t.code}</span></td>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</td>
                      <td>
                        <input type="color" value={t.color || '#3b82f6'} disabled style={{ width: 30, height: 24, padding: 0, border: 'none', cursor: 'default' }} />
                      </td>
                      <td>
                        <span className="badge" style={{ background: t.isActive ? '#dcfce7' : '#fee2e2', color: t.isActive ? '#16a34a' : '#dc2626' }}>
                          {t.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => { setModalForm({ ...t }); setShowModal('type'); }}>Edit</button>
                          <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => deleteType(t._id)}>{t.isActive ? 'Deactivate' : 'Activate'}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── POLICIES TAB ── */}
      {tab === 'policies' && (
        <div className="card p-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div className="section-title" style={{ margin: 0 }}>Leave Policies</div>
            <button className="btn btn-primary btn-sm" onClick={() => openPolicyEditor()}>
              <i className="bi bi-plus-lg me-1" />New Policy
            </button>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
          ) : policies.length === 0 ? (
            <div className="empty-state"><i className="bi bi-file-earmark-text" /><h6>No policies created yet</h6></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {policies.map(p => (
                <div key={p._id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                        {p.isDefault && <span className="badge" style={{ background: '#dbeafe', color: '#2563eb' }}>Default</span>}
                        <span className="badge" style={{ background: p.status === 'active' ? '#dcfce7' : '#fef3c7', color: p.status === 'active' ? '#16a34a' : '#d97706' }}>{p.status}</span>
                      </div>
                      {p.description && <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{p.description}</div>}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        {p.applicableRoles?.length > 0 && <Label text={`Roles: ${p.applicableRoles.join(', ')}`} color="#8b5cf6" />}
                        {p.isDefault && <Label text="Fallback for all" color="#3b82f6" />}
                        {p.leaveTypeConfigs?.filter(c => c.enabled).length > 0 && (
                          <span className="badge" style={{ background: '#f1f5f9', color: '#475569', fontSize: 11 }}>
                            {p.leaveTypeConfigs.filter(c => c.enabled).length} types active
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        <i className="bi bi-people me-1" />{p.approvalWorkflow?.length || 0} approval step(s)
                        {p.effectiveFrom && <> · From: {new Date(p.effectiveFrom).toLocaleDateString()}</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => openPolicyEditor(p)}>
                        <i className="bi bi-pencil me-1" />Edit
                      </button>
                      <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => archivePolicy(p._id)} disabled={p.status === 'archived'}>
                        <i className="bi bi-archive me-1" />Archive
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BALANCES TAB ── */}
      {tab === 'balances' && (
        <div className="card p-4">
          <div className="section-title mb-4">Employee Leave Balances</div>
          <div style={{ marginBottom: 16 }}>
            <select className="form-select" style={{ width: 300 }} value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)}>
              <option value="">— Select Employee —</option>
              {employees.map(emp => (
                <option key={emp._id} value={emp.userId?._id || emp.userId}>{emp.name} ({emp.department})</option>
              ))}
            </select>
          </div>
          {!selectedEmpId ? (
            <div className="empty-state"><i className="bi bi-person" /><h6>Select an employee to view balances</h6></div>
          ) : balances ? (
            <>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                Policy: <strong>{balances.policy?.name}</strong> &middot; Cycle: {new Date(balances.cycleStart).toLocaleDateString()} – {new Date(balances.cycleEnd).toLocaleDateString()}
              </div>
              <div className="row g-3">
                {balances.balances?.map(b => {
                  const available = b.allocated + b.carriedForward - b.used - b.pending;
                  const pct = b.allocated > 0 ? Math.min(Math.round(((b.used + b.pending) / b.allocated) * 100), 100) : 0;
                  return (
                    <div key={b.typeId?._id || b.typeId} className="col-md-4 col-xl-3">
                      <div className="stat-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                            <span className="badge me-1" style={{ background: b.typeId?.color || '#e2e8f0', color: '#fff' }}>{b.typeId?.code || '?'}</span>
                            {b.typeId?.name || 'Unknown'}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: available > 0 ? '#16a34a' : '#dc2626' }}>{available} left</span>
                        </div>
                        <div className="progress mb-2" style={{ height: 6 }}>
                          <div className="progress-bar" style={{ width: `${pct}%`, background: b.typeId?.color || '#3b82f6' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                          <span>Used: {b.used}</span>
                          <span>Allocated: {b.allocated}</span>
                        </div>
                        {b.carriedForward > 0 && (
                          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>
                            Carry fwd: +{b.carriedForward} {b.expiryDate ? `(exp: ${new Date(b.expiryDate).toLocaleDateString()})` : ''}
                          </div>
                        )}
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm" style={{ fontSize: 11, background: '#f1f5f9', color: '#475569', padding: '2px 8px' }} 
                            onClick={() => setAdjModal({ empId: selectedEmpId, typeId: b.typeId?._id || b.typeId, name: b.typeId?.name, allocated: b.allocated })}>
                            <i className="bi bi-sliders me-1" />Adjust
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => loadBalance(selectedEmpId)}>
                  <i className="bi bi-arrow-clockwise me-1" />Refresh
                </button>
                <button className="btn btn-outline-primary btn-sm" onClick={async () => {
                  try {
                    await api.post('/api/leave/balance', { action: 'recalculate', userId: selectedEmpId });
                    showToast('Balance recalculated');
                    loadBalance(selectedEmpId);
                  } catch (e) { showToast(e.message, 'error'); }
                }}>
                  <i className="bi bi-arrow-repeat me-1" />Recalculate
                </button>
              </div>
              <div className="row mt-4">
                <div className="col-md-6">
                  <div style={{ padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 8 }}>
                      <i className="bi bi-calendar-plus me-2" />Monthly Accruals
                    </div>
                    <div style={{ fontSize: 12, color: '#14532d', marginBottom: 12 }}>
                      Run monthly accruals for policies configured to accrue leaves monthly instead of upfront.
                    </div>
                    <button className="btn btn-success btn-sm" onClick={async () => {
                      if (!confirm('Run monthly accrual process? This will add monthly prorated days to eligible employees.')) return;
                      try {
                        const res = await api.post('/api/leave/balance', { action: 'monthly-accrual' });
                        showToast(res.message);
                      } catch (e) { showToast(e.message, 'error'); }
                    }}>
                      <i className="bi bi-play-circle me-1" />Run Monthly Accruals
                    </button>
                  </div>
                </div>
                <div className="col-md-6">
                  <div style={{ padding: 16, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 8 }}>
                      <i className="bi bi-exclamation-triangle me-2" />Annual Carry Forward
                    </div>
                    <div style={{ fontSize: 12, color: '#78350f', marginBottom: 12 }}>
                      Process annual carry forward for ALL employees. Creates next year's balance records with unused days carried over.
                    </div>
                    <button className="btn btn-warning btn-sm" style={{ color: '#fff' }} onClick={async () => {
                      if (!confirm('Process carry forward for all employees? This will create next year balance records.')) return;
                      try {
                        const res = await api.post('/api/leave/balance', { action: 'carry-forward' });
                        showToast(res.message);
                      } catch (e) { showToast(e.message, 'error'); }
                    }}>
                      <i className="bi bi-forward me-1" />Process Carry Forward
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
          )}
        </div>
      )}

      {/* ── LEAVE TYPE MODAL ── */}
      {showModal === 'type' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Leave Type</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Name *</label>
                    <input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Code *</label>
                    <input className="form-control" placeholder="e.g. CL" value={modalForm.code || ''} onChange={e => setModalForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Color</label>
                    <input type="color" className="form-control form-control-color" value={modalForm.color || '#3b82f6'} onChange={e => setModalForm(p => ({ ...p, color: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Icon</label>
                    <select className="form-select" value={modalForm.icon || 'bi-calendar-check'} onChange={e => setModalForm(p => ({ ...p, icon: e.target.value }))}>
                      <option value="bi-calendar-check">Calendar Check</option>
                      <option value="bi-sun">Sun</option>
                      <option value="bi-heart">Heart</option>
                      <option value="bi-emoji-frown">Sick</option>
                      <option value="bi-baby">Baby</option>
                      <option value="bi-person">Person</option>
                      <option value="bi-cash">Cash</option>
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Sort Order</label>
                    <input type="number" className="form-control" min={0} value={modalForm.sortOrder ?? 0} onChange={e => setModalForm(p => ({ ...p, sortOrder: Number(e.target.value) }))} />
                  </div>
                  <div className="col-6 d-flex align-items-end" style={{ paddingBottom: 12 }}>
                    <div className="form-check">
                      <input className="form-check-input" type="checkbox" checked={modalForm.isActive ?? true} id="isActive" onChange={e => setModalForm(p => ({ ...p, isActive: e.target.checked }))} />
                      <label className="form-check-label" htmlFor="isActive" style={{ fontSize: 13 }}>Active</label>
                    </div>
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                    <textarea className="form-control" rows={2} value={modalForm.description || ''} onChange={e => setModalForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>Preview:</span>
                      <span className="badge" style={{ background: modalForm.color || '#3b82f6', color: '#fff', fontSize: 13, padding: '6px 12px' }}>
                        <i className={`${modalForm.icon || 'bi-calendar-check'} me-1`} />{modalForm.code || 'CL'} — {modalForm.name || 'Leave Type'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveType(modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MANUAL ADJUSTMENT MODAL ── */}
      {adjModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Adjust Balance: {adjModal.name}</h5>
                <button className="btn-close" onClick={() => setAdjModal(null)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Adjustment Days</label>
                  <input type="number" className="form-control" step="0.5" id="adjDays" defaultValue={0} />
                  <div className="form-text" style={{ fontSize: 11 }}>Use positive values to add days, negative to deduct.</div>
                </div>
                <div className="mb-3">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason / Comment *</label>
                  <textarea className="form-control" rows={2} id="adjReason" placeholder="e.g. Compensatory Off granted" />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setAdjModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => {
                  const days = Number(document.getElementById('adjDays').value);
                  const reason = document.getElementById('adjReason').value.trim();
                  if (!reason) return showToast('Reason is required', 'error');
                  if (days === 0) return showToast('Adjustment cannot be zero', 'error');
                  
                  try {
                    await api.post('/api/leave/balance/adjust', {
                      userId: adjModal.empId,
                      typeId: adjModal.typeId,
                      days,
                      reason
                    });
                    showToast('Balance adjusted successfully');
                    setAdjModal(null);
                    loadBalance(adjModal.empId);
                  } catch (e) {
                    showToast(e.message, 'error');
                  }
                }}>Apply Adjustment</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
