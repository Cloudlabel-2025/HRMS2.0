'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';

const ACTIONS = [
  { key: 'confirm_probation', label: 'Probation', icon: 'bi-shield-check',    color: '#3b82f6', help: 'Move onboarding → probation, or confirm probation → active.' },
  { key: 'transfer',          label: 'Transfer',  icon: 'bi-arrow-left-right', color: '#8b5cf6', help: 'Update department, location, shift, and reporting details.' },
  { key: 'promotion',         label: 'Promote',   icon: 'bi-graph-up-arrow',   color: '#10b981', help: 'Record designation, grade, band, and compensation group movement.' },
  { key: 'rehire',            label: 'Rehire',    icon: 'bi-person-plus',      color: '#06b6d4', help: 'Restore an employee with fresh assignment details.' },
  { key: 'suspend',           label: 'Suspend',   icon: 'bi-pause-circle',     color: '#f59e0b', help: 'Place an employee on suspension.' },
  { key: 'separation',        label: 'Separate',  icon: 'bi-box-arrow-right',  color: '#ef4444', help: 'Capture exit details, notice period, and settlement status.' },
];

const STATUS_CONFIG = {
  onboarding: { color: '#3b82f6', bg: '#eff6ff', label: 'Onboarding' },
  probation:  { color: '#f59e0b', bg: '#fffbeb', label: 'Probation' },
  active:     { color: '#10b981', bg: '#f0fdf4', label: 'Active' },
  suspended:  { color: '#ef4444', bg: '#fef2f2', label: 'Suspended' },
  resigned:   { color: '#6b7280', bg: '#f9fafb', label: 'Resigned' },
  terminated: { color: '#dc2626', bg: '#fef2f2', label: 'Terminated' },
  retired:    { color: '#6b7280', bg: '#f9fafb', label: 'Retired' },
  rehired:    { color: '#06b6d4', bg: '#ecfeff', label: 'Rehired' },
  alumni:     { color: '#94a3b8', bg: '#f8fafc', label: 'Alumni' },
  active_legacy: { color: '#64748b', bg: '#f1f5f9', label: 'Legacy' },
};

const EMPTY_FORM = {
  profileId: '', effectiveDate: '', reason: '', confirmationNote: '',
  department: '', designation: '', businessUnit: '', workLocation: '', shift: '',
  managerIdentityId: '', teamLeadIdentityId: '', teamAdminIdentityId: '',
  grade: '', payGroup: '', band: '', employmentType: 'full_time',
  separationType: 'resignation', noticePeriodDays: 0, lastWorkingDate: '',
  settlementStatus: 'pending', exitInterviewComplete: false, suspensionUntil: '',
};

const fmt = s => String(s || '').replace(/_/g, ' ');
const getRecordId = v => String(v?._id || v || '');

function StatusBadge({ status, isLegacy }) {
  const cfg = isLegacy ? STATUS_CONFIG.active_legacy : (STATUS_CONFIG[status] || STATUS_CONFIG.active_legacy);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: cfg.bg, color: cfg.color, textTransform: 'capitalize', border: `1px solid ${cfg.color}30` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      {isLegacy ? 'Legacy' : cfg.label}
    </span>
  );
}

function Field({ label, children, col = 'col-md-6' }) {
  return (
    <div className={col}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'block' }}>{label}</label>
      {children}
    </div>
  );
}

function SectionHeader({ icon, title, color = '#3b82f6' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={`bi ${icon}`} style={{ color, fontSize: 14 }} />
      </div>
      <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{title}</span>
    </div>
  );
}

