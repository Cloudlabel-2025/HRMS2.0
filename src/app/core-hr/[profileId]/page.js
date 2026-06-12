'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { useSettings } from '@/lib/settings';

const ACTIONS = [
  { key: 'confirm_probation', label: 'Probation',  icon: 'bi-shield-check',    color: '#3b82f6', help: 'Onboarding → Probation, or confirm Probation → Active.' },
  { key: 'transfer',          label: 'Transfer',   icon: 'bi-arrow-left-right', color: '#8b5cf6', help: 'Update department, designation and shift.' },
  { key: 'promotion',         label: 'Promote',    icon: 'bi-graph-up-arrow',   color: '#10b981', help: 'Record a new designation for the employee.' },
  { key: 'rehire',            label: 'Rehire',     icon: 'bi-person-plus',      color: '#06b6d4', help: 'Restore a separated employee with new assignment details.' },
  { key: 'suspend',           label: 'Suspend',    icon: 'bi-pause-circle',     color: '#f59e0b', help: 'Place an employee on suspension.' },
  { key: 'separation',        label: 'Separate',   icon: 'bi-box-arrow-right',  color: '#ef4444', help: 'Record exit details and track offboarding clearance.' },
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
};

const CLEARANCE_ITEMS = [
  { field: 'assetReturned',     label: 'Asset Returned',   icon: 'bi-laptop',             desc: 'All company assets returned' },
  { field: 'accessRevoked',     label: 'Access Revoked',   icon: 'bi-shield-x',           desc: 'System & email access revoked' },
  { field: 'finalSettlement',   label: 'Final Settlement', icon: 'bi-cash-coin',          desc: 'Full & final payment done' },
  { field: 'exitInterviewDone', label: 'Exit Interview',   icon: 'bi-chat-square-text',   desc: 'Exit interview completed' },
  { field: 'nocIssued',         label: 'NOC Issued',       icon: 'bi-file-earmark-check', desc: 'No Objection Certificate issued' },
  { field: 'relievingLetter',   label: 'Relieving Letter', icon: 'bi-file-earmark-text',  desc: 'Relieving letter issued' },
];

const EMPTY_FORM = {
  profileId: '', effectiveDate: '', reason: '', confirmationNote: '',
  department: '', designation: '', shift: '',
  employmentType: 'full_time',
  separationType: 'resignation', noticePeriodDays: 0, lastWorkingDate: '',
  suspensionUntil: '', probationEndDate: '',
};

const fmt = s => String(s || '').replace(/_/g, ' ');

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#64748b', bg: '#f1f5f9', label: status };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color, textTransform: 'capitalize', border: `1px solid ${cfg.color}30` }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function InfoChip({ icon, label, value, color = '#3b82f6' }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
      <i className={`bi ${icon}`} style={{ color, fontSize: 14 }} />
      <span style={{ fontWeight: 500 }}>{label && <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>{label}:</span>}{value}</span>
    </div>
  );
}

function DetailCard({ icon, label, value }) {
  if (!value) return null;
  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px', border: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 13 }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1e293b', textTransform: 'capitalize' }}>{value}</div>
    </div>
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

