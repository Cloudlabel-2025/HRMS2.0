'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';

const ACTIONS = [
  { key: 'confirm_probation', label: 'Confirm / Probation', icon: 'bi-shield-check', help: 'Move onboarding → probation, or confirm probation → active.' },
  { key: 'transfer', label: 'Transfer', icon: 'bi-arrow-left-right', help: 'Update department, location, shift, and reporting details.' },
  { key: 'promotion', label: 'Promote', icon: 'bi-graph-up-arrow', help: 'Record designation, grade, band, and compensation group movement.' },
  { key: 'rehire', label: 'Rehire', icon: 'bi-person-plus', help: 'Restore an employee with fresh assignment details.' },
  { key: 'suspend', label: 'Suspend', icon: 'bi-pause-circle', help: 'Place an employee on suspension until a specified date.' },
  { key: 'separation', label: 'Separate', icon: 'bi-box-arrow-right', help: 'Capture exit details, notice period, and settlement status.' },
];

const EMPTY_FORM = {
  profileId: '',
  effectiveDate: '',
  reason: '',
  confirmationNote: '',
  department: '',
  designation: '',
  businessUnit: '',
  workLocation: '',
  shift: '',
  managerIdentityId: '',
  teamLeadIdentityId: '',
  teamAdminIdentityId: '',
  grade: '',
  payGroup: '',
  band: '',
  employmentType: 'full_time',
  separationType: 'resignation',
  noticePeriodDays: 0,
  lastWorkingDate: '',
  settlementStatus: 'pending',
  exitInterviewComplete: false,
  suspensionUntil: '',
};

const EMPTY_CREATE_FORM = {
  identityId: '',
  employmentType: 'full_time',
  employmentStatus: 'onboarding',
  department: '',
  designation: '',
  businessUnit: '',
  workLocation: '',
  shift: 'Morning (9AM-6PM)',
  hireDate: '',
  sourceSystem: 'manual',
  notes: '',
};

const formatStatus = value => String(value || 'unknown').replace(/_/g, ' ');
const getRecordId = value => String(value?._id || value || '');

function StatTile({ label, value, icon, tone }) {
  return (
    <div className="core-hr-stat-tile">
      <div>
        <div className="core-hr-stat-label">{label}</div>
        <div className="core-hr-stat-value">{value}</div>
      </div>
      <div className={`core-hr-stat-icon ${tone}`}>
        <i className={`bi ${icon}`} />
      </div>
    </div>
  );
}

function Field({ label, children, wide = false }) {
  return (
    <div className={wide ? 'col-12' : 'col-md-6'}>
      <label className="form-label core-hr-field-label">{label}</label>
      {children}
    </div>
  );
}