export default function CoreHrPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [profiles, setProfiles]     = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [history, setHistory]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts]         = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [action, setAction]         = useState('confirm_probation');
  const [form, setForm]             = useState(EMPTY_FORM);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [clearanceSaving, setClearanceSaving] = useState(false);
  const [error, setError]           = useState('');
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const allItems = useMemo(() => [
    ...profiles.map(p => ({
      key: `core:${p._id}`, kind: 'core', id: p._id,
      name: p.identityId?.legalName || p.employeeNumber || 'Unknown',
      employeeNumber: p.employeeNumber || '',
      department: p.department || '', designation: p.designation || '',
      status: p.employmentStatus || 'unknown', record: p,
    })),
    ...employees.map(e => ({
      key: `legacy:${e._id}`, kind: 'legacy', id: e._id,
      name: e.name || 'Unknown', employeeNumber: e.email || '',
      department: e.department || '', designation: e.designation || '',
      status: e.status || 'unknown', record: e,
    })),
  ], [profiles, employees]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allItems.filter(p => {
      const matchSearch = !term || [p.name, p.employeeNumber, p.department, p.designation, p.status].some(v => String(v || '').toLowerCase().includes(term));
      const matchStatus = !statusFilter || p.status === statusFilter || (statusFilter === 'legacy' && p.kind === 'legacy');
      return matchSearch && matchStatus;
    });
  }, [allItems, search, statusFilter]);

  const selectedProfile  = useMemo(() => profiles.find(p => `core:${p._id}` === selectedKey), [profiles, selectedKey]);
  const selectedEmployee = useMemo(() => employees.find(e => `legacy:${e._id}` === selectedKey), [employees, selectedKey]);
  const selectedItem     = filteredItems.find(i => i.key === selectedKey);

  const actionMeta = ACTIONS.find(a => a.key === action) || ACTIONS[0];

  const ACTION_DEFAULTS = {
    confirm_probation: { confirmationNote: '' },
    transfer:   { department: selectedProfile?.department || '', designation: selectedProfile?.designation || '', businessUnit: selectedProfile?.businessUnit || '', workLocation: selectedProfile?.workLocation || '', shift: selectedProfile?.shift || '' },
    promotion:  { designation: selectedProfile?.designation || '', businessUnit: selectedProfile?.businessUnit || '', grade: '', payGroup: '', band: '' },
    rehire:     { department: '', designation: '', employmentType: 'full_time', workLocation: '', shift: '' },
    suspend:    { suspensionUntil: '' },
    separation: { separationType: 'resignation', lastWorkingDate: '', noticePeriodDays: 0, settlementStatus: 'pending', exitInterviewComplete: false },
  };

  const switchAction = key => {
    setAction(key);
    setForm(prev => ({ ...EMPTY_FORM, profileId: prev.profileId, ...ACTION_DEFAULTS[key] }));
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [profileRes, employeeRes, deptRes, desigRes, shiftRes] = await Promise.all([
        api.get('/api/core/profiles?limit=200'),
        api.get('/api/employees'),
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=designations'),
        api.get('/api/settings?type=shifts'),
      ]);
      setProfiles(Array.isArray(profileRes.items) ? profileRes.items : []);
      setEmployees(Array.isArray(employeeRes) ? employeeRes : []);
      setDepartments(Array.isArray(deptRes) ? deptRes.map(d => d.name) : []);
      setDesignations(Array.isArray(desigRes) ? desigRes : []);
      setShifts(Array.isArray(shiftRes) ? shiftRes.map(s => s.name) : []);
      if (!selectedKey) {
        const first = profileRes.items?.[0];
        setSelectedKey(first ? `core:${first._id}` : employeeRes?.[0] ? `legacy:${employeeRes[0]._id}` : '');
      }
    } catch (e) { setError(e.message); showToast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (!selectedKey || !selectedProfile) { setHistory([]); return; }
    api.get(`/api/core/lifecycle?profileId=${selectedProfile._id}&limit=20`)
      .then(res => setHistory(Array.isArray(res.items) ? res.items : []))
      .catch(() => {});
  }, [selectedKey, selectedProfile]);

  useEffect(() => {
    if (selectedProfile) {
      setAction('confirm_probation');
      setForm({ ...EMPTY_FORM, profileId: selectedProfile._id, department: selectedProfile.department || '', designation: selectedProfile.designation || '', businessUnit: selectedProfile.businessUnit || '', workLocation: selectedProfile.workLocation || '', shift: selectedProfile.shift || '' });
    }
  }, [selectedProfile?._id]);

  useEffect(() => {
    if (filteredItems.length && !filteredItems.some(p => p.key === selectedKey)) {
      setSelectedKey(filteredItems[0].key);
    }
  }, [filteredItems]);

  const updateClearance = async (field, value) => {
    if (!selectedProfile) return;
    setClearanceSaving(true);
    try {
      const res = await api.patch('/api/core/profiles/clearance', { profileId: selectedProfile._id, field, value });
      showToast(value ? 'Marked complete' : 'Unchecked');
      if (res.isLocked) showToast('Profile locked — all clearance items complete', 'success');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setClearanceSaving(false); }
  };

  const submit = async () => {
    if (!selectedProfile) return showToast('Select a core profile to apply transitions', 'error');
    if (action !== 'confirm_probation' && !form.reason) return showToast('Reason is required', 'error');
    const payload = { action, data: { ...form } };
    if (!form.effectiveDate) delete payload.data.effectiveDate;
    if (!form.lastWorkingDate) delete payload.data.lastWorkingDate;
    if (!form.suspensionUntil) delete payload.data.suspensionUntil;
    setSaving(true);
    try {
      await api.post('/api/core/lifecycle/transition', payload);
      showToast('Lifecycle transition applied successfully');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const statuses = [...new Set(profiles.map(p => p.employmentStatus).filter(Boolean))];
  const isSeparated = selectedProfile && ['resigned','terminated','retired','alumni'].includes(selectedProfile.employmentStatus);

  return (
    <AppShell title="Core HR Lifecycle">
      {toast && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#3b82f615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi bi-diagram-3" style={{ color: '#3b82f6', fontSize: 15 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 1 }}>Core HR</span>
          </div>
          <h4 style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>Employment Lifecycle</h4>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Review employee status, apply lifecycle transitions, and audit recent changes.</p>
        </div>
        <button className="btn btn-outline-primary btn-sm" onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className={`bi bi-arrow-repeat ${loading ? 'spin' : ''}`} />Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-danger d-flex align-items-center justify-content-between" role="alert">
          <span>{error}</span>
          <button className="btn btn-sm btn-outline-danger" onClick={load}>Retry</button>
        </div>
      )}

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Core Profiles', value: profiles.length, icon: 'bi-person-vcard', color: '#3b82f6' },
          { label: 'Active', value: profiles.filter(p => p.employmentStatus === 'active').length, icon: 'bi-person-check', color: '#10b981' },
          { label: 'Onboarding', value: profiles.filter(p => ['onboarding','probation'].includes(p.employmentStatus)).length, icon: 'bi-person-plus', color: '#f59e0b' },
          { label: 'Separated', value: profiles.filter(p => ['resigned','terminated','retired'].includes(p.employmentStatus)).length, icon: 'bi-person-dash', color: '#ef4444' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{s.value}</div>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: 17 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Main Workspace */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start' }}>

        {/* ── LEFT: Directory ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Employee Directory</div>
              {/* Search */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 12 }} />
                <input className="form-control" style={{ paddingLeft: 30, fontSize: 12, borderRadius: 8 }} placeholder="Search name, dept, status..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              {/* Status filter */}
              <select className="form-select" style={{ fontSize: 12, borderRadius: 8 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                {statuses.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
                <option value="legacy">Legacy Only</option>
              </select>
            </div>

            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {loading && <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 13 }}><span className="spinner-border spinner-border-sm me-2" />Loading...</div>}
              {!loading && filteredItems.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
                  <i className="bi bi-people" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>No employees found</div>
                </div>
              )}
              {filteredItems.map(item => (
                <button key={item.key} type="button" onClick={() => setSelectedKey(item.key)}
                  style={{ width: '100%', textAlign: 'left', padding: '11px 14px', border: 'none', borderBottom: '1px solid #f8fafc', cursor: 'pointer', background: selectedKey === item.key ? '#eff6ff' : 'transparent', borderLeft: selectedKey === item.key ? '3px solid #3b82f6' : '3px solid transparent', transition: 'all 0.1s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: selectedKey === item.key ? '#3b82f6' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: selectedKey === item.key ? '#fff' : '#64748b', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {item.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.kind === 'core' ? (item.employeeNumber || 'No ID') : item.department || 'Legacy'}
                      </div>
                    </div>
                    <StatusBadge status={item.status} isLegacy={item.kind === 'legacy'} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Selected Employee Snapshot */}
          {selectedItem && (
            <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 46, height: 46, borderRadius: 12, background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                  {selectedItem.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{selectedItem.name}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedItem.employeeNumber || 'No employee number'}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Status', <StatusBadge key="s" status={selectedItem.status} isLegacy={selectedItem.kind === 'legacy'} />],
                  ['Department', <span key="d" style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{selectedItem.department || '—'}</span>],
                  ['Designation', <span key="dg" style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{selectedItem.designation || '—'}</span>],
                  ['Hire Date', <span key="h" style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{selectedProfile ? formatDate(selectedProfile.hireDate) : '—'}</span>],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
                    {val}
                  </div>
                ))}
              </div>
              {selectedItem.kind === 'legacy' && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#f59e0b', background: '#fffbeb', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="bi bi-exclamation-triangle" />Legacy record — lifecycle actions require a Core HR profile.
                </div>
              )}
              {selectedProfile?.isLocked && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#dc2626', background: '#fef2f2', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="bi bi-lock-fill" />Profile locked after exit clearance.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Actions + History ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Lifecycle Action Card */}
          <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 14, overflow: 'hidden' }}>
            {/* Action Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f1f5f9', overflowX: 'auto' }}>
              {ACTIONS.map(item => (
                <button key={item.key} type="button" onClick={() => switchAction(item.key)} disabled={!selectedProfile}
                  style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '12px 18px', border: 'none', borderBottom: action === item.key ? `3px solid ${item.color}` : '3px solid transparent', fontWeight: action === item.key ? 700 : 500, fontSize: 13, cursor: selectedProfile ? 'pointer' : 'not-allowed', background: 'transparent', color: action === item.key ? item.color : '#94a3b8', transition: 'all 0.15s', opacity: !selectedProfile ? 0.5 : 1 }}>
                  <i className={`bi ${item.icon}`} style={{ fontSize: 14 }} />{item.label}
                </button>
              ))}
            </div>

            <div style={{ padding: '20px 20px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: actionMeta.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className={`bi ${actionMeta.icon}`} style={{ color: actionMeta.color, fontSize: 13 }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{actionMeta.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedProfile ? actionMeta.help : 'Select a core profile from the directory to enable actions.'}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '0 20px 20px' }}>
              <div className="row g-3">
                <Field label="Effective Date">
                  <input className="form-control" type="date" style={{ fontSize: 13 }} value={form.effectiveDate} onChange={e => setForm(p => ({ ...p, effectiveDate: e.target.value }))} />
                </Field>
                <Field label="Reason / Notes">
                  <input className="form-control" style={{ fontSize: 13 }} placeholder="Policy or business reason" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
                </Field>

                {action === 'confirm_probation' && (
                  <Field label="Confirmation Note" col="col-12">
                    <input className="form-control" style={{ fontSize: 13 }} value={form.confirmationNote} onChange={e => setForm(p => ({ ...p, confirmationNote: e.target.value }))} placeholder="e.g. Probation confirmed — performance satisfactory" />
                  </Field>
                )}

                {action === 'transfer' && (<>
                  <Field label="Department">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value, designation: '' }))}>
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="Designation">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} disabled={!form.department}>
                      <option value="">{form.department ? 'Select designation' : 'Select dept first'}</option>
                      {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Business Unit"><input className="form-control" style={{ fontSize: 13 }} value={form.businessUnit} onChange={e => setForm(p => ({ ...p, businessUnit: e.target.value }))} /></Field>
                  <Field label="Work Location"><input className="form-control" style={{ fontSize: 13 }} value={form.workLocation} onChange={e => setForm(p => ({ ...p, workLocation: e.target.value }))} /></Field>
                  <Field label="Shift" col="col-12">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.shift} onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}>
                      <option value="">Select shift</option>
                      {shifts.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                </>)}

                {action === 'promotion' && (<>
                  <Field label="New Designation">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))}>
                      <option value="">Select designation</option>
                      {designations.map(d => <option key={d._id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}
                    </select>
                  </Field>
                  <Field label="Business Unit"><input className="form-control" style={{ fontSize: 13 }} value={form.businessUnit} onChange={e => setForm(p => ({ ...p, businessUnit: e.target.value }))} /></Field>
                  <Field label="Grade" col="col-md-4"><input className="form-control" style={{ fontSize: 13 }} value={form.grade} onChange={e => setForm(p => ({ ...p, grade: e.target.value }))} /></Field>
                  <Field label="Pay Group" col="col-md-4"><input className="form-control" style={{ fontSize: 13 }} value={form.payGroup} onChange={e => setForm(p => ({ ...p, payGroup: e.target.value }))} /></Field>
                  <Field label="Band" col="col-md-4"><input className="form-control" style={{ fontSize: 13 }} value={form.band} onChange={e => setForm(p => ({ ...p, band: e.target.value }))} /></Field>
                </>)}

                {action === 'rehire' && (<>
                  <Field label="Department">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value, designation: '' }))}>
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="Designation">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} disabled={!form.department}>
                      <option value="">{form.department ? 'Select designation' : 'Select dept first'}</option>
                      {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Employment Type">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.employmentType} onChange={e => setForm(p => ({ ...p, employmentType: e.target.value }))}>
                      {['full_time','part_time','contract','intern','consultant','apprentice'].map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                    </select>
                  </Field>
                  <Field label="Work Location"><input className="form-control" style={{ fontSize: 13 }} value={form.workLocation} onChange={e => setForm(p => ({ ...p, workLocation: e.target.value }))} /></Field>
                  <Field label="Shift" col="col-12">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.shift} onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}>
                      <option value="">Select shift</option>
                      {shifts.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                </>)}

                {action === 'suspend' && (
                  <Field label="Suspension Until">
                    <input className="form-control" type="date" style={{ fontSize: 13 }} value={form.suspensionUntil} onChange={e => setForm(p => ({ ...p, suspensionUntil: e.target.value }))} />
                  </Field>
                )}

                {action === 'separation' && (<>
                  <Field label="Separation Type">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.separationType} onChange={e => setForm(p => ({ ...p, separationType: e.target.value }))}>
                      {['resignation','termination','retirement','contract_end','medical_exit','death','other'].map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                    </select>
                  </Field>
                  <Field label="Last Working Date">
                    <input className="form-control" type="date" style={{ fontSize: 13 }} value={form.lastWorkingDate} onChange={e => setForm(p => ({ ...p, lastWorkingDate: e.target.value }))} />
                  </Field>
                  <Field label="Notice Period (days)" col="col-md-4">
                    <input className="form-control" type="number" min="0" max="365" style={{ fontSize: 13 }} value={form.noticePeriodDays} onChange={e => setForm(p => ({ ...p, noticePeriodDays: Number(e.target.value) }))} />
                  </Field>
                  <Field label="Settlement Status" col="col-md-4">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.settlementStatus} onChange={e => setForm(p => ({ ...p, settlementStatus: e.target.value }))}>
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="settled">Settled</option>
                    </select>
                  </Field>
                  <Field label=" " col="col-md-4">
                    <div className="form-check" style={{ marginTop: 6 }}>
                      <input className="form-check-input" type="checkbox" checked={form.exitInterviewComplete} onChange={e => setForm(p => ({ ...p, exitInterviewComplete: e.target.checked }))} />
                      <label className="form-check-label" style={{ fontSize: 13 }}>Exit interview done</label>
                    </div>
                  </Field>
                </>)}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f8fafc' }}>
                <button className="btn btn-primary" onClick={submit} disabled={saving || !selectedProfile} style={{ fontSize: 13 }}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Applying...</> : <><i className={`bi ${actionMeta.icon} me-2`} />Apply {actionMeta.label}</>}
                </button>
                <button className="btn btn-outline-secondary" style={{ fontSize: 13 }} onClick={() => setForm(p => ({ ...EMPTY_FORM, profileId: p.profileId }))}>
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Exit Clearance Checklist */}
          {isSeparated && (
            <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#fef2f215', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-clipboard-check" style={{ color: '#ef4444', fontSize: 14 }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Exit Clearance Checklist</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Profile auto-locks when all items are complete and settlement is settled.</div>
                  </div>
                </div>
                {selectedProfile?.isLocked && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '4px 10px', borderRadius: 20 }}>
                    <i className="bi bi-lock-fill" />Locked
                  </span>
                )}
              </div>
              <div style={{ padding: '16px 20px' }}>
                <div className="row g-2">
                  {[
                    { field: 'assetReturned',     label: 'Asset Returned',   icon: 'bi-laptop',             desc: 'All company assets returned' },
                    { field: 'accessRevoked',     label: 'Access Revoked',   icon: 'bi-shield-x',           desc: 'System & email access revoked' },
                    { field: 'finalSettlement',   label: 'Final Settlement', icon: 'bi-cash-coin',          desc: 'Full & final payment done' },
                    { field: 'exitInterviewDone', label: 'Exit Interview',   icon: 'bi-chat-square-text',   desc: 'Exit interview completed' },
                    { field: 'nocIssued',         label: 'NOC Issued',       icon: 'bi-file-earmark-check', desc: 'No Objection Certificate issued' },
                    { field: 'relievingLetter',   label: 'Relieving Letter', icon: 'bi-file-earmark-text',  desc: 'Relieving letter issued' },
                  ].map(({ field, label, icon, desc }) => {
                    const checked = !!selectedProfile?.separation?.clearanceChecklist?.[field];
                    return (
                      <div key={field} className="col-md-6">
                        <div onClick={() => !selectedProfile.isLocked && !clearanceSaving && updateClearance(field, !checked)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 10, border: `1px solid ${checked ? '#bbf7d0' : '#e2e8f0'}`, background: checked ? '#f0fdf4' : '#f8fafc', cursor: selectedProfile.isLocked ? 'not-allowed' : 'pointer', transition: 'all 0.15s', opacity: selectedProfile.isLocked ? 0.65 : 1 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 8, background: checked ? '#dcfce7' : '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <i className={`bi ${checked ? 'bi-check-circle-fill' : icon}`} style={{ color: checked ? '#16a34a' : '#3b82f6', fontSize: 15 }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: checked ? '#15803d' : '#1e293b' }}>{label}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{desc}</div>
                          </div>
                          <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${checked ? '#16a34a' : '#cbd5e1'}`, background: checked ? '#16a34a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {checked && <i className="bi bi-check" style={{ color: '#fff', fontSize: 11 }} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {clearanceSaving && <div style={{ marginTop: 12, fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}><span className="spinner-border spinner-border-sm" />Saving...</div>}
              </div>
            </div>
          )}

          {/* Lifecycle History */}
          <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="bi bi-clock-history" style={{ color: '#64748b', fontSize: 14 }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Lifecycle History</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{selectedProfile ? `${history.length} event${history.length !== 1 ? 's' : ''} recorded` : 'Select a core profile to view history'}</div>
              </div>
            </div>
            <div style={{ padding: '12px 20px' }}>
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8' }}>
                  <i className="bi bi-clock-history" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>{selectedProfile ? 'No history entries yet' : 'No profile selected'}</div>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 15, top: 8, bottom: 8, width: 2, background: '#f1f5f9' }} />
                  {history.map((item, idx) => (
                    <div key={item._id} style={{ display: 'flex', gap: 14, paddingBottom: idx < history.length - 1 ? 16 : 0, position: 'relative' }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#fff', border: '2px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1 }}>
                        <i className="bi bi-arrow-repeat" style={{ color: '#3b82f6', fontSize: 12 }} />
                      </div>
                      <div style={{ flex: 1, paddingTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', textTransform: 'capitalize' }}>{fmt(item.action)}</span>
                          <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 20 }}>{item.eventType}</span>
                        </div>
                        {(item.fromState || item.toState) && (
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ textTransform: 'capitalize' }}>{item.fromState || '—'}</span>
                            <i className="bi bi-arrow-right" style={{ fontSize: 10 }} />
                            <span style={{ textTransform: 'capitalize', fontWeight: 600, color: '#1e293b' }}>{item.toState || '—'}</span>
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{formatDate(item.createdAt)}</div>
                        {item.reason && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontStyle: 'italic' }}>"{item.reason}"</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}