export default function CoreHrProfilePage() {
  const { profileId } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { formatDate } = useSettings();

  const [profile, setProfile]           = useState(null);
  const [identity, setIdentity]         = useState(null);
  const [empUser, setEmpUser]           = useState(null);
  const [history, setHistory]           = useState([]);
  const [departments, setDepartments]   = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [clearanceSaving, setClearanceSaving] = useState(false);
  const [action, setAction]             = useState('confirm_probation');
  const [form, setForm]                 = useState(EMPTY_FORM);
  const [toast, setToast]               = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const load = async () => {
    setLoading(true);
    try {
      const [profileRes, deptRes, desigRes, shiftRes] = await Promise.all([
        api.get(`/api/core/profiles/${profileId}`),
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=designations'),
        api.get('/api/settings?type=shifts'),
      ]);

      // API returns { profile } wrapped
      const p = profileRes.profile || profileRes;
      setProfile(p);
      setDepartments(Array.isArray(deptRes) ? deptRes.map(d => d.name) : []);
      setDesignations(Array.isArray(desigRes) ? desigRes : []);
      setShifts(Array.isArray(shiftRes) ? shiftRes.map(s => s.name) : []);
      setForm({ ...EMPTY_FORM, profileId, department: p.department || '', designation: p.designation || '', shift: p.shift || '' });

      // Fetch full identity
      if (p.identityId?._id || p.identityId) {
        const identityId = p.identityId?._id || p.identityId;
        try {
          const idRes = await api.get(`/api/core/identities/${identityId}`);
          setIdentity(idRes.identity || idRes);
        } catch {}
      }

      // Fetch linked auth user for role, email, phone, skills
      if (p.identityId?.authUserId) {
        try {
          const employees = await api.get('/api/employees');
          const linked = Array.isArray(employees)
            ? employees.find(e => e._id === p.identityId.authUserId?.toString?.())
            : null;
          if (linked) setEmpUser(linked);
        } catch {}
      }
    } catch (e) {
      showToast(e.message, 'error');
      setTimeout(() => router.push('/core-hr'), 2000);
    } finally { setLoading(false); }
  };

  const loadHistory = async () => {
    try {
      const res = await api.get(`/api/core/lifecycle?profileId=${profileId}&limit=30`);
      setHistory(Array.isArray(res.items) ? res.items : []);
    } catch {}
  };

  useEffect(() => { if (user && profileId) { load(); loadHistory(); } }, [user, profileId]);

  const isInProbation    = profile?.employmentStatus === 'probation';
  const probationEndDate = profile?.probationEndDate ? new Date(profile.probationEndDate) : null;
  const probationEnded   = probationEndDate ? new Date() >= probationEndDate : false;
  const probationTabLocked = isInProbation && !probationEnded;
  const isSeparated      = profile && ['resigned','terminated','retired','alumni'].includes(profile.employmentStatus);
  const actionMeta       = ACTIONS.find(a => a.key === action) || ACTIONS[0];

  const switchAction = key => {
    setAction(key);
    setForm({ ...EMPTY_FORM, profileId, department: profile?.department || '', designation: profile?.designation || '', shift: profile?.shift || '' });
  };

  const submit = async () => {
    if (!form.effectiveDate) return showToast('Effective date is required', 'error');
    if (action !== 'confirm_probation' && !form.reason.trim()) return showToast('Reason is required', 'error');
    if (action === 'confirm_probation' && !form.confirmationNote?.trim()) return showToast('Confirmation note is required', 'error');
    if (action === 'transfer' && (!form.department || !form.designation)) return showToast('Department and designation are required', 'error');
    if (action === 'promotion' && !form.designation) return showToast('New designation is required', 'error');
    if (action === 'rehire' && (!form.department || !form.designation)) return showToast('Department and designation are required', 'error');
    if (action === 'separation' && !form.lastWorkingDate) return showToast('Last working date is required', 'error');
    if (action === 'confirm_probation' && probationTabLocked) return showToast(`Probation active until ${probationEndDate.toLocaleDateString()}`, 'error');
    if (action === 'confirm_probation' && !['onboarding','probation'].includes(profile.employmentStatus)) return showToast(`Employee is already ${fmt(profile.employmentStatus)}`, 'error');
    if (action === 'confirm_probation' && profile.employmentStatus === 'onboarding' && !form.probationEndDate) return showToast('Probation end date is required', 'error');

    const payload = { action, data: { ...form } };
    if (!form.lastWorkingDate) delete payload.data.lastWorkingDate;
    if (!form.suspensionUntil) delete payload.data.suspensionUntil;
    if (!form.probationEndDate) delete payload.data.probationEndDate;

    setSaving(true);
    try {
      await api.post('/api/core/lifecycle/transition', payload);
      showToast(action === 'confirm_probation'
        ? (profile.employmentStatus === 'onboarding' ? 'Employee moved to Probation' : 'Probation confirmed — employee is now Active')
        : 'Lifecycle transition applied successfully');
      await load();
      await loadHistory();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const updateClearance = async (field, value) => {
    setClearanceSaving(true);
    try {
      const res = await api.patch('/api/core/profiles/clearance', { profileId, field, value });
      showToast(value ? 'Marked complete' : 'Unchecked');
      if (res.isLocked) showToast('Profile locked — all clearance items complete', 'success');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setClearanceSaving(false); }
  };

  if (loading) return (
    <AppShell title="Loading...">
      <div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  if (!profile) return (
    <AppShell title="Not Found">
      <div className="alert alert-danger m-4">Profile not found.</div>
    </AppShell>
  );

  const empName    = identity?.legalName || profile.identityId?.legalName || profile.employeeNumber || 'Unknown';
  const initials   = empName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const statusCfg  = STATUS_CONFIG[profile.employmentStatus] || { color: '#64748b', bg: '#f1f5f9' };
  const empRole    = empUser?.role;
  const roleColor  = ROLE_COLORS?.[empRole] || '#64748b';
  const roleLabel  = ROLE_LABELS?.[empRole] || empRole;

  return (
    <AppShell title="Employee Lifecycle">
      {toast && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      <button className="btn btn-sm btn-outline-secondary mb-3" onClick={() => router.push('/core-hr')} style={{ fontSize: 13 }}>
        <i className="bi bi-arrow-left me-2" />Back to Directory
      </button>

      {/* Hero Banner */}
      <div className="card mb-4" style={{ borderRadius: 16, overflow: 'hidden', border: 'none' }}>
        <div style={{ height: 110, background: `linear-gradient(135deg, ${statusCfg.color} 0%, #1e293b 100%)` }} />
        <div style={{ padding: '0 28px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: -48 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <div style={{ width: 96, height: 96, borderRadius: 20, background: '#fff', padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', flexShrink: 0 }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 16, background: `linear-gradient(135deg, ${statusCfg.color}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: '#fff' }}>
                  {initials}
                </div>
              </div>
              <div style={{ paddingBottom: 4 }}>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: 22, color: '#0f172a' }}>{empName}</h3>
                <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>{profile.designation || 'No Designation'}</span>
                  {profile.department && <> &bull; {profile.department}</>}
                </div>
                {profile.employeeNumber && (
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    <i className="bi bi-tag me-1" />{profile.employeeNumber}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4, flexWrap: 'wrap' }}>
              <StatusBadge status={profile.employmentStatus} />
              {roleLabel && (
                <span style={{ fontSize: 12, fontWeight: 700, background: roleColor + '20', color: roleColor, padding: '4px 12px', borderRadius: 20 }}>
                  {roleLabel}
                </span>
              )}
              {profile.isLocked && (
                <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '4px 12px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #fecaca' }}>
                  <i className="bi bi-lock-fill" />Locked
                </span>
              )}
            </div>
          </div>

          {/* Quick info strip */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
            {[
              { icon: 'bi-envelope',     val: identity?.primaryEmail || empUser?.email },
              { icon: 'bi-telephone',    val: identity?.personalPhone || empUser?.phone },
              { icon: 'bi-calendar2',    val: profile.hireDate ? `Hired ${formatDate(profile.hireDate)}` : null },
              { icon: 'bi-clock',        val: profile.shift },
              { icon: 'bi-briefcase',    val: profile.employmentType ? fmt(profile.employmentType) : null },
              { icon: 'bi-geo-alt',      val: profile.workLocation },
              { icon: 'bi-building',     val: profile.businessUnit },
            ].filter(i => i.val).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
                <i className={`bi ${item.icon}`} style={{ color: '#3b82f6', fontSize: 14 }} />
                <span style={{ fontWeight: 500 }}>{item.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions + History */}
      <div className="row g-4" style={{ alignItems: 'start' }}>

        {/* Left — Lifecycle Action Tabs */}
        <div className="col-lg-7">
          <div className="card" style={{ borderRadius: 14, overflow: 'hidden' }}>

            {/* Tab pills */}
            <div style={{ display: 'flex', gap: 4, padding: '14px 16px 0', background: '#f8fafc', overflowX: 'auto' }}>
              {ACTIONS.map(item => {
                const isLocked = item.key === 'confirm_probation' && probationTabLocked;
                return (
                  <button key={item.key} type="button"
                    onClick={() => { if (!isLocked) switchAction(item.key); }}
                    title={isLocked ? `Probation active until ${probationEndDate?.toLocaleDateString()}` : undefined}
                    style={{
                      flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none',
                      borderBottom: action === item.key ? `3px solid ${item.color}` : '3px solid transparent',
                      fontWeight: action === item.key ? 700 : 500, fontSize: 13,
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      background: action === item.key ? '#fff' : 'transparent',
                      color: isLocked ? '#cbd5e1' : action === item.key ? item.color : '#64748b',
                      boxShadow: action === item.key ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
                      transition: 'all 0.15s',
                    }}>
                    <i className={`bi ${isLocked ? 'bi-lock' : item.icon}`} style={{ fontSize: 14 }} />
                    {item.label}
                    {isLocked && <span style={{ fontSize: 10, background: '#fef3c7', color: '#d97706', padding: '1px 6px', borderRadius: 10 }}>Active</span>}
                  </button>
                );
              })}
            </div>

            {/* Form */}
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, padding: '10px 14px', background: actionMeta.color + '0d', borderRadius: 10, border: `1px solid ${actionMeta.color}20` }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: actionMeta.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i className={`bi ${actionMeta.icon}`} style={{ color: actionMeta.color, fontSize: 14 }} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{actionMeta.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{actionMeta.help}</div>
                </div>
              </div>

              <div className="row g-3">
                <Field label="Effective Date *">
                  <input className="form-control" type="date" style={{ fontSize: 13 }} value={form.effectiveDate} onChange={e => setForm(p => ({ ...p, effectiveDate: e.target.value }))} />
                </Field>
                <Field label={action === 'confirm_probation' ? 'Reason (optional)' : 'Reason *'}>
                  <input className="form-control" style={{ fontSize: 13 }} placeholder="Policy or business reason" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
                </Field>

                {action === 'confirm_probation' && (
                  <>
                    <div className="col-12">
                      {probationTabLocked && (
                        <div style={{ padding: '12px 14px', borderRadius: 9, background: '#fffbeb', border: '1px solid #fde68a', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="bi bi-lock" style={{ color: '#d97706', fontSize: 16, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 700, color: '#92400e' }}>Probation period is active</div>
                            <div style={{ color: '#78350f', fontSize: 12, marginTop: 2 }}>Until <strong>{probationEndDate?.toLocaleDateString()}</strong>. Confirmation possible only on or after that date.</div>
                          </div>
                        </div>
                      )}
                      {!probationTabLocked && profile.employmentStatus === 'onboarding' && (
                        <div style={{ padding: '10px 14px', borderRadius: 9, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="bi bi-arrow-right-circle" style={{ color: '#2563eb', fontSize: 15 }} />
                          <span><strong>Will move to Probation</strong> — set start and end dates.</span>
                        </div>
                      )}
                      {!probationTabLocked && profile.employmentStatus === 'probation' && probationEnded && (
                        <div style={{ padding: '10px 14px', borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <i className="bi bi-check-circle" style={{ color: '#16a34a', fontSize: 15 }} />
                          <span><strong>Probation period has ended.</strong> You can now confirm as Active.</span>
                        </div>
                      )}
                    </div>
                    {profile.employmentStatus === 'onboarding' && (
                      <Field label="Probation End Date *">
                        <input className="form-control" type="date" style={{ fontSize: 13 }} min={form.effectiveDate || undefined} value={form.probationEndDate} onChange={e => setForm(p => ({ ...p, probationEndDate: e.target.value }))} />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Earliest date HR can confirm this employee as Active.</div>
                      </Field>
                    )}
                    <Field label="Confirmation Note *" col="col-12">
                      <input className="form-control" style={{ fontSize: 13 }} value={form.confirmationNote}
                        onChange={e => setForm(p => ({ ...p, confirmationNote: e.target.value }))}
                        placeholder={profile.employmentStatus === 'onboarding' ? 'e.g. Employee onboarded and ready for probation' : 'e.g. Probation confirmed — performance satisfactory'}
                        disabled={probationTabLocked} />
                    </Field>
                  </>
                )}

                {action === 'transfer' && (
                  <>
                    <Field label="Department *">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value, designation: '' }))}>
                        <option value="">Select department</option>
                        {departments.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </Field>
                    <Field label="Designation *">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} disabled={!form.department}>
                        <option value="">{form.department ? 'Select designation' : 'Select dept first'}</option>
                        {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Shift" col="col-12">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.shift} onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}>
                        <option value="">Select shift</option>
                        {shifts.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                {action === 'promotion' && (
                  <Field label="New Designation *" col="col-12">
                    <select className="form-select" style={{ fontSize: 13 }} value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))}>
                      <option value="">Select designation</option>
                      {designations.map(d => <option key={d._id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}
                    </select>
                  </Field>
                )}

                {action === 'rehire' && (
                  <>
                    <Field label="Department *">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.department} onChange={e => setForm(p => ({ ...p, department: e.target.value, designation: '' }))}>
                        <option value="">Select department</option>
                        {departments.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </Field>
                    <Field label="Designation *">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.designation} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} disabled={!form.department}>
                        <option value="">{form.department ? 'Select designation' : 'Select dept first'}</option>
                        {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Employment Type *">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.employmentType} onChange={e => setForm(p => ({ ...p, employmentType: e.target.value }))}>
                        {['full_time','part_time','contract','intern','consultant','apprentice'].map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </Field>
                    <Field label="Shift" col="col-12">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.shift} onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}>
                        <option value="">Select shift</option>
                        {shifts.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                {action === 'suspend' && (
                  <Field label="Suspension Until">
                    <input className="form-control" type="date" style={{ fontSize: 13 }} value={form.suspensionUntil} onChange={e => setForm(p => ({ ...p, suspensionUntil: e.target.value }))} />
                  </Field>
                )}

                {action === 'separation' && (
                  <>
                    <Field label="Separation Type *">
                      <select className="form-select" style={{ fontSize: 13 }} value={form.separationType} onChange={e => setForm(p => ({ ...p, separationType: e.target.value }))}>
                        {['resignation','termination','retirement','contract_end','medical_exit','death','other'].map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                      </select>
                    </Field>
                    <Field label="Last Working Date *">
                      <input className="form-control" type="date" style={{ fontSize: 13 }} value={form.lastWorkingDate} onChange={e => setForm(p => ({ ...p, lastWorkingDate: e.target.value }))} />
                    </Field>
                    <Field label="Notice Period (days)" col="col-12">
                      <input className="form-control" type="number" min="0" max="365" style={{ fontSize: 13, maxWidth: 160 }} value={form.noticePeriodDays} onChange={e => setForm(p => ({ ...p, noticePeriodDays: Number(e.target.value) }))} />
                    </Field>
                    <div className="col-12">
                      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 7, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <i className="bi bi-clipboard-check" style={{ color: '#ef4444', fontSize: 13 }} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>Exit Clearance Checklist</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{profile.isLocked ? 'Profile locked — all clearance complete.' : 'Available after separation is applied.'}</div>
                            </div>
                          </div>
                          {profile.isLocked && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '3px 10px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <i className="bi bi-lock-fill" />Locked
                            </span>
                          )}
                        </div>
                        {isSeparated ? (
                          <>
                            <div className="row g-2">
                              {CLEARANCE_ITEMS.map(({ field, label, icon, desc }) => {
                                const checked = !!profile?.separation?.clearanceChecklist?.[field];
                                return (
                                  <div key={field} className="col-md-6">
                                    <div onClick={() => !profile.isLocked && !clearanceSaving && updateClearance(field, !checked)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, border: `1px solid ${checked ? '#bbf7d0' : '#e2e8f0'}`, background: checked ? '#f0fdf4' : '#f8fafc', cursor: profile.isLocked ? 'not-allowed' : 'pointer', transition: 'all 0.15s', opacity: profile.isLocked ? 0.65 : 1 }}>
                                      <div style={{ width: 30, height: 30, borderRadius: 7, background: checked ? '#dcfce7' : '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <i className={`bi ${checked ? 'bi-check-circle-fill' : icon}`} style={{ color: checked ? '#16a34a' : '#3b82f6', fontSize: 14 }} />
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 12, color: checked ? '#15803d' : '#1e293b' }}>{label}</div>
                                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{desc}</div>
                                      </div>
                                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${checked ? '#16a34a' : '#cbd5e1'}`, background: checked ? '#16a34a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {checked && <i className="bi bi-check" style={{ color: '#fff', fontSize: 10 }} />}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {clearanceSaving && (
                              <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="spinner-border spinner-border-sm" style={{ width: 14, height: 14 }} />Saving clearance...
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: '12px 14px', fontSize: 12, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <i className="bi bi-info-circle" />Apply separation first — the clearance checklist will activate here.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid #f8fafc' }}>
                <button className="btn btn-primary" onClick={submit}
                  disabled={saving || profile.isLocked || (action === 'confirm_probation' && probationTabLocked)}
                  style={{ fontSize: 13 }}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Applying...</> : <><i className={`bi ${actionMeta.icon} me-2`} />Apply {actionMeta.label}</>}
                </button>
                <button className="btn btn-outline-secondary" style={{ fontSize: 13 }} onClick={() => setForm({ ...EMPTY_FORM, profileId })}>Reset</button>
              </div>
            </div>
          </div>
        </div>

        {/* Right — Lifecycle History */}
        <div className="col-lg-5">
          <div className="card" style={{ borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="bi bi-clock-history" style={{ color: '#64748b', fontSize: 15 }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Lifecycle History</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{history.length} event{history.length !== 1 ? 's' : ''} recorded</div>
              </div>
            </div>
            <div style={{ padding: '16px 20px', maxHeight: 620, overflowY: 'auto' }}>
              {history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>
                  <i className="bi bi-clock-history" style={{ fontSize: 32, display: 'block', marginBottom: 10 }} />
                  <div style={{ fontSize: 13 }}>No history entries yet</div>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 15, top: 8, bottom: 8, width: 2, background: '#f1f5f9' }} />
                  {history.map((item, idx) => {
                    const actionInfo = ACTIONS.find(a => a.key === item.action);
                    const dotColor = actionInfo?.color || '#3b82f6';
                    return (
                      <div key={item._id} style={{ display: 'flex', gap: 14, paddingBottom: idx < history.length - 1 ? 20 : 0, position: 'relative' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fff', border: `2px solid ${dotColor}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1, boxShadow: `0 0 0 3px ${dotColor}10` }}>
                          <i className={`bi ${actionInfo?.icon || 'bi-arrow-repeat'}`} style={{ color: dotColor, fontSize: 13 }} />
                        </div>
                        <div style={{ flex: 1, paddingTop: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: '#1e293b', textTransform: 'capitalize' }}>{fmt(item.action)}</span>
                            <span style={{ fontSize: 11, background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: 20 }}>{item.eventType}</span>
                          </div>
                          {(item.fromState || item.toState) && (
                            <div style={{ fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'capitalize' }}>{item.fromState || '—'}</span>
                              <i className="bi bi-arrow-right" style={{ fontSize: 10, color: '#94a3b8' }} />
                              <span style={{ background: dotColor + '15', border: `1px solid ${dotColor}30`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, color: dotColor, textTransform: 'capitalize' }}>{item.toState || '—'}</span>
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{formatDate(item.createdAt)}</div>
                          {item.reason && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontStyle: 'italic' }}>"{item.reason}"</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
