'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ConfirmModal from '@/components/ConfirmModal';
import LeaveTypeBalanceFields from '@/components/leave/LeaveTypeBalanceFields';
import DateInput from '@/components/DateInput';
import DevAdminNav, { devNavBtnStyle } from '@/components/dev-admin/DevAdminNav';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { CREDIT_SCHEDULES, getCreditSchedule, getDaysPerCredit, getAnnualEntitlement } from '@/lib/leave/credit-schedule';
import { linkedTypeError } from '@/lib/leave/linked-types';

const LEAVE_SYMBOLS = [
  ['bi-calendar-check', 'Calendar check'],
  ['bi-calendar3', 'Calendar'],
  ['bi-heart-pulse', 'Health'],
  ['bi-bandaid', 'Medical care'],
  ['bi-sun', 'Sun'],
  ['bi-airplane', 'Travel'],
  ['bi-house-heart', 'Family'],
  ['bi-people', 'People'],
  ['bi-flower1', 'Flower'],
  ['bi-gift', 'Gift'],
  ['bi-arrow-repeat', 'Compensatory off'],
  ['bi-wallet2', 'Wallet'],
];

const editablePolicy = policy => JSON.parse(JSON.stringify({ ...policy, ...policy.draftConfig }));

export default function ControlCenterPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('policy'); // 'policy' | 'sandbox'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [toast, setToast] = useState(null);

  // Data states
  const [policies, setPolicies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [currentPolicy, setCurrentPolicy] = useState(null);
  const [deletePolicy, setDeletePolicy] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [newType, setNewType] = useState({ code: '', name: '', annualAllocation: 0 });
  const [typeError, setTypeError] = useState('');
  const [removeType, setRemoveType] = useState(null);

  // Simulation state
  const [simForm, setSimForm] = useState({
    targetUserId: '',
    typeCode: 'SL',
    from: '2026-08-25',
    to: '2026-08-25',
    halfDay: false,
    halfDayType: 'first_half',
    reason: 'Testing Leave Application in Sandbox Portal',
    hasDocument: false,
  });

  const [simResult, setSimResult] = useState(null);

  // Policy Creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPolicyForm, setNewPolicyForm] = useState({
    name: '',
    description: '',
    isDefault: false,
  });

  const handleCreatePolicy = async (e) => {
    e.preventDefault();
    if (!newPolicyForm.name.trim()) return showToast('Please enter policy name', 'error');
    setCreating(true);
    try {
      const res = await api.post('/api/admin/control-center/policies', newPolicyForm);
      showToast(res.message || 'New Leave Policy created successfully!');
      setShowCreateModal(false);
      setNewPolicyForm({ name: '', description: '', isDefault: false });
      await loadData(res.policy?._id);
    } catch (err) {
      showToast(err.message || 'Failed to create policy', 'error');
    } finally {
      setCreating(false);
    }
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async (preferredPolicyId) => {
    setLoading(true);
    try {
      const res = await api.get('/api/admin/control-center/policies');
      const loadedPolicies = res.policies || [];
      const loadedEmps = res.employees || [];
      setPolicies(loadedPolicies);
      setEmployees(loadedEmps);
      if (loadedPolicies.length > 0) {
        const selected = loadedPolicies.find(p => p._id === (preferredPolicyId || selectedPolicyId)) || loadedPolicies[0];
        setSelectedPolicyId(selected._id);
        setCurrentPolicy(editablePolicy(selected));
      } else {
        setSelectedPolicyId('');
        setCurrentPolicy(null);
      }
      if (loadedEmps.length > 0) {
        setSimForm(p => ({ ...p, targetUserId: loadedEmps[0]._id }));
      }
    } catch (e) {
      showToast(e.message || 'Failed to load policy data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const handlePolicySelect = (id) => {
    setSelectedPolicyId(id);
    const found = policies.find(p => p._id === id);
    if (found) setCurrentPolicy(editablePolicy(found));
  };

  const updateLeaveType = (index, changes) => {
    setCurrentPolicy(policy => ({
      ...policy,
      leaveTypeConfigs: policy.leaveTypeConfigs.map((config, i) => i === index ? { ...config, ...changes } : config),
    }));
  };

  const handleDeletePolicy = async () => {
    if (!deletePolicy || deleting) return;
    setDeleting(true);
    try {
      const res = await api.delete('/api/admin/control-center/policies', { policyId: deletePolicy._id });
      const remaining = policies.filter(policy => policy._id !== deletePolicy._id);
      setPolicies(remaining);
      setSelectedPolicyId(remaining[0]?._id || '');
      setCurrentPolicy(remaining[0] ? editablePolicy(remaining[0]) : null);
      setSimResult(null);
      setDeletePolicy(null);
      showToast(res.message || 'Leave policy deleted');
    } catch (error) {
      showToast(error.message || 'Failed to delete policy', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddType = () => {
    const code = newType.code.trim().toUpperCase();
    const name = newType.name.trim();
    if (!code || !name) return setTypeError('Enter a code and name for the leave type.');
    const linkedError = linkedTypeError([...(currentPolicy?.leaveTypeConfigs || []), { ...newType, code, name }]);
    if (linkedError) return setTypeError(linkedError);
    if ((currentPolicy?.leaveTypeConfigs || []).some(config => config.code.trim().toUpperCase() === code)) {
      return setTypeError('This code is already used in this policy. Choose a unique code.');
    }
    if (newType.annualAllocation === '' || !Number.isFinite(Number(newType.annualAllocation)) || Number(newType.annualAllocation) < 0) {
      return setTypeError('Annual allocation must be zero or more.');
    }
    if (!Number.isInteger(Number(newType.noticePeriodDays ?? 0)) || Number(newType.noticePeriodDays ?? 0) < 0) {
      return setTypeError('Notice period must be zero or a positive whole number.');
    }
    setCurrentPolicy(policy => ({
      ...policy,
      leaveTypeConfigs: [...(policy.leaveTypeConfigs || []), {
        code, name, annualAllocation: Number(newType.annualAllocation),
        balanceMode: newType.balanceMode || 'own', linkAllLeaveTypes: !!newType.linkAllLeaveTypes, linkedLeaveTypes: newType.linkedLeaveTypes || [],
        color: '#3b82f6', icon: 'bi-calendar-check', enabled: true,
        isPaid: true, creditSchedule: 'upfront', accrualMode: 'upfront', allowHalfDay: true, allowFirstHalf: true, allowSecondHalf: true,
        maxConsecutiveDays: 0, minGapDays: 0, noticePeriodDays: Number(newType.noticePeriodDays ?? 0),
        requiresDocuments: false, requireDocsIfConsecutiveDays: 0, genderRestriction: 'all',
        sortOrder: Math.max(0, ...(policy.leaveTypeConfigs || []).map(config => config.sortOrder || 0)) + 1,
      }],
    }));
    setShowAddType(false);
    showToast('Leave type added. Publish the policy to make it available to employees.');
  };

  const handleSavePolicy = async (action = 'publish') => {
    if (!currentPolicy) return;
    setSaving(true);
    try {
      const payload = {
        action,
        policyId: currentPolicy._id,
        name: currentPolicy.name,
        description: currentPolicy.description,
        countWeekends: currentPolicy.countWeekends,
        countHolidays: currentPolicy.countHolidays,
        sandwichRule: currentPolicy.sandwichRule,
        maxPendingApplications: currentPolicy.maxPendingApplications,
        requireProbationCompletion: currentPolicy.requireProbationCompletion,
        leaveTypeConfigs: currentPolicy.leaveTypeConfigs,
      };
      const res = await api.put('/api/admin/control-center/policies', payload);
      showToast(res.message || (action === 'save_draft' ? 'Draft configuration saved!' : 'Policy configuration published live!'));
      await loadData(currentPolicy._id);
    } catch (e) {
      showToast(e.message || 'Failed to update policy', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRunSimulation = async () => {
    setSimulating(true);
    setSimResult(null);
    try {
      const payload = {
        targetUserId: simForm.targetUserId,
        typeCode: simForm.typeCode,
        from: simForm.from,
        to: simForm.to,
        halfDay: simForm.halfDay,
        halfDayType: simForm.halfDay ? simForm.halfDayType : undefined,
        reason: simForm.reason,
        documents: simForm.hasDocument ? ['https://example.com/test-medical-cert.pdf'] : [],
      };
      const res = await api.post('/api/admin/control-center/simulator', payload);
      setSimResult(res);
      if (res.isValid) {
        showToast('Simulation passed cleanly!', 'success');
      } else {
        showToast(`Simulation failed: ${res.rejectionReason}`, 'error');
      }
    } catch (e) {
      showToast(e.message || 'Simulation execution failed', 'error');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <AppShell title="Policy Control Portal">
      {toast && (
        <div className="toast-container-custom" style={{ zIndex: 9999 }}>
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-2`} />
            {toast.msg}
          </div>
        </div>
      )}

      {/* Instance Header Banner */}
      <DevAdminNav
        title="Policy Control & Live Sandbox Portal"
        subtitle='Configure leave policies, rules engine, and test "what-if" simulations in real time.'
      >
        {/* Tab Selection Navigation */}
        <button
          onClick={() => setActiveTab('policy')}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s',
            background: activeTab === 'policy' ? '#ffffff' : 'rgba(255,255,255,0.1)',
            color: activeTab === 'policy' ? '#312e81' : '#ffffff',
          }}
        >
          <i className="bi bi-gear-wide-connected" />
          1. Leave Policy Control & Rules
        </button>

        <button
          onClick={() => setActiveTab('sandbox')}
          style={{
            padding: '10px 20px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s',
            background: activeTab === 'sandbox' ? '#ffffff' : 'rgba(255,255,255,0.1)',
            color: activeTab === 'sandbox' ? '#312e81' : '#ffffff',
          }}
        >
          <i className="bi bi-[#10b981] bi-play-circle-fill" style={{ color: activeTab === 'sandbox' ? '#059669' : '#34d399' }} />
          2. Live Sandbox Simulator Console
        </button>

        <Link href="/admin/dev-admin" style={{ ...devNavBtnStyle(false), marginLeft: 'auto' }}>
          <i className="bi bi-terminal" />
          Dev Admin Portal
        </Link>
      </DevAdminNav>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div className="spinner-border text-primary me-2" role="status" />
          <span style={{ fontSize: 14, color: '#64748b' }}>Loading Control Portal configuration...</span>
        </div>
      ) : (
        <>
          {activeTab === 'policy' && !currentPolicy && (
            <div className="card border-0 shadow-sm p-5 text-center">
              <h5>No active leave policies</h5>
              <p className="text-secondary">Create a policy to configure leave types and rules.</p>
              <button className="btn btn-primary align-self-center" onClick={() => setShowCreateModal(true)}>
                <i className="bi bi-plus-lg me-2" />Create New Leave Policy
              </button>
            </div>
          )}
          {/* TAB 1: LEAVE POLICY CONTROL */}
          {activeTab === 'policy' && currentPolicy && (
            <div className="row g-4">
              {/* Policy Selector & Create Header Bar */}
              <div className="col-12">
                <div className="card shadow-sm border-0" style={{ borderRadius: 14, background: '#f8fafc' }}>
                  <div className="card-body p-3 d-flex justify-content-between align-items-center flex-wrap gap-3">
                    <div className="d-flex align-items-center gap-3" style={{ flex: 1, minWidth: 280 }}>
                      <label className="fw-bold text-secondary mb-0" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        <i className="bi bi-collection-fill me-2 text-primary" />Select Leave Policy:
                      </label>
                      <select
                        className="form-select"
                        value={selectedPolicyId}
                        onChange={e => handlePolicySelect(e.target.value)}
                        style={{ maxWidth: 380, fontWeight: 600 }}
                      >
                        {policies.map(p => (
                          <option key={p._id} value={p._id}>
                            {p.name} {p.isDefault ? '(Corporate Default)' : ''} — v{p.version || 1}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button className="btn btn-outline-danger fw-bold" disabled={saving || deleting} onClick={() => setDeletePolicy(currentPolicy)}>
                      <i className="bi bi-trash me-2" />Delete Policy
                    </button>
                    <button
                      className="btn btn-outline-primary fw-bold"
                      onClick={() => setShowCreateModal(true)}
                      style={{ borderRadius: 8, padding: '7px 16px', fontSize: 13 }}
                    >
                      <i className="bi bi-plus-lg me-2" />Create New Leave Policy
                    </button>
                  </div>
                </div>
              </div>

              <div className="col-12">
                <div className="card shadow-sm border-0" style={{ borderRadius: 14 }}>
                  <div className="card-body p-4">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                      <div>
                        <div className="d-flex align-items-center gap-2">
                          <h5 style={{ fontWeight: 700, margin: 0, color: '#0f172a' }}>Global Leave Policy Settings</h5>
                          <span className="badge bg-secondary" style={{ fontSize: 11 }}>v{currentPolicy.version || 1}</span>
                          {currentPolicy.draftConfig && (
                            <span className="badge bg-warning text-dark" style={{ fontSize: 11 }}>Staged Draft Exists</span>
                          )}
                        </div>
                        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Configure weekend calculations, holiday rules, application limits, and sandwich leave rules</p>
                      </div>

                      <div className="d-flex gap-2">
                        <button className="btn btn-outline-secondary" onClick={() => handleSavePolicy('save_draft')} disabled={saving} style={{ borderRadius: 8, padding: '8px 16px', fontWeight: 600 }}>
                          {saving ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-file-earmark-diff me-2" />}
                          Save Staged Draft
                        </button>
                        <button className="btn btn-primary" onClick={() => handleSavePolicy('publish')} disabled={saving} style={{ borderRadius: 8, padding: '8px 20px', fontWeight: 600, background: '#4338ca', borderColor: '#4338ca' }}>
                          {saving ? <><span className="spinner-border spinner-border-sm me-2" />Publishing...</> : <><i className="bi bi-send-check me-2" />Publish Policy Configuration</>}
                        </button>
                      </div>
                    </div>

                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Active Policy Name</label>
                        <input
                          type="text"
                          className="form-control"
                          value={currentPolicy.name || ''}
                          onChange={e => setCurrentPolicy({ ...currentPolicy, name: e.target.value })}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Max Pending Applications Allowed</label>
                        <input
                          type="number"
                          className="form-control"
                          value={currentPolicy.maxPendingApplications ?? 2}
                          onChange={e => setCurrentPolicy({ ...currentPolicy, maxPendingApplications: parseInt(e.target.value, 10) || 0 })}
                        />
                      </div>

                      {/* Toggles */}
                      <div className="col-md-3 mt-4">
                        <div className="form-check form-switch p-3 border rounded-3" style={{ background: currentPolicy.countWeekends ? '#eff6ff' : '#f8fafc', borderColor: currentPolicy.countWeekends ? '#bfdbfe' : '#e2e8f0' }}>
                          <input
                            className="form-check-input ms-0 me-3"
                            type="checkbox"
                            role="switch"
                            id="countWeekendsSwitch"
                            checked={currentPolicy.countWeekends || false}
                            onChange={e => setCurrentPolicy({ ...currentPolicy, countWeekends: e.target.checked })}
                          />
                          <label className="form-check-label fw-bold text-dark" htmlFor="countWeekendsSwitch" style={{ fontSize: 13 }}>
                            Count Weekends as Leave Days
                          </label>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            When enabled, Saturdays and Sundays consume leave quota.
                          </div>
                        </div>
                      </div>

                      <div className="col-md-3 mt-4">
                        <div className="form-check form-switch p-3 border rounded-3" style={{ background: currentPolicy.countHolidays ? '#eff6ff' : '#f8fafc', borderColor: currentPolicy.countHolidays ? '#bfdbfe' : '#e2e8f0' }}>
                          <input
                            className="form-check-input ms-0 me-3"
                            type="checkbox"
                            role="switch"
                            id="countHolidaysSwitch"
                            checked={currentPolicy.countHolidays || false}
                            onChange={e => setCurrentPolicy({ ...currentPolicy, countHolidays: e.target.checked })}
                          />
                          <label className="form-check-label fw-bold text-dark" htmlFor="countHolidaysSwitch" style={{ fontSize: 13 }}>
                            Count Holidays as Leave Days
                          </label>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            When enabled, public holidays within range count as leave.
                          </div>
                        </div>
                      </div>

                      <div className="col-md-3 mt-4">
                        <div className="form-check form-switch p-3 border rounded-3" style={{ background: currentPolicy.sandwichRule ? '#eff6ff' : '#f8fafc', borderColor: currentPolicy.sandwichRule ? '#bfdbfe' : '#e2e8f0' }}>
                          <input
                            className="form-check-input ms-0 me-3"
                            type="checkbox"
                            role="switch"
                            id="sandwichRuleSwitch"
                            checked={currentPolicy.sandwichRule || false}
                            onChange={e => setCurrentPolicy({ ...currentPolicy, sandwichRule: e.target.checked })}
                          />
                          <label className="form-check-label fw-bold text-dark" htmlFor="sandwichRuleSwitch" style={{ fontSize: 13 }}>
                            Enable Sandwich Leave Rule
                          </label>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            Intervening non-working weekends/holidays count as leave.
                          </div>
                        </div>
                      </div>

                      <div className="col-md-3 mt-4">
                        <div className="form-check form-switch p-3 border rounded-3" style={{ background: currentPolicy.requireProbationCompletion ? '#eff6ff' : '#f8fafc', borderColor: currentPolicy.requireProbationCompletion ? '#bfdbfe' : '#e2e8f0' }}>
                          <input
                            className="form-check-input ms-0 me-3"
                            type="checkbox"
                            role="switch"
                            id="probationSwitch"
                            checked={currentPolicy.requireProbationCompletion || false}
                            onChange={e => setCurrentPolicy({ ...currentPolicy, requireProbationCompletion: e.target.checked })}
                          />
                          <label className="form-check-label fw-bold text-dark" htmlFor="probationSwitch" style={{ fontSize: 13 }}>
                            Require Probation Completion
                          </label>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            Restricts applications for employees on probation status.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Leave Type Config Cards */}
              <div className="col-12">
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                  <div>
                    <h5 style={{ fontWeight: 700, marginBottom: 4, color: '#0f172a' }}>Leave Types Rules & Constraints</h5>
                    <p className="text-secondary mb-0" style={{ fontSize: 13 }}>Add or remove types, then save a draft or publish your changes.</p>
                  </div>
                  <button className="btn btn-outline-primary" disabled={saving} onClick={() => {
                    setNewType({ code: '', name: '', annualAllocation: 0 });
                    setTypeError('');
                    setShowAddType(true);
                  }}><i className="bi bi-plus-lg me-2" />Add Leave Type</button>
                </div>
                {!currentPolicy.leaveTypeConfigs?.length && <div className="alert alert-light border">No leave types in this policy. Add a leave type to get started.</div>}
                <div className="row g-3">
                  {(currentPolicy.leaveTypeConfigs || []).map((cfg, idx) => (
                    <div key={cfg.code || idx} className="col-md-6">
                      <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 14 }}>
                        <div className="card-header bg-white border-bottom-0 pt-3 px-4 d-flex justify-content-between align-items-center flex-wrap gap-2">
                          <div className="d-flex align-items-center gap-2">
                            <span className="badge" style={{ fontSize: 12, padding: '5px 10px', background: `${cfg.color || '#3b82f6'}20`, color: cfg.color || '#3b82f6' }}>
                              <i className={`bi ${cfg.icon || 'bi-calendar-check'} me-1`} aria-hidden="true" />{cfg.code}
                            </span>
                            <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{cfg.name}</span>
                            <span className={`badge ${cfg.enabled !== false ? 'bg-success' : 'bg-secondary'}`} style={{ fontSize: 10 }}>
                              {cfg.enabled !== false ? '✓ Listed for Users' : 'Hidden from Users'}
                            </span>
                          </div>
                          <div className="form-check form-switch d-flex align-items-center gap-2">
                            <label className="form-check-label fw-bold text-secondary" style={{ fontSize: 11, cursor: 'pointer' }}>
                              {cfg.enabled !== false ? 'Active' : 'Disabled'}
                            </label>
                            <input
                              className="form-check-input ms-0"
                              type="checkbox"
                              role="switch"
                              title="Enable or disable this leave type for employee leave applications"
                              checked={cfg.enabled !== false}
                              onChange={e => {
                                const updated = [...currentPolicy.leaveTypeConfigs];
                                updated[idx].enabled = e.target.checked;
                                setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                              }}
                            />
                          </div>
                          <div className="d-flex align-items-center gap-2">
                          <button type="button" className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap' }} disabled={saving} onClick={() => {
                            updateLeaveType(idx, { balanceMode: 'linked' });
                            document.getElementById(`leave-links-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }}><i className="bi bi-link-45deg me-1" aria-hidden="true" />Link Leaves</button>
                          <button type="button" className="btn btn-sm btn-outline-danger d-inline-flex align-items-center justify-content-center p-0" style={{ width: 30, height: 30, flexShrink: 0 }} disabled={saving} onClick={() => setRemoveType({ index: idx, code: cfg.code, name: cfg.name })} aria-label={`Remove ${cfg.name}`} title={`Remove ${cfg.name}`}>
                            <i className="bi bi-trash" aria-hidden="true" />
                          </button>
                          </div>
                        </div>

                        <div className="card-body px-4 pb-4 pt-1">
                          <div className="row g-3">
                            <div className="col-12">
                              <div className="border rounded-3 p-3" style={{ background: '#f8fafc' }}>
                                <div className="row g-3 align-items-end">
                                  <div className="col-sm-4">
                                    <label htmlFor={`leave-colour-${idx}`} className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Colour</label>
                                    <input
                                      id={`leave-colour-${idx}`}
                                      type="color"
                                      className="form-control form-control-color w-100"
                                      value={cfg.color || '#3b82f6'}
                                      onChange={e => updateLeaveType(idx, { color: e.target.value })}
                                    />
                                  </div>
                                  <div className="col-sm-8">
                                    <label htmlFor={`leave-symbol-${idx}`} className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Symbol</label>
                                    <select
                                      id={`leave-symbol-${idx}`}
                                      className="form-select form-select-sm"
                                      value={cfg.icon || 'bi-calendar-check'}
                                      onChange={e => updateLeaveType(idx, { icon: e.target.value })}
                                    >
                                      {cfg.icon && !LEAVE_SYMBOLS.some(([icon]) => icon === cfg.icon) && <option value={cfg.icon}>Current symbol ({cfg.icon})</option>}
                                      {LEAVE_SYMBOLS.map(([icon, label]) => <option key={icon} value={icon}>{label}</option>)}
                                    </select>
                                  </div>
                                  <div className="col-12 d-flex align-items-center gap-3">
                                    <span style={{ fontSize: 12, color: '#64748b' }}>Preview</span>
                                    <span className="d-inline-flex align-items-center gap-2 rounded-3 px-3 py-2" style={{ background: `${cfg.color || '#3b82f6'}20`, color: cfg.color || '#3b82f6', fontSize: 13, fontWeight: 600 }}>
                                      <i className={`bi ${cfg.icon || 'bi-calendar-check'}`} aria-hidden="true" />{cfg.name} ({cfg.code})
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="col-12" id={`leave-links-${idx}`}>
                              <LeaveTypeBalanceFields config={cfg} configs={currentPolicy.leaveTypeConfigs || []} onChange={changes => updateLeaveType(idx, changes)} />
                            </div>
                            {cfg.balanceMode !== 'linked' && <div className="col-12">
                              <fieldset className="border rounded-3 p-3" style={{ background: '#f8fafc' }}>
                                <legend className="float-none w-auto px-2 mb-2" style={{ fontSize: 13, fontWeight: 700 }}>Leave entitlement</legend>
                                <div className="row g-3">
                                  <div className="col-12">
                                    <label htmlFor={`credit-frequency-${idx}`} className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Credit frequency</label>
                                    <select
                                      id={`credit-frequency-${idx}`}
                                      className="form-select"
                                      value={cfg.creditSchedule || 'upfront'}
                                      onChange={e => updateLeaveType(idx, { creditSchedule: e.target.value, accrualMode: e.target.value })}
                                    >
                                      {CREDIT_SCHEDULES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                  </div>
                                  <div className="col-sm-6">
                                    <label htmlFor={`days-per-credit-${idx}`} className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Days per {getCreditSchedule(cfg.creditSchedule).unit}</label>
                                    <input
                                      id={`days-per-credit-${idx}`}
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="form-control"
                                      value={getDaysPerCredit(cfg)}
                                      onChange={e => updateLeaveType(idx, { annualAllocation: getAnnualEntitlement(e.target.value, cfg.creditSchedule) })}
                                    />
                                  </div>
                                  <div className="col-sm-6">
                                    <label htmlFor={`annual-entitlement-${idx}`} className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Annual total (days)</label>
                                    <input
                                      id={`annual-entitlement-${idx}`}
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="form-control"
                                      value={cfg.annualAllocation ?? 0}
                                      onChange={e => updateLeaveType(idx, { annualAllocation: e.target.value === '' ? '' : Number(e.target.value) })}
                                    />
                                  </div>
                                </div>
                              </fieldset>
                            </div>}
                            <div className="col-6">
                              <label htmlFor={`leave-notice-${idx}`} className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>{cfg.balanceMode === 'linked' ? `${cfg.name} notice period (days)` : 'Notice Period (Days Required)'}</label>
                              <input
                                id={`leave-notice-${idx}`}
                                type="number"
                                min="0"
                                step="1"
                                className="form-control form-control-sm"
                                value={cfg.noticePeriodDays ?? 0}
                                onChange={e => {
                                  const updated = [...currentPolicy.leaveTypeConfigs];
                                  updated[idx].noticePeriodDays = parseInt(e.target.value, 10) || 0;
                                  setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                                }}
                              />
                              {cfg.balanceMode === 'linked' && <div className="form-text" style={{ fontSize: 11 }}>0 allows same-day requests. Only this notice period applies; the linked types’ notice periods are ignored.</div>}
                            </div>

                            <div className="col-6">
                              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Max Consecutive Days Cap</label>
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                value={cfg.maxConsecutiveDays ?? 0}
                                onChange={e => {
                                  const updated = [...currentPolicy.leaveTypeConfigs];
                                  updated[idx].maxConsecutiveDays = parseInt(e.target.value, 10) || 0;
                                  setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                                }}
                              />
                            </div>

                            <div className="col-6">
                              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Docs Required If Days &ge;</label>
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                value={cfg.requireDocsIfConsecutiveDays ?? 0}
                                onChange={e => {
                                  const updated = [...currentPolicy.leaveTypeConfigs];
                                  updated[idx].requireDocsIfConsecutiveDays = parseInt(e.target.value, 10) || 0;
                                  setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                                }}
                              />
                            </div>

                            <div className="col-12">
                              <div className="d-flex gap-3 mt-2">
                                {cfg.balanceMode !== 'linked' && <label className="form-check-label" style={{ fontSize: 12 }}>
                                  <input
                                    type="checkbox"
                                    className="form-check-input me-1"
                                    checked={cfg.isPaid !== false}
                                    disabled={cfg.balanceMode === 'linked'}
                                    onChange={e => {
                                      const updated = [...currentPolicy.leaveTypeConfigs];
                                      updated[idx].isPaid = e.target.checked;
                                      setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                                    }}
                                  />
                                  Paid Leave
                                </label>}

                                <label className="form-check-label" style={{ fontSize: 12 }}>
                                  <input
                                    type="checkbox"
                                    className="form-check-input me-1"
                                    checked={cfg.allowHalfDay !== false}
                                    onChange={e => {
                                      const updated = [...currentPolicy.leaveTypeConfigs];
                                      updated[idx].allowHalfDay = e.target.checked;
                                      setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                                    }}
                                  />
                                  Allow Half-Day
                                </label>

                                <label className="form-check-label" style={{ fontSize: 12 }}>
                                  <input
                                    type="checkbox"
                                    className="form-check-input me-1"
                                    checked={cfg.requiresDocuments || false}
                                    onChange={e => {
                                      const updated = [...currentPolicy.leaveTypeConfigs];
                                      updated[idx].requiresDocuments = e.target.checked;
                                      setCurrentPolicy({ ...currentPolicy, leaveTypeConfigs: updated });
                                    }}
                                  />
                                  Mandatory Docs
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LIVE SANDBOX SIMULATOR CONSOLE */}
          {activeTab === 'sandbox' && (
            <div className="row g-4">
              {/* Left Panel: Scenario Form */}
              <div className="col-md-5">
                <div className="card shadow-sm border-0" style={{ borderRadius: 14 }}>
                  <div className="card-header bg-white border-bottom-0 pt-4 px-4">
                    <h5 style={{ fontWeight: 700, margin: 0, color: '#0f172a' }}>
                      <i className="bi bi-[#10b981] bi-play-circle-fill text-success me-2" />
                      Scenario Simulator Setup
                    </h5>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                      Dry-run test any leave application scenario without writing to database.
                    </p>
                  </div>

                  <div className="card-body px-4 pb-4">
                    <div className="mb-3">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Test Target Employee</label>
                      <select
                        className="form-select"
                        value={simForm.targetUserId}
                        onChange={e => setSimForm({ ...simForm, targetUserId: e.target.value })}
                      >
                        {employees.map(emp => (
                          <option key={emp._id} value={emp._id}>
                            {emp.name} ({emp.role} — {emp.department || 'General'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mb-3">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Leave Type</label>
                      <select
                        className="form-select"
                        value={simForm.typeCode}
                        onChange={e => setSimForm({ ...simForm, typeCode: e.target.value })}
                      >
                        <option value="SL">SL — Sick Leave</option>
                        <option value="CL">CL — Casual Leave</option>
                        <option value="PL">PL — Privilege Leave</option>
                        <option value="LOP">LOP — Loss of Pay</option>
                      </select>
                    </div>

                    <div className="row g-2 mb-3">
                      <div className="col-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>From Date</label>
                        <DateInput
                          value={simForm.from}
                          onChange={e => setSimForm({ ...simForm, from: e.target.value })}
                        />
                      </div>
                      <div className="col-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>To Date</label>
                        <DateInput
                          value={simForm.to}
                          onChange={e => setSimForm({ ...simForm, to: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="mb-3 border p-3 rounded-3 bg-light">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="halfDaySim"
                          checked={simForm.halfDay}
                          onChange={e => setSimForm({ ...simForm, halfDay: e.target.checked })}
                        />
                        <label className="form-check-label fw-bold" htmlFor="halfDaySim" style={{ fontSize: 13 }}>
                          Apply as Half Day (0.5 Days)
                        </label>
                      </div>

                      {simForm.halfDay && (
                        <div className="d-flex gap-3 mt-2 ms-4">
                          <label style={{ fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="halfDayTypeSim"
                              checked={simForm.halfDayType === 'first_half'}
                              onChange={() => setSimForm({ ...simForm, halfDayType: 'first_half' })}
                              className="me-1"
                            />
                            First Half (Morning)
                          </label>
                          <label style={{ fontSize: 12, cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="halfDayTypeSim"
                              checked={simForm.halfDayType === 'second_half'}
                              onChange={() => setSimForm({ ...simForm, halfDayType: 'second_half' })}
                              className="me-1"
                            />
                            Second Half (Afternoon)
                          </label>
                        </div>
                      )}
                    </div>

                    <div className="mb-3">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason / Note</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        value={simForm.reason}
                        onChange={e => setSimForm({ ...simForm, reason: e.target.value })}
                      />
                    </div>

                    <div className="mb-4 form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="docSim"
                        checked={simForm.hasDocument}
                        onChange={e => setSimForm({ ...simForm, hasDocument: e.target.checked })}
                      />
                      <label className="form-check-label" htmlFor="docSim" style={{ fontSize: 13 }}>
                        Attach Test Supporting Document / Certificate
                      </label>
                    </div>

                    <button
                      className="btn btn-success w-100 py-2 fw-bold"
                      onClick={handleRunSimulation}
                      disabled={simulating}
                      style={{ borderRadius: 10, background: '#10b981', borderColor: '#10b981' }}
                    >
                      {simulating ? (
                        <><span className="spinner-border spinner-border-sm me-2" />Running Live Dry-Run Test...</>
                      ) : (
                        <><i className="bi bi-play-fill me-2" />Run Live Dry-Run Simulation</>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Panel: Simulation Output Results */}
              <div className="col-md-7">
                {simResult ? (
                  <div className="card shadow-sm border-0" style={{ borderRadius: 14 }}>
                    <div className="card-header bg-white border-bottom-0 pt-4 px-4 d-flex justify-content-between align-items-center">
                      <div>
                        <h5 style={{ fontWeight: 700, margin: 0, color: '#0f172a' }}>Simulation Execution Diagnostic Output</h5>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>Real-time dry-run output & trace metrics</p>
                      </div>

                      <span className={`badge ${simResult.isValid ? 'bg-success' : 'bg-danger'}`} style={{ fontSize: 13, padding: '8px 14px' }}>
                        {simResult.isValid ? '✓ SIMULATION PASSED (200 OK)' : '✗ REJECTED / VALIDATION FAILED'}
                      </span>
                    </div>

                    <div className="card-body px-4 pb-4">
                      {/* Banner Error if Failed */}
                      {!simResult.isValid && simResult.rejectionReason && (
                        <div className="alert alert-danger py-2 px-3 mb-4" style={{ borderRadius: 8, fontSize: 13 }}>
                          <i className="bi bi-exclamation-octagon-fill me-2" />
                          <strong>Rejection Cause:</strong> {simResult.rejectionReason}
                        </div>
                      )}

                      {/* Stat Metrics Grid */}
                      <div className="row g-3 mb-4">
                        <div className="col-3">
                          <div className="p-3 text-center border rounded-3 bg-light">
                            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Calendar Days</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>{simResult.totalCalendarDays ?? 0}</div>
                          </div>
                        </div>
                        <div className="col-3">
                          <div className="p-3 text-center border rounded-3 bg-light">
                            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Net Working Days</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: '#2563eb' }}>{simResult.calculatedDays ?? 0}</div>
                          </div>
                        </div>
                        <div className="col-3">
                          <div className="p-3 text-center border rounded-3 bg-light">
                            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Paid Days</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{simResult.paidDays ?? 0}</div>
                          </div>
                        </div>
                        <div className="col-3">
                          <div className="p-3 text-center border rounded-3 bg-light">
                            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Unpaid (LOP)</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: '#dc2626' }}>{simResult.unpaidDays ?? 0}</div>
                          </div>
                        </div>
                      </div>

                      {/* Approval Workflow Preview */}
                      {simResult.approvalWorkflow && simResult.approvalWorkflow.length > 0 && (
                        <div className="mb-4">
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>
                            Approval Chain Routing Preview:
                          </div>
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            {simResult.approvalWorkflow.map((step, sIdx) => (
                              <div key={step.step || sIdx} className="d-flex align-items-center gap-2">
                                <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: 8, fontSize: 12 }}>
                                  <span className="badge bg-primary me-2">Step {step.step}</span>
                                  <strong>{step.label}</strong>
                                </div>
                                {sIdx < simResult.approvalWorkflow.length - 1 && (
                                  <i className="bi bi-arrow-right text-muted" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Diagnostic Log Timeline Trace */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>
                          Rule Execution Diagnostic Trace:
                        </div>
                        <div style={{ background: '#0f172a', borderRadius: 10, padding: '14px 16px', color: '#f8fafc', fontFamily: 'monospace', fontSize: 12, maxHeight: 320, overflowY: 'auto' }}>
                          {(simResult.traceLogs || []).map((t, idx) => (
                            <div key={idx} style={{ marginBottom: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                              <span style={{ color: '#64748b' }}>[{t.time}]</span>
                              <span style={{
                                color: t.status === 'PASS' ? '#4ade80' : t.status === 'FAIL' ? '#f87171' : t.status === 'WARN' ? '#fbbf24' : '#60a5fa',
                                fontWeight: 700,
                                minWidth: 50
                              }}>
                                [{t.status}]
                              </span>
                              <span style={{ color: '#e2e8f0' }}>
                                <strong style={{ color: '#93c5fd' }}>{t.step}:</strong> {t.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card shadow-sm border-0 text-center p-5" style={{ borderRadius: 14, background: '#f8fafc', border: '2px dashed #cbd5e1' }}>
                    <i className="bi bi-sliders text-muted" style={{ fontSize: 42 }} />
                    <h5 className="mt-3" style={{ fontWeight: 700, color: '#334155' }}>No Simulation Executed Yet</h5>
                    <p style={{ color: '#64748b', fontSize: 13, maxWidth: 400, margin: '4px auto 0' }}>
                      Fill in test parameters on the left panel and click <strong>"Run Live Dry-Run Simulation"</strong> to test policy rules in real time.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        open={!!deletePolicy}
        title="Delete leave policy?"
        confirmText="Delete Policy"
        variant="danger"
        confirming={deleting}
        onClose={() => { if (!deleting) setDeletePolicy(null); }}
        onConfirm={handleDeletePolicy}
      >
        <p>Delete <strong>{deletePolicy?.name}</strong>? It will no longer apply to new leave applications. Existing leave history will be retained.</p>
        {deletePolicy?.isDefault && <p className="text-danger">This is the corporate default policy. Employees relying on it will need another applicable policy.</p>}
        <p className="mb-0 text-secondary">Any unsaved changes and saved draft for this policy will be discarded.</p>
      </ConfirmModal>

      <ConfirmModal
        open={!!removeType}
        title="Remove leave type?"
        confirmText="Remove Type"
        variant="danger"
        onClose={() => setRemoveType(null)}
        onConfirm={() => {
          setCurrentPolicy(policy => ({ ...policy, leaveTypeConfigs: policy.leaveTypeConfigs.filter((_, index) => index !== removeType.index) }));
          setRemoveType(null);
        }}
      >
        <p>Remove <strong>{removeType?.name} ({removeType?.code})</strong> from this policy?</p>
        <p className="mb-0 text-secondary">The change takes effect when you publish the policy. Existing leave history will be retained.</p>
      </ConfirmModal>

      <ConfirmModal open={showAddType} title="Add leave type" confirmText="Add Leave Type" onClose={() => setShowAddType(false)} onConfirm={handleAddType}>
        <form style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 6 }} onSubmit={event => { event.preventDefault(); handleAddType(); }}>
          {typeError && <div className="alert alert-danger py-2" role="alert">{typeError}</div>}
          <div className="mb-3">
            <label className="form-label" htmlFor="new-leave-code">Code</label>
            <input id="new-leave-code" className="form-control" placeholder="e.g. STUDY" autoFocus required value={newType.code} onChange={event => setNewType({ ...newType, code: event.target.value.toUpperCase() })} />
          </div>
          <div className="mb-3">
            <label className="form-label" htmlFor="new-leave-name">Name</label>
            <input id="new-leave-name" className="form-control" placeholder="e.g. Study Leave" required value={newType.name} onChange={event => setNewType({ ...newType, name: event.target.value })} />
          </div>
          <div className="mb-3">
            <LeaveTypeBalanceFields config={newType} configs={currentPolicy?.leaveTypeConfigs || []} onChange={changes => setNewType(type => ({ ...type, ...changes }))} />
          </div>
          {newType.balanceMode !== 'linked' && <div className="mb-3">
            <label className="form-label" htmlFor="new-leave-allocation">Annual allocation (days)</label>
            <input id="new-leave-allocation" type="number" min="0" step="0.5" required className="form-control" value={newType.annualAllocation} onChange={event => setNewType({ ...newType, annualAllocation: event.target.value })} />
          </div>}
          <div className="mb-3">
            <label className="form-label" htmlFor="new-leave-notice">Notice period (days)</label>
            <input id="new-leave-notice" type="number" min="0" step="1" className="form-control" value={newType.noticePeriodDays ?? 0} onChange={event => setNewType(type => ({ ...type, noticePeriodDays: event.target.value }))} />
            {newType.balanceMode === 'linked' && <div className="form-text">Only this leave type’s notice period applies. Use 0 for same-day emergency requests.</div>}
          </div>
          <p className="mb-0 text-secondary" style={{ fontSize: 13 }}>After adding, choose its colour, symbol, and rules in the leave type card. Publish the policy to apply it.</p>
        </form>
      </ConfirmModal>

      {/* Create New Policy Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 520, width: '100%', padding: 28, boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 style={{ fontWeight: 700, margin: 0, color: '#0f172a' }}>
                <i className="bi bi-file-earmark-plus me-2 text-primary" />Create New Leave Policy
              </h5>
              <button className="btn-close" onClick={() => setShowCreateModal(false)} />
            </div>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
              Define a new leave policy rule-set. Standard leave types (CL, SL, PL, LOP) will be initialized automatically.
            </p>

            <form onSubmit={handleCreatePolicy}>
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Policy Name *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Executive Leave Policy 2026"
                  value={newPolicyForm.name}
                  onChange={e => setNewPolicyForm({ ...newPolicyForm, name: e.target.value })}
                  required
                />
              </div>

              <div className="mb-3">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="Describe scope, rules, or intended user groups..."
                  value={newPolicyForm.description}
                  onChange={e => setNewPolicyForm({ ...newPolicyForm, description: e.target.value })}
                />
              </div>

              <div className="mb-4 form-check">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="isDefaultCheck"
                  checked={newPolicyForm.isDefault}
                  onChange={e => setNewPolicyForm({ ...newPolicyForm, isDefault: e.target.checked })}
                />
                <label className="form-check-label" htmlFor="isDefaultCheck" style={{ fontSize: 13 }}>
                  Set as Corporate Default Policy
                </label>
              </div>

              <div className="d-flex justify-content-end gap-2">
                <button type="button" className="btn btn-light fw-bold" onClick={() => setShowCreateModal(false)} style={{ borderRadius: 8 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary fw-bold" disabled={creating} style={{ borderRadius: 8, padding: '8px 20px' }}>
                  {creating ? <><span className="spinner-border spinner-border-sm me-2" />Creating...</> : 'Create & Provision Policy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