export default function CoreHrPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [identities, setIdentities] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [history, setHistory] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [search, setSearch] = useState('');
  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [action, setAction] = useState('confirm_probation');
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const filteredProfiles = useMemo(() => {
    const term = search.trim().toLowerCase();
    const directoryItems = [
      ...profiles.map(profile => ({
        key: `core:${profile._id}`,
        kind: 'core',
        id: profile._id,
        name: profile.identityId?.legalName || profile.employeeNumber || 'Unknown',
        employeeNumber: profile.employeeNumber || '',
        department: profile.department || '',
        designation: profile.designation || '',
        status: profile.employmentStatus || 'unknown',
        record: profile,
      })),
      ...employees.map(employee => ({
        key: `legacy:${employee._id}`,
        kind: 'legacy',
        id: employee._id,
        name: employee.name || 'Unknown',
        employeeNumber: employee.email || '',
        department: employee.department || '',
        designation: employee.designation || '',
        status: employee.status || 'unknown',
        record: employee,
      })),
    ];
    if (!term) return directoryItems;
    return directoryItems.filter(p =>
      [p.name, p.employeeNumber, p.department, p.designation, p.status]
        .some(v => String(v || '').toLowerCase().includes(term))
    );
  }, [profiles, employees, search]);

  const selectedProfile = useMemo(() => profiles.find(p => `core:${p._id}` === selectedKey), [profiles, selectedKey]);
  const selectedEmployee = useMemo(() => employees.find(e => `legacy:${e._id}` === selectedKey), [employees, selectedKey]);

  const selectedDirectoryItem = selectedProfile
    ? {
        key: `core:${selectedProfile._id}`,
        kind: 'core',
        name: selectedProfile.identityId?.legalName || selectedProfile.employeeNumber || 'Unknown',
        department: selectedProfile.department || '',
        designation: selectedProfile.designation || '',
        status: selectedProfile.employmentStatus || 'unknown',
        employeeNumber: selectedProfile.employeeNumber || '',
      }
    : selectedEmployee
      ? {
          key: `legacy:${selectedEmployee._id}`,
          kind: 'legacy',
          name: selectedEmployee.name || 'Unknown',
          department: selectedEmployee.department || '',
          designation: selectedEmployee.designation || '',
          status: selectedEmployee.status || 'unknown',
          employeeNumber: selectedEmployee.email || '',
        }
      : null;

  const actionMeta = ACTIONS.find(item => item.key === action) || ACTIONS[0];
  const canCreateCoreProfile = ['super_admin', 'admin_full'].includes(user?.role);

  const profileIdentityIds = useMemo(() => new Set(profiles.map(p => getRecordId(p.identityId))), [profiles]);
  const availableIdentities = useMemo(
    () => identities.filter(i => !profileIdentityIds.has(getRecordId(i))),
    [identities, profileIdentityIds]
  );
  const selectedCreateIdentity = useMemo(
    () => identities.find(i => getRecordId(i) === createForm.identityId),
    [identities, createForm.identityId]
  );

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [identityRes, profileRes, employeeRes, deptRes, desigRes, shiftRes] = await Promise.all([
        canCreateCoreProfile ? api.get('/api/core/identities?limit=100') : Promise.resolve({ items: [] }),
        api.get('/api/core/profiles?limit=100'),
        api.get('/api/employees'),
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=designations'),
        api.get('/api/settings?type=shifts'),
      ]);
      setIdentities(Array.isArray(identityRes.items) ? identityRes.items : []);
      setProfiles(Array.isArray(profileRes.items) ? profileRes.items : []);
      setEmployees(Array.isArray(employeeRes) ? employeeRes : []);
      setDepartments(Array.isArray(deptRes) ? deptRes.map(d => d.name) : []);
      setDesignations(Array.isArray(desigRes) ? desigRes : []);
      setShifts(Array.isArray(shiftRes) ? shiftRes.map(s => s.name) : []);
      if (!selectedKey) {
        const first = profileRes.items?.[0];
        const firstEmp = employeeRes?.[0];
        setSelectedKey(first ? `core:${first._id}` : firstEmp ? `legacy:${firstEmp._id}` : '');
      }
    } catch (e) {
      setError(e.message);
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
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
      setForm({
        ...EMPTY_FORM,
        profileId: selectedProfile._id,
        department: selectedProfile.department || '',
        designation: selectedProfile.designation || '',
        businessUnit: selectedProfile.businessUnit || '',
        workLocation: selectedProfile.workLocation || '',
        shift: selectedProfile.shift || '',
      });
    }
  }, [selectedProfile]);

  useEffect(() => {
    if (!filteredProfiles.length) return;
    if (!selectedKey || !filteredProfiles.some(p => p.key === selectedKey)) {
      setSelectedKey(filteredProfiles[0].key);
    }
  }, [filteredProfiles, selectedKey]);

  useEffect(() => {
    if (!createForm.identityId && availableIdentities.length) {
      setCreateForm(prev => ({ ...prev, identityId: getRecordId(availableIdentities[0]) }));
    }
  }, [availableIdentities, createForm.identityId]);

  const createProfile = async () => {
    if (creating) return;
    const identityId = createForm.identityId;
    if (!identityId) return showToast('Select an identity first', 'error');
    if (!createForm.department.trim()) return showToast('Department is required', 'error');
    if (!createForm.designation.trim()) return showToast('Designation is required', 'error');
    if (profiles.some(p => getRecordId(p.identityId) === identityId)) {
      return showToast('This identity already has a core profile', 'error');
    }
    const payload = {
      identityId,
      employmentType: createForm.employmentType,
      employmentStatus: createForm.employmentStatus,
      department: createForm.department.trim(),
      designation: createForm.designation.trim(),
      businessUnit: createForm.businessUnit.trim(),
      workLocation: createForm.workLocation.trim(),
      shift: createForm.shift.trim(),
      sourceSystem: createForm.sourceSystem,
      notes: createForm.notes.trim(),
    };
    if (createForm.hireDate) payload.hireDate = createForm.hireDate;
    setCreating(true);
    try {
      const response = await api.post('/api/core/profiles', payload);
      showToast('Core profile created');
      setCreateForm(EMPTY_CREATE_FORM);
      await load();
      if (response?.profile?._id) setSelectedKey(`core:${response.profile._id}`);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  // Per-action default fields — reset when switching action tab
  const ACTION_DEFAULTS = {
    confirm_probation: { confirmationNote: '' },
    transfer:    { department: selectedProfile?.department || '', designation: selectedProfile?.designation || '', businessUnit: selectedProfile?.businessUnit || '', workLocation: selectedProfile?.workLocation || '', shift: selectedProfile?.shift || '' },
    promotion:   { designation: selectedProfile?.designation || '', businessUnit: selectedProfile?.businessUnit || '', grade: '', payGroup: '', band: '' },
    rehire:      { department: '', designation: '', employmentType: 'full_time', workLocation: '', shift: '' },
    suspend:     { suspensionUntil: '' },
    separation:  { separationType: 'resignation', lastWorkingDate: '', noticePeriodDays: 0, settlementStatus: 'pending', exitInterviewComplete: false },
  };

  const switchAction = (key) => {
    setAction(key);
    setForm(prev => ({
      ...EMPTY_FORM,
      profileId: prev.profileId,
      effectiveDate: '',
      reason: '',
      ...ACTION_DEFAULTS[key],
    }));
  };

  const submit = async () => {
    if (!selectedProfile) return showToast('Select an employee with a core profile to apply transitions', 'error');
    if (!form.profileId) return showToast('Select an employment profile', 'error');
    if (action !== 'confirm_probation' && !form.reason) return showToast('Reason is required', 'error');

    const payload = { action, data: { ...form } };
    if (!form.effectiveDate) delete payload.data.effectiveDate;
    if (!form.lastWorkingDate) delete payload.data.lastWorkingDate;
    if (!form.suspensionUntil) delete payload.data.suspensionUntil;

    setSaving(true);
    try {
      await api.post('/api/core/lifecycle/transition', payload);
      showToast('Lifecycle transition saved');
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Core HR Lifecycle">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}>{toast.msg}</div></div>}

      <div className="core-hr-header">
        <div>
          <div className="core-hr-kicker"><i className="bi bi-diagram-3" /> Core HR</div>
          <h4>Employment Lifecycle</h4>
          <p>Review employee status, apply lifecycle transitions, and audit recent changes from one workspace.</p>
        </div>
        <div className="core-hr-header-actions">
          <button className="btn btn-outline-primary" onClick={load} disabled={loading}>
            <i className={`bi ${loading ? 'bi-arrow-repeat core-hr-spin' : 'bi-arrow-repeat'}`} />Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger d-flex align-items-center justify-content-between flex-wrap gap-2" role="alert">
          <div>{error}</div>
          <button className="btn btn-sm btn-outline-danger" onClick={load}>Retry</button>
        </div>
      )}

      <div className="core-hr-stats">
        <StatTile label="Core Profiles" value={profiles.length} icon="bi-person-vcard" tone="blue" />
        <StatTile label="Legacy Records" value={employees.length} icon="bi-archive" tone="slate" />
        <StatTile label="Visible Results" value={filteredProfiles.length} icon="bi-funnel" tone="green" />
        <StatTile label="Recent Events" value={history.length} icon="bi-clock-history" tone="amber" />
      </div>

      {canCreateCoreProfile && availableIdentities.length > 0 && (
        <div className="card core-hr-panel core-hr-create-card">
          <div className="core-hr-panel-head">
            <div>
              <div className="core-hr-panel-title">Create Core Profile</div>
              <div className="core-hr-panel-subtitle">Link an unlinked identity to a new employment profile.</div>
            </div>
            <span className="core-hr-action-chip"><i className="bi bi-person-badge" /> New profile</span>
          </div>

          <div className="row g-3 core-hr-create-identity-row">
            <div className="col-12 col-lg-8">
              <label className="form-label core-hr-field-label">Identity</label>
              <select
                className="form-select"
                value={createForm.identityId}
                onChange={e => setCreateForm(prev => ({ ...prev, identityId: e.target.value }))}
              >
                <option value="">Select an identity</option>
                {availableIdentities.map(identity => {
                  const id = getRecordId(identity);
                  const label = `${identity.legalName || identity.preferredName || identity.primaryEmail} ${identity.primaryEmail ? `(${identity.primaryEmail})` : ''}`;
                  return <option key={id} value={id}>{label}</option>;
                })}
              </select>
              <div className="form-text">{availableIdentities.length} unlinked identities available.</div>
            </div>
            <div className="col-12 col-lg-4">
              <label className="form-label core-hr-field-label">Identity Status</label>
              <div className="core-hr-inline-status">
                {selectedCreateIdentity
                  ? <><i className="bi bi-check-circle" /> {formatStatus(selectedCreateIdentity.recordStatus)} identity selected</>
                  : <><i className="bi bi-info-circle" /> Select an identity to continue</>}
              </div>
            </div>
          </div>

          <div className="row g-3">
            <div className="col-12 col-md-6">
              <label className="form-label core-hr-field-label">Employment Status</label>
              <select className="form-select" value={createForm.employmentStatus} onChange={e => setCreateForm(prev => ({ ...prev, employmentStatus: e.target.value }))}>
                <option value="onboarding">Onboarding</option>
                <option value="probation">Probation</option>
                <option value="active">Active</option>
              </select>
            </div>
            <Field label="Department">
              <select className="form-select" value={createForm.department} onChange={e => setCreateForm(prev => ({ ...prev, department: e.target.value, designation: '' }))}>
                <option value="">Select department</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Designation">
              <select className="form-select" value={createForm.designation} onChange={e => setCreateForm(prev => ({ ...prev, designation: e.target.value }))} disabled={!createForm.department}>
                <option value="">{createForm.department ? 'Select designation' : 'Select department first'}</option>
                {designations.filter(d => d.department === createForm.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Employment Type">
              <select className="form-select" value={createForm.employmentType} onChange={e => setCreateForm(prev => ({ ...prev, employmentType: e.target.value }))}>
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contract">Contract</option>
                <option value="intern">Intern</option>
                <option value="consultant">Consultant</option>
                <option value="apprentice">Apprentice</option>
              </select>
            </Field>
            <Field label="Business Unit">
              <input className="form-control" value={createForm.businessUnit} onChange={e => setCreateForm(prev => ({ ...prev, businessUnit: e.target.value }))} placeholder="Corporate, Shared Services..." />
            </Field>
            <Field label="Work Location">
              <input className="form-control" value={createForm.workLocation} onChange={e => setCreateForm(prev => ({ ...prev, workLocation: e.target.value }))} placeholder="Mumbai, Remote, Bangalore..." />
            </Field>
            <Field label="Shift">
              <select className="form-select" value={createForm.shift} onChange={e => setCreateForm(prev => ({ ...prev, shift: e.target.value }))}>
                <option value="">Select shift</option>
                {shifts.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Hire Date">
              <input className="form-control" type="date" value={createForm.hireDate} onChange={e => setCreateForm(prev => ({ ...prev, hireDate: e.target.value }))} />
            </Field>
            <div className="col-12">
              <label className="form-label core-hr-field-label">Notes</label>
              <textarea className="form-control" rows="2" value={createForm.notes} onChange={e => setCreateForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>

          <div className="core-hr-form-actions">
            <button className="btn btn-primary" onClick={createProfile} disabled={creating || !createForm.identityId}>
              {creating ? 'Creating...' : 'Create Core Profile'}
            </button>
            <button className="btn btn-outline-secondary" onClick={() => setCreateForm(EMPTY_CREATE_FORM)} disabled={creating}>Reset</button>
          </div>
        </div>
      )}

      <div className="core-hr-workspace">
        <aside className="core-hr-directory">
          <div className="card core-hr-panel core-hr-directory-panel">
            <div className="core-hr-panel-head">
              <div>
                <div className="core-hr-panel-title">Employee Directory</div>
                <div className="core-hr-panel-subtitle">Select a core profile to enable lifecycle actions.</div>
              </div>
              <span className="badge bg-light text-dark">{filteredProfiles.length}</span>
            </div>

            <div className="core-hr-search">
              <i className="bi bi-search" />
              <input
                className="form-control"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search employee, department, status"
              />
            </div>

            <div className="list-group core-hr-profile-list">
              {filteredProfiles.map(profile => (
                <button
                  key={profile.key}
                  type="button"
                  className={`list-group-item list-group-item-action core-hr-profile-item ${selectedKey === profile.key ? 'active' : ''}`}
                  onClick={() => setSelectedKey(profile.key)}
                >
                  <div className="core-hr-profile-row">
                    <div className="core-hr-profile-avatar">{profile.name.slice(0, 2).toUpperCase()}</div>
                    <div className="core-hr-profile-copy">
                      <div className="core-hr-profile-name">{profile.name}</div>
                      <div className="core-hr-profile-meta">{profile.employeeNumber || 'No employee number'}</div>
                      <div className="core-hr-profile-meta">{profile.department || 'Unassigned'} / {profile.designation || 'No designation'}</div>
                    </div>
                    <div className="core-hr-profile-status">
                      <span className={`badge ${profile.kind === 'core' ? 'status-approved' : 'bg-warning-subtle text-warning-emphasis'}`}>
                        {profile.kind === 'core' ? formatStatus(profile.status) : 'Legacy'}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
              {loading && <div className="text-center py-4 text-secondary">Loading profiles...</div>}
              {!loading && filteredProfiles.length === 0 && (
                <div className="empty-state py-5">
                  <i className="bi bi-people" />
                  <h6>No employees found</h6>
                  <div className="small">Try clearing the search.</div>
                </div>
              )}
            </div>
          </div>

          {selectedDirectoryItem && (
            <div className="card core-hr-panel core-hr-snapshot">
              <div className="core-hr-snapshot-top">
                <div className="core-hr-snapshot-avatar">{selectedDirectoryItem.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="core-hr-panel-title">{selectedDirectoryItem.name}</div>
                  <div className="core-hr-panel-subtitle">{selectedDirectoryItem.employeeNumber || 'No employee number'}</div>
                </div>
              </div>
              <div className="core-hr-snapshot-grid">
                <div><span>Status</span><strong>{formatStatus(selectedDirectoryItem.status)}</strong></div>
                <div><span>Department</span><strong>{selectedDirectoryItem.department || '-'}</strong></div>
                <div><span>Designation</span><strong>{selectedDirectoryItem.designation || '-'}</strong></div>
                <div><span>Hire Date</span><strong>{selectedProfile ? formatDate(selectedProfile.hireDate) : '-'}</strong></div>
              </div>
              {!selectedProfile && (
                <div className="core-hr-note">
                  <i className="bi bi-info-circle" />
                  Legacy records are read-only here.
                </div>
              )}
            </div>
          )}
        </aside>

        <section className="core-hr-main">
          <div className="card core-hr-panel core-hr-action-card">
            <div className="core-hr-panel-head">
              <div>
                <div className="core-hr-panel-title">Lifecycle Action</div>
                <div className="core-hr-panel-subtitle">{selectedProfile ? actionMeta.help : 'Lifecycle actions require a core HR profile.'}</div>
              </div>
              <span className="core-hr-action-chip"><i className={`bi ${actionMeta.icon}`} /> {actionMeta.label}</span>
            </div>

            <div className="core-hr-action-tabs" role="group" aria-label="Lifecycle actions">
              {ACTIONS.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={action === item.key ? 'active' : ''}
                  disabled={!selectedProfile}
                  onClick={() => switchAction(item.key)}
                >
                  <i className={`bi ${item.icon}`} />
                  {item.label}
                </button>
              ))}
            </div>

            <div className="row g-3">
              <Field label="Effective Date">
                <input className="form-control" type="date" value={form.effectiveDate} onChange={e => setForm(prev => ({ ...prev, effectiveDate: e.target.value }))} />
              </Field>
              <Field label="Reason">
                <input className="form-control" value={form.reason} onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))} placeholder="Policy or business reason" />
              </Field>
              {action === 'confirm_probation' && (
                <Field label="Confirmation Note" wide>
                  <input className="form-control" value={form.confirmationNote} onChange={e => setForm(prev => ({ ...prev, confirmationNote: e.target.value }))} placeholder="Probation confirmed" />
                </Field>
              )}
              {action === 'transfer' && (
                <>
                  <Field label="Department">
                    <select className="form-select" value={form.department} onChange={e => setForm(prev => ({ ...prev, department: e.target.value, designation: '' }))}>
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="Designation">
                    <select className="form-select" value={form.designation} onChange={e => setForm(prev => ({ ...prev, designation: e.target.value }))} disabled={!form.department}>
                      <option value="">{form.department ? 'Select designation' : 'Select department first'}</option>
                      {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Business Unit"><input className="form-control" value={form.businessUnit} onChange={e => setForm(prev => ({ ...prev, businessUnit: e.target.value }))} /></Field>
                  <Field label="Work Location"><input className="form-control" value={form.workLocation} onChange={e => setForm(prev => ({ ...prev, workLocation: e.target.value }))} /></Field>
                  <Field label="Shift">
                    <select className="form-select" value={form.shift} onChange={e => setForm(prev => ({ ...prev, shift: e.target.value }))}>
                      <option value="">Select shift</option>
                      {shifts.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                </>
              )}
              {action === 'promotion' && (
                <>
                  <Field label="Designation">
                    <select className="form-select" value={form.designation} onChange={e => setForm(prev => ({ ...prev, designation: e.target.value }))}>
                      <option value="">Select designation</option>
                      {designations.map(d => <option key={d._id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}
                    </select>
                  </Field>
                  <Field label="Business Unit"><input className="form-control" value={form.businessUnit} onChange={e => setForm(prev => ({ ...prev, businessUnit: e.target.value }))} /></Field>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Grade</label><input className="form-control" value={form.grade} onChange={e => setForm(prev => ({ ...prev, grade: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Pay Group</label><input className="form-control" value={form.payGroup} onChange={e => setForm(prev => ({ ...prev, payGroup: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Band</label><input className="form-control" value={form.band} onChange={e => setForm(prev => ({ ...prev, band: e.target.value }))} /></div>
                </>
              )}
              {action === 'rehire' && (
                <>
                  <Field label="Department">
                    <select className="form-select" value={form.department} onChange={e => setForm(prev => ({ ...prev, department: e.target.value, designation: '' }))}>
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="Designation">
                    <select className="form-select" value={form.designation} onChange={e => setForm(prev => ({ ...prev, designation: e.target.value }))} disabled={!form.department}>
                      <option value="">{form.department ? 'Select designation' : 'Select department first'}</option>
                      {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </select>
                  </Field>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Employment Type</label><select className="form-select" value={form.employmentType} onChange={e => setForm(prev => ({ ...prev, employmentType: e.target.value }))}><option value="full_time">Full Time</option><option value="part_time">Part Time</option><option value="contract">Contract</option><option value="intern">Intern</option><option value="consultant">Consultant</option><option value="apprentice">Apprentice</option></select></div>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Work Location</label><input className="form-control" value={form.workLocation} onChange={e => setForm(prev => ({ ...prev, workLocation: e.target.value }))} /></div>
                  <div className="col-md-4">
                    <label className="form-label core-hr-field-label">Shift</label>
                    <select className="form-select" value={form.shift} onChange={e => setForm(prev => ({ ...prev, shift: e.target.value }))}>
                      <option value="">Select shift</option>
                      {shifts.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </>
              )}
              {action === 'suspend' && (
                <Field label="Suspension Until">
                  <input className="form-control" type="date" value={form.suspensionUntil} onChange={e => setForm(prev => ({ ...prev, suspensionUntil: e.target.value }))} />
                </Field>
              )}
              {action === 'separation' && (
                <>
                  <div className="col-md-6">
                    <label className="form-label core-hr-field-label">Separation Type</label>
                    <select className="form-select" value={form.separationType} onChange={e => setForm(prev => ({ ...prev, separationType: e.target.value }))}>
                      <option value="resignation">Resignation</option>
                      <option value="termination">Termination</option>
                      <option value="retirement">Retirement</option>
                      <option value="contract_end">Contract End</option>
                      <option value="medical_exit">Medical Exit</option>
                      <option value="death">Death</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="col-md-6"><label className="form-label core-hr-field-label">Last Working Date</label><input className="form-control" type="date" value={form.lastWorkingDate} onChange={e => setForm(prev => ({ ...prev, lastWorkingDate: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Notice Period Days</label><input className="form-control" type="number" min="0" max="365" value={form.noticePeriodDays} onChange={e => setForm(prev => ({ ...prev, noticePeriodDays: Number(e.target.value) }))} /></div>
                  <div className="col-md-4"><label className="form-label core-hr-field-label">Settlement Status</label><select className="form-select" value={form.settlementStatus} onChange={e => setForm(prev => ({ ...prev, settlementStatus: e.target.value }))}><option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="settled">Settled</option></select></div>
                  <div className="col-md-4 d-flex align-items-end"><div className="form-check core-hr-check"><input className="form-check-input" type="checkbox" checked={form.exitInterviewComplete} onChange={e => setForm(prev => ({ ...prev, exitInterviewComplete: e.target.checked }))} /><label className="form-check-label">Exit interview complete</label></div></div>
                </>
              )}
            </div>

            <div className="core-hr-form-actions">
              <button className="btn btn-primary" onClick={submit} disabled={saving || !selectedProfile}>{saving ? 'Saving...' : 'Apply Transition'}</button>
              <button className="btn btn-outline-secondary" onClick={() => setForm(EMPTY_FORM)}>Reset</button>
            </div>
          </div>

          <div className="card core-hr-panel core-hr-history-card">
            <div className="core-hr-panel-head">
              <div>
                <div className="core-hr-panel-title">Recent Lifecycle History</div>
                <div className="core-hr-panel-subtitle">Latest events for the selected core profile.</div>
              </div>
              <span className="badge bg-light text-dark">{history.length}</span>
            </div>
            <div className="core-hr-history-list">
              {history.map(item => (
                <div key={item._id} className="core-hr-history-item">
                  <div className="core-hr-history-icon"><i className="bi bi-arrow-repeat" /></div>
                  <div>
                    <div className="core-hr-history-title">
                      <span>{formatStatus(item.action)}</span>
                      <span className="badge bg-light text-dark">{item.eventType}</span>
                    </div>
                    <div className="core-hr-history-meta">{item.fromState || '-'} &rarr; {item.toState || '-'}</div>
                    <div className="core-hr-history-meta">{formatDate(item.createdAt)}</div>
                    {item.reason && <div className="core-hr-history-reason">{item.reason}</div>}
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="empty-state core-hr-empty-history">
                  <i className="bi bi-clock-history" />
                  <h6>No history entries yet</h6>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
