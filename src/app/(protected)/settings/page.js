'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';
import ConfirmModal from '@/components/ConfirmModal';
import { isSaturdayOff, getSaturdayPattern } from '@/lib/saturday-cycle';
import ShiftMaster from '@/components/dev-admin/ShiftMaster';
import ShiftFormModal, { DEFAULT_SHIFT_FORM, validateShiftForm } from '@/components/dev-admin/ShiftFormModal';

const NOTIFICATION_RULES = [
  ['Late Login Alert',       'Send alert when employee logs in after threshold', true],
  ['Absence Alert',          'Notify manager when employee is absent without leave', true],
  ['Leave Approval',         'Notify employee when leave is approved/rejected', true],
  ['Payslip Available',      'Notify employee when payslip is generated', true],
  ['Task Overdue',           'Alert when task passes due date', true],
  ['Document Expiry',        'Alert 30 days before document expiry', false],
  ['Performance Review Due', 'Remind employees to complete self-review', true],
];

const TABS = [
  { key: 'general',      label: 'General',      icon: 'bi-gear' },
  { key: 'departments',  label: 'Departments',  icon: 'bi-diagram-3' },
  { key: 'expertise',    label: 'Expertise',    icon: 'bi-person-gear' },
  { key: 'roles',        label: 'Roles',        icon: 'bi-person-badge' },
  { key: 'designations', label: 'Designations', icon: 'bi-briefcase' },
  { key: 'categories',   label: 'Asset Categories', icon: 'bi-tag' },
  { key: 'shifts',       label: 'Shifts',       icon: 'bi-clock' },
  { key: 'shiftChanges', label: 'Shift Changes', icon: 'bi-arrow-repeat' },
  { key: 'holidays',     label: 'Holidays',     icon: 'bi-calendar3' },
];

const toDateInputValue = (value) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;

  const day = Number(value);
  if (Number.isInteger(day) && day >= 1 && day <= 31) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  return '';
};

const getDefaultPayrollStartDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-26`;
};

const getDefaultPayrollEndDate = () => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonth = next.getMonth();
  const nextYear = next.getFullYear();
  const lastDay = new Date(nextYear, nextMonth + 1, 0).getDate();
  const day = Math.min(25, lastDay);
  return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { formatDate, formatTime, formatDateTime, updateSettings } = useSettings();
  const [tab, setTab]               = useState('general');
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles]           = useState([]);
  const [designations, setDesignations] = useState([]);
  const [categories, setCategories]   = useState([]);
  const [expertise, setExpertise]     = useState([]);
  const [shifts, setShifts]         = useState([]);
  const [holidays, setHolidays]     = useState([]);
  const [config, setConfig]         = useState({
    timezone: 'Asia/Kolkata', currency: 'INR', dateFormat: 'DD/MM/YYYY',
    language: 'English', timeFormat: '24h', payrollStartDay: getDefaultPayrollStartDate(), payrollEndDay: getDefaultPayrollEndDate(), attendanceStartDay: '1',
    saturdayWorking: 'alternate', lateThreshold: '15', permissionMonthlyAllowanceMins: '120',
    saturdayAlternatePattern: 'pattern1',
  });
  const [archiveYears, setArchiveYears] = useState(3);
  const [archivePreview, setArchivePreview] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [endingSessions, setEndingSessions] = useState(false);
  const [endSessionTarget, setEndSessionTarget] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showModal, setShowModal]   = useState(null);
  const [modalForm, setModalForm]   = useState({});
  const [shiftErrs, setShiftErrs]   = useState({});
  const [shiftNotifs, setShiftNotifs] = useState([]);
  const [shiftNotifsLoading, setShiftNotifsLoading] = useState(false);
  const [shiftSearch, setShiftSearch] = useState('');
  const [toast, setToast]           = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting]         = useState(false);
  const [deleteImpact, setDeleteImpact] = useState(null);
  const [confirmSat, setConfirmSat]     = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  // Retroactive leave re-evaluation after a Saturday is bookmarked working.
  const [reevalDate, setReevalDate] = useState(null);
  const [reevalPreview, setReevalPreview] = useState(null);
  const [reevalLoading, setReevalLoading] = useState(false);
  const [reevalConfirming, setReevalConfirming] = useState(false);
  const [notifications, setNotifications] = useState(
    Object.fromEntries(NOTIFICATION_RULES.map(([title, , def]) => [title, def]))
  );

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const generateSaturdays = async () => {
    setGenerating(true);
    try {
      const res = await api.post('/api/settings/generate-saturdays', { year: new Date().getFullYear() });
      showToast(`${res.generated} Saturday holidays generated`);
      setConfirmSat(false);
      const h = await api.get('/api/settings?type=holidays');
      setHolidays(Array.isArray(h) ? h : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const previewCleanup = async () => {
    setCleanupLoading(true);
    try {
      const res = await api.post('/api/settings/cleanup-saturday-holidays', {});
      setCleanupPreview(res);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setCleanupLoading(false);
    }
  };

  const doCleanup = async () => {
    setCleaning(true);
    try {
      const res = await api.post('/api/settings/cleanup-saturday-holidays', { confirm: true });
      showToast(`Removed ${res.deleted} auto-generated Saturday holiday(s)`);
      setConfirmCleanup(false);
      setCleanupPreview(null);
      const h = await api.get('/api/settings?type=holidays');
      setHolidays(Array.isArray(h) ? h : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setCleaning(false);
    }
  };

  const previewReeval = async (date) => {
    setReevalDate(date);
    setReevalPreview(null);
    setReevalLoading(true);
    try {
      const res = await api.post('/api/settings/reevaluate-leaves', { date, preview: true });
      setReevalPreview(res);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setReevalLoading(false);
    }
  };

  const doReeval = async () => {
    if (!reevalDate) return;
    setReevalConfirming(true);
    try {
      const res = await api.post('/api/settings/reevaluate-leaves', { date: reevalDate, confirm: true });
      showToast(`Re-evaluated ${res?.applied?.length || 0} leave(s) overlapping ${reevalDate}`);
      setReevalDate(null);
      setReevalPreview(null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setReevalConfirming(false);
    }
  };
  const saturdayPatternLabel = () => {
    const p = String(config.saturdayAlternatePattern || 'pattern1').toLowerCase();
    if (p === 'pattern2') return 'Pattern 2 (opposite phase)';
    if (p === 'legacy') return 'Legacy (1st & 3rd per cycle)';
    return 'Pattern 1';
  };

  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);
  const visibleTabs = TABS.filter(t => t.key !== 'shiftChanges' || isAdmin);

  useEffect(() => {
    if (tab !== 'shiftChanges' || !isAdmin) return;
    let cancelled = false;
    setShiftNotifsLoading(true);
    api.get('/api/notifications?scope=all&type=shift')
      .then(d => { if (!cancelled) setShiftNotifs(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setShiftNotifs([]); })
      .finally(() => { if (!cancelled) setShiftNotifsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, isAdmin]);

  const load = async () => {
    setLoading(true);
    try {
      const [d, r, dg, cat, s, h, c, e] = await Promise.all([
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=roles'),
        api.get('/api/settings?type=designations'),
        api.get('/api/settings?type=categories'),
        api.get('/api/settings?type=shifts'),
        api.get('/api/settings?type=holidays'),
        api.get('/api/settings?type=config'),
        api.get('/api/settings?type=sme_expertise'),
      ]);
      setDepartments(Array.isArray(d)   ? d   : []);
      setRoles(Array.isArray(r)         ? r   : []);
      setDesignations(Array.isArray(dg) ? dg  : []);
      setCategories(Array.isArray(cat)  ? cat : []);
      setShifts(Array.isArray(s)        ? s   : []);
      setHolidays(Array.isArray(h)      ? h   : []);
      setExpertise(Array.isArray(e)     ? e   : []);
      if (Array.isArray(c)) {
        const gc = c.find(i => i.key === 'global_config');
        if (gc?.value) setConfig(p => ({
          ...p,
          ...gc.value,
          payrollStartDay: toDateInputValue(gc.value.payrollStartDay) || p.payrollStartDay,
          payrollEndDay: toDateInputValue(gc.value.payrollEndDay) || p.payrollEndDay,
        }));
        const nc = c.find(i => i.key === 'notification_rules');
        if (nc?.value) setNotifications(nc.value);
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  if (!isAdmin) return (
    <AppShell title="Settings">
      <div className="empty-state">
        <i className="bi bi-lock" />
        <h6>Access Restricted</h6>
        <p style={{ fontSize: 13, color: '#94a3b8' }}>Only Super Admin and Admin can access settings.</p>
      </div>
    </AppShell>
  );

  const saveItem = async (type, body) => {
    setSaving(true);
    try {
      if (body._id) {
        const { _id, createdAt, updatedAt, __v, members, ...clean } = body;
        await api.put('/api/settings', { type, id: body._id, ...clean });
      } else {
        await api.post('/api/settings', { type, ...body });
      }
      showToast('Saved successfully');
      setShowModal(null);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveHoliday = async (form) => {
    setSaving(true);
    try {
      // Never send a `type` key: the route discriminator is also called
      // `type`, so the holiday kind travels as `holidayType`.
      const { type: _ignored, ...rest } = form || {};
      const res = form?._id
        ? await api.put('/api/settings', { type: 'holidays', id: form._id, ...rest })
        : await api.post('/api/settings', { type: 'holidays', ...rest });
      showToast(res?.synced ? `Saved — ${(res.synced.updated || 0) + (res.synced.inserted || 0)} attendance row(s) updated` : 'Saved successfully');
      setShowModal(null);
      load();
      // A newly-bookmarked working Saturday changes the leave calendar:
      // offer the retroactive re-evaluation (preview → confirm).
      if (res?.workingDayOverride && res?.date) {
        previewReeval(res.date);
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const saveShift = () => {
    const errs = validateShiftForm(modalForm);
    setShiftErrs(errs);
    if (Object.keys(errs).length > 0) return;
    saveItem('shifts', modalForm);
  };

  const deleteItem = (type, id) => {
    setDeleteTarget({ type, id });
    setDeleteImpact(null);
    if (type === 'holidays') {
      api.delete('/api/settings', { type: 'holidays', id, preview: true })
        .then(res => setDeleteImpact(res?.impact || null))
        .catch(() => {});
    }
  };

  const deleteTargetLabel = () => {
    if (!deleteTarget) return '';
    const pools = { departments, sme_expertise: expertise, roles, designations, categories, shifts, holidays };
    return pools[deleteTarget.type]?.find(i => i._id === deleteTarget.id)?.name || '';
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete('/api/settings', { type: deleteTarget.type, id: deleteTarget.id });
      if (deleteTarget.type === 'holidays' && res?.synced) {
        showToast(`Deleted — ${(res.synced.updated || 0) + (res.synced.inserted || 0)} attendance row(s) updated`);
      } else {
        showToast('Deleted');
      }
      setDeleteTarget(null);
      setDeleteImpact(null);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const endShiftSessions = (shift) => {
    setEndSessionTarget(shift);
  };

  const confirmEndSessions = async () => {
    if (!endSessionTarget) return;
    setEndingSessions(true);
    try {
      const res = await api.post('/api/attendance/end-shift-sessions', { shiftId: endSessionTarget._id });
      showToast(res?.message || 'Sessions ended');
      setEndSessionTarget(null);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setEndingSessions(false);
    }
  };

  const previewArchive = async () => {
    try {
      const res = await api.get(`/api/core/archive?olderThanYears=${archiveYears}`);
      setArchivePreview(res);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const runArchive = async () => {
    if (!archivePreview || archivePreview.count === 0) return;
    setArchiving(true);
    try {
      const res = await api.post('/api/core/archive', { olderThanYears: archiveYears });
      showToast(`${res.archived} profiles archived successfully`);
      setArchivePreview(null);
      setConfirmArchive(false);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setArchiving(false);
    }
  };

  const saveConfig = async (key, value) => {
    setSaving(true);
    try {
      await api.post('/api/settings', { type: 'config', key, value });
      if (key === 'global_config') updateSettings(value);
      showToast('Settings saved successfully');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Reusable table section for dept/role/designation
  const renderSimpleTable = (type, items, columns, onAdd, onEdit, onDelete) => (
    <div className="card p-3 p-md-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>{TABS.find(t => t.key === type)?.label} Management</div>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          <i className="bi bi-plus-lg me-1" />Add {TABS.find(t => t.key === type)?.label.slice(0, -1)}
        </button>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ padding: 30 }}>
          <i className={'bi ' + TABS.find(t => t.key === type)?.icon} />
          <h6>No {type} added yet</h6>
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="table-responsive d-none d-md-block">
            <table className="table mb-0">
              <thead>
                <tr>
                  {columns.map(c => <th key={c.key}>{c.label}</th>)}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item._id}>
                    {columns.map(c => (
                      <td key={c.key} style={{ fontSize: 13, fontWeight: c.bold ? 600 : 400 }}>
                        {item[c.key] || '—'}
                      </td>
                    ))}
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onEdit(item)}>Edit</button>
                        <button className="btn btn-sm btn-outline-danger"  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onDelete(item._id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="d-md-none" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(item => (
              <div key={item._id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{item.name}</div>
                    {columns.filter(c => c.key !== 'name').map(c => item[c.key] ? (
                      <div key={c.key} style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{c.label}: {item[c.key]}</div>
                    ) : null)}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onEdit(item)}>Edit</button>
                    <button className="btn btn-sm btn-outline-danger"  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onDelete(item._id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <AppShell title="Settings">
      {toast && (
        <div className="toast-container-custom">
          <div className={'toast-custom ' + toast.type}>
            <i className={'bi ' + (toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle') + ' me-2'} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div><h4>Settings & Configuration</h4><p>System-wide settings, roles, designations, departments, shifts and preferences</p></div>
      </div>

      <div className="row g-3">
        {/* Sidebar tabs */}
        <div className="col-md-3">
          <div className="card p-2">
            {/* Mobile: horizontal scroll */}
            <div style={{ overflowX: 'auto', display: 'flex', flexDirection: 'row', gap: 4 }} className="d-md-none pb-1">
              {visibleTabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={'nav-item-link' + (tab === t.key ? ' active' : '')}
                  style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
                  <i className={'bi ' + t.icon} />{t.label}
                </button>
              ))}
            </div>
            {/* Desktop: vertical */}
            <div className="d-none d-md-block">
              {visibleTabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={'nav-item-link' + (tab === t.key ? ' active' : '')}
                  style={{ marginBottom: 2 }}>
                  <i className={'bi ' + t.icon} />{t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="col-md-9">

          {/* GENERAL */}
          {tab === 'general' && (
            <div className="card p-3 p-md-4">
              <div className="section-title mb-4">General Configuration</div>
              <div className="row g-3">
                {[
                  ['Timezone',    'timezone',    ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London']],
                  ['Currency',    'currency',    ['INR', 'USD', 'EUR', 'GBP']],
                  ['Date Format', 'dateFormat',  ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']],
                  ['Language',    'language',    ['English', 'Hindi', 'Tamil', 'Telugu']],
                  ['Time Format', 'timeFormat',  [
                    { label: '24 Hour (Railway Time)', value: '24h' },
                    { label: '12 Hour (AM/PM)', value: '12h' },
                  ]],
                ].map(([label, key, opts]) => (
                  <div key={key} className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
                    <select className="form-select" value={config[key]} onChange={e => setConfig(p => ({ ...p, [key]: e.target.value }))}>
                      {opts.map(o => {
                        const isObj = typeof o === 'object';
                        return <option key={isObj ? o.value : o} value={isObj ? o.value : o}>{isObj ? o.label : o}</option>;
                      })}
                    </select>
                  </div>
                ))}
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Payroll Cycle Start Date</label>
                  <DateInput className="form-control" value={toDateInputValue(config.payrollStartDay)} onChange={e => setConfig(p => ({ ...p, payrollStartDay: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Payroll Cycle End Date</label>
                  <DateInput className="form-control" value={toDateInputValue(config.payrollEndDay)} onChange={e => setConfig(p => ({ ...p, payrollEndDay: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Late Login Threshold (minutes)</label>
                  <input type="number" className="form-control" value={config.lateThreshold} onChange={e => setConfig(p => ({ ...p, lateThreshold: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Permission Monthly Allowance (minutes)</label>
                  <input type="number" className="form-control" min={0} max={480} value={config.permissionMonthlyAllowanceMins ?? '120'} onChange={e => setConfig(p => ({ ...p, permissionMonthlyAllowanceMins: e.target.value }))} />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Per payroll cycle, no carry-forward. Also caps a single request.</div>
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Saturday Working</label>
                  <select className="form-select" value={config.saturdayWorking} onChange={e => setConfig(p => ({ ...p, saturdayWorking: e.target.value }))}>
                    <option value="all">All Saturdays Working</option>
                    <option value="alternate">Alternate Saturdays</option>
                    <option value="none">No Saturdays</option>
                  </select>
                </div>
                {String(config.saturdayWorking || 'alternate').toLowerCase() === 'alternate' && (
                  <>
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Alternate Saturday Pattern</label>
                      <select className="form-select" value={config.saturdayAlternatePattern || 'pattern1'} onChange={e => setConfig(p => ({ ...p, saturdayAlternatePattern: e.target.value }))}>
                        <option value="pattern1">Pattern 1</option>
                        <option value="pattern2">Pattern 2 (opposite phase)</option>
                        <option value="legacy">Legacy — 1st &amp; 3rd per cycle (deprecated)</option>
                      </select>
                      {String(config.saturdayAlternatePattern || 'pattern1').toLowerCase() === 'legacy' && (
                        <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
                          Temporary migration aid. Keeps the original per-cycle rule, which leaves two working Saturdays in a row in 5-Saturday cycles. Switch to Pattern 1 or 2 after verifying payroll.
                        </div>
                      )}
                    </div>
                    <div className="col-12">
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Next 10 Saturdays preview</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(() => {
                          const out = [];
                          const cur = new Date();
                          while (out.length < 10) {
                            if (cur.getDay() === 6) {
                              const ds = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0') + '-' + String(cur.getDate()).padStart(2, '0');
                              const overridden = (holidays || []).some(h => h.date === ds && h.workingDayOverride);
                              const off = overridden ? false : isSaturdayOff(ds, { saturdayWorking: 'alternate', saturdayAlternatePattern: config.saturdayAlternatePattern, payrollStartDay: config.payrollStartDay });
                              out.push(
                                <span key={ds} className="badge" style={{ background: off ? '#fee2e2' : '#dcfce7', color: off ? '#b91c1c' : '#16a34a', fontSize: 11, fontWeight: 600 }}>
                                  {ds.slice(8)}/{ds.slice(5, 7)} · {off ? 'Holiday' : overridden ? 'Working (override)' : 'Working'}
                                </span>
                              );
                            }
                            cur.setDate(cur.getDate() + 1);
                          }
                          return out;
                        })()}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Alternation never resets at a payroll-cycle boundary — a 5-Saturday cycle is always L·W·L·W·L or W·L·W·L·W.</div>
                    </div>
                  </>
                )}
                <div className="col-12">
                  <button className="btn btn-primary" onClick={() => saveConfig('global_config', config)} disabled={saving}>
                    {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : <><i className="bi bi-check-lg me-2" />Save Settings</>}
                  </button>
                </div>
              </div>

              {/* Data Retention */}
              {user?.role === 'super_admin' && (
                <>
                  <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 28, paddingTop: 24 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Data Retention Policy</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Archive separated (resigned / terminated / retired) employees whose profiles are locked and older than N years. Archived profiles are excluded from active queries.</div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div>
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Years Since Exit Clearance</label>
                        <input type="number" className="form-control" min={1} max={20} style={{ width: 100 }} value={archiveYears} onChange={e => { setArchiveYears(Number(e.target.value)); setArchivePreview(null); }} />
                      </div>
                      <button className="btn btn-outline-secondary btn-sm" onClick={previewArchive} style={{ height: 38 }}>
                        <i className="bi bi-search me-1" />Preview
                      </button>
                      {archivePreview && archivePreview.count > 0 && (
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirmArchive(true)} disabled={archiving} style={{ height: 38 }}>
                          {archiving ? <><span className="spinner-border spinner-border-sm me-1" />Archiving...</> : <><i className="bi bi-archive me-1" />Archive {archivePreview.count} Profiles</>}
                        </button>
                      )}
                    </div>
                    {archivePreview && (
                      <div style={{ marginTop: 14, background: archivePreview.count === 0 ? '#f0fdf4' : '#fff7ed', border: `1px solid ${archivePreview.count === 0 ? '#bbf7d0' : '#fed7aa'}`, borderRadius: 10, padding: 14 }}>
                        {archivePreview.count === 0 ? (
                          <div style={{ fontSize: 13, color: '#16a34a' }}><i className="bi bi-check-circle me-2" />No profiles match this retention criteria.</div>
                        ) : (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 10 }}>
                              <i className="bi bi-exclamation-triangle me-2" />{archivePreview.count} profiles eligible for archival (separated before {formatDate(archivePreview.cutoff)})
                            </div>
                            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                              {archivePreview.candidates.slice(0, 10).map(c => (
                                <div key={c.profileId} style={{ fontSize: 12, color: '#78350f', padding: '4px 0', borderBottom: '1px solid #fed7aa20' }}>
                                  {c.name} &mdash; {c.employeeNumber} &mdash; <span style={{ textTransform: 'capitalize' }}>{c.employmentStatus}</span>
                                </div>
                              ))}
                              {archivePreview.count > 10 && <div style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>...and {archivePreview.count - 10} more</div>}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* DEPARTMENTS */}
          {tab === 'departments' && renderSimpleTable(
            'departments', departments,
            [{ key: 'name', label: 'Department', bold: true }, { key: 'head', label: 'Head' }, { key: 'visibleDepartments', label: 'Can View' }],
            () => { setModalForm({ name: '', head: '', visibleDepartments: [] }); setShowModal('dept'); },
            item => { setModalForm({ ...item }); setShowModal('dept'); },
            id => deleteItem('departments', id)
          )}

          {/* EXPERTISE */}
          {tab === 'expertise' && renderSimpleTable(
            'sme_expertise', expertise,
            [{ key: 'name', label: 'Expertise Area', bold: true }],
            () => { setModalForm({ name: '' }); setShowModal('expertise'); },
            item => { setModalForm({ ...item }); setShowModal('expertise'); },
            id => deleteItem('sme_expertise', id)
          )}

          {/* ROLES */}
          {tab === 'roles' && renderSimpleTable(
            'roles', roles,
            [{ key: 'name', label: 'Role Name', bold: true }, { key: 'description', label: 'Description' }],
            () => { setModalForm({ name: '', description: '' }); setShowModal('role'); },
            item => { setModalForm({ ...item }); setShowModal('role'); },
            id => deleteItem('roles', id)
          )}

          {/* DESIGNATIONS */}
          {tab === 'designations' && renderSimpleTable(
            'designations', designations,
            [{ key: 'name', label: 'Designation', bold: true }, { key: 'department', label: 'Department' }, { key: 'description', label: 'Description' }],
            () => { setModalForm({ name: '', department: '', description: '' }); setShowModal('designation'); },
            item => { setModalForm({ ...item }); setShowModal('designation'); },
            id => deleteItem('designations', id)
          )}

          {/* ASSET CATEGORIES */}
          {tab === 'categories' && renderSimpleTable(
            'categories', categories,
            [{ key: 'name', label: 'Category Name', bold: true }, { key: 'description', label: 'Description' }],
            () => { setModalForm({ name: '', description: '' }); setShowModal('category'); },
            item => { setModalForm({ ...item }); setShowModal('category'); },
            id => deleteItem('categories', id)
          )}

          {/* SHIFTS */}
          {tab === 'shifts' && (
            <ShiftMaster
              shifts={shifts}
              loading={loading}
              endingSessions={endingSessions}
              formatTime={formatTime}
              onAdd={() => { setModalForm({ ...DEFAULT_SHIFT_FORM }); setShiftErrs({}); setShowModal('shift'); }}
              onEdit={(s) => { setModalForm({ ...s }); setShiftErrs({}); setShowModal('shift'); }}
              onDelete={(id) => deleteItem('shifts', id)}
              onEndSession={endShiftSessions}
            />
          )}

          {/* HOLIDAYS */}
          {tab === 'holidays' && (
            <div className="card p-3 p-md-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                <div className="section-title" style={{ margin: 0 }}>Holiday Calendar</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', date: '', holidayType: 'National' }); setShowModal('holiday'); }}>
                    <i className="bi bi-plus-lg me-1" />Add Holiday
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => setConfirmSat(true)} disabled={generating}>
                    <i className={`bi ${generating ? 'bi-arrow-repeat' : 'bi-calendar-check'} me-1`} />{generating ? 'Generating...' : 'Generate Saturday Holidays'}
                  </button>
                  <button className="btn btn-outline-danger btn-sm" onClick={previewCleanup} disabled={cleanupLoading}>
                    <i className={`bi ${cleanupLoading ? 'bi-arrow-repeat' : 'bi-eraser'} me-1`} />{cleanupLoading ? 'Scanning...' : 'Clean Up Saturday Holidays'}
                  </button>
                </div>
              </div>
              {cleanupPreview && (
                <div className="alert py-2 px-3 mb-3" style={{ fontSize: 12, background: cleanupPreview.count > 0 ? '#fffbeb' : '#f0fdf4', border: `1px solid ${cleanupPreview.count > 0 ? '#fde68a' : '#bbf7d0'}`, color: cleanupPreview.count > 0 ? '#92400e' : '#166534' }}>
                  {cleanupPreview.count > 0 ? (
                    <>
                      <strong>{cleanupPreview.count}</strong> auto-generated Saturday holiday(s) found
                      {cleanupPreview.pattern ? <> (active pattern: <strong>{cleanupPreview.pattern}</strong>)</> : null}.
                      Only generator-created rows are listed — manual holidays are never touched.
                      <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 6, background: '#fff', border: '1px solid #f1f5f9', borderRadius: 6, padding: '4px 8px' }}>
                        {cleanupPreview.holidays.slice(0, 30).map(h => (
                          <div key={h._id}>{h.date} — {h.name}</div>
                        ))}
                        {cleanupPreview.holidays.length > 30 && <div>...and {cleanupPreview.holidays.length - 30} more</div>}
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirmCleanup(true)}>Remove {cleanupPreview.count}</button>
                        <button className="btn btn-outline-secondary btn-sm" onClick={() => setCleanupPreview(null)}>Dismiss</button>
                      </div>
                    </>
                  ) : (
                    <>No auto-generated Saturday holidays found. Nothing to clean up. <button className="btn btn-link btn-sm p-0" style={{ fontSize: 12 }} onClick={() => setCleanupPreview(null)}>Dismiss</button></>
                  )}
                </div>
              )}
              {loading ? (
                <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
              ) : (
                <>
                  <div className="table-responsive d-none d-md-block">
                    <table className="table mb-0">
                      <thead><tr><th>Holiday</th><th>Date</th><th>Type</th><th>Day</th><th>Actions</th></tr></thead>
                      <tbody>
                        {holidays.length === 0 ? (
                          <tr><td colSpan={5}><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-calendar3" /><h6>No holidays added</h6></div></td></tr>
                        ) : holidays.map(h => (
                          <tr key={h._id}>
                            <td style={{ fontSize: 13, fontWeight: 600 }}>{h.name}</td>
                            <td style={{ fontSize: 13 }}>{formatDate(h.date)}</td>
                            <td><span className="badge" style={{ background: h.type === 'National' ? '#dbeafe' : '#fef3c7', color: h.type === 'National' ? '#2563eb' : '#d97706' }}>{h.type}</span></td>
                            <td style={{ fontSize: 13, color: '#64748b' }}>{h.date ? new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : '—'}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { const { type: _ignored, ...rest } = h || {}; setModalForm({ ...rest, holidayType: h.type || 'National' }); setShowModal('holiday'); }}>Edit</button>
                                <button className="btn btn-sm btn-outline-danger"  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteItem('holidays', h._id)}>Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="d-md-none" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {holidays.map(h => (
                      <div key={h._id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{h.name}</div>
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{formatDate(h.date)}</div>
                            <span className="badge mt-1" style={{ background: h.type === 'National' ? '#dbeafe' : '#fef3c7', color: h.type === 'National' ? '#2563eb' : '#d97706' }}>{h.type}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { const { type: _ignored, ...rest } = h || {}; setModalForm({ ...rest, holidayType: h.type || 'National' }); setShowModal('holiday'); }}>Edit</button>
                            <button className="btn btn-sm btn-outline-danger"  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteItem('holidays', h._id)}>Delete</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* SHIFT CHANGES */}
          {tab === 'shiftChanges' && (
            <div className="card p-3 p-md-4">
              <div className="section-title mb-1">Shift Change Notifications</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>Notifications sent to employees when a shift is created, updated, or reassigned.</div>
              <input className="form-control mb-3" placeholder="Search by employee or message..."
                value={shiftSearch}
                onChange={e => setShiftSearch(e.target.value)} />
              {shiftNotifsLoading ? (
                <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
              ) : (
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Employee</th><th>Notification</th><th>When</th></tr></thead>
                    <tbody>
                      {shiftNotifs.length === 0 ? (
                        <tr><td colSpan={3}><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-arrow-repeat" /><h6>No shift change notifications yet</h6></div></td></tr>
                      ) : shiftNotifs.filter(n => {
                        const q = shiftSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (n.userId?.name || '').toLowerCase().includes(q) || (n.message || '').toLowerCase().includes(q);
                      }).map(n => (
                        <tr key={n._id}>
                          <td style={{ fontSize: 13 }}>
                            <div style={{ fontWeight: 600 }}>{n.userId?.name || '—'}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>{n.userId?.department || n.userId?.email || ''}</div>
                          </td>
                          <td style={{ fontSize: 13 }}>
                            <div style={{ fontWeight: 600 }}>{n.title}</div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>{n.message}</div>
                          </td>
                          <td style={{ fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>{formatDateTime(n.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* NOTIFICATIONS */}
          {tab === 'notifications' && (
            <div className="card p-3 p-md-4">
              <div className="section-title mb-4">Notification Rules</div>
              {NOTIFICATION_RULES.map(([title, desc]) => (
                <div key={title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #f8fafc' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{desc}</div>
                  </div>
                  <div className="form-check form-switch mb-0">
                    <input className="form-check-input" type="checkbox" checked={!!notifications[title]}
                      onChange={e => setNotifications(p => ({ ...p, [title]: e.target.checked }))} style={{ cursor: 'pointer' }} />
                  </div>
                </div>
              ))}
              <button className="btn btn-primary mt-4" onClick={() => saveConfig('notification_rules', notifications)} disabled={saving}>
                {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : <><i className="bi bi-check-lg me-2" />Save</>}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* DEPARTMENT MODAL */}
      {showModal === 'dept' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Department</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Name *</label>
                    <input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Head</label>
                    <input className="form-control" value={modalForm.head || ''} onChange={e => setModalForm(p => ({ ...p, head: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Can view employees from</label>
                    <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: '8px 12px' }}>
                      {departments
                        .filter(d => d.name !== modalForm.name)
                        .map(d => (
                          <div key={d._id} className="form-check" style={{ marginBottom: 4 }}>
                            <input className="form-check-input" type="checkbox"
                              checked={(modalForm.visibleDepartments || []).includes(d.name)}
                              onChange={e => {
                                const current = modalForm.visibleDepartments || [];
                                setModalForm(p => ({
                                  ...p,
                                  visibleDepartments: e.target.checked
                                    ? [...current, d.name]
                                    : current.filter(n => n !== d.name),
                                }));
                              }} />
                            <label className="form-check-label" style={{ fontSize: 13 }}>{d.name}</label>
                          </div>
                        ))}
                      {departments.length <= 1 && <span className="text-muted" style={{ fontSize: 13 }}>No other departments available</span>}
                    </div>
                    <small className="text-muted" style={{ fontSize: 11 }}>Team leads and team admins in this department will be able to view data from selected departments.</small>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('departments', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXPERTISE MODAL */}
      {showModal === 'expertise' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Expertise Area</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Expertise Name *</label>
                    <input className="form-control" placeholder="e.g. Machine Learning" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('sme_expertise', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ROLE MODAL */}
      {showModal === 'role' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Role</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Role Name *</label>
                    <input className="form-control" placeholder="e.g. Senior Developer" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                    <textarea className="form-control" rows={2} placeholder="Brief description of this role" value={modalForm.description || ''} onChange={e => setModalForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('roles', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DESIGNATION MODAL */}
      {showModal === 'designation' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Designation</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Designation Name *</label>
                    <input className="form-control" placeholder="e.g. Software Engineer" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Department</label>
                    <select className="form-select" value={modalForm.department || ''} onChange={e => setModalForm(p => ({ ...p, department: e.target.value }))}>
                      <option value="">— Select Department —</option>
                      {departments.map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                    <textarea className="form-control" rows={2} placeholder="Brief description" value={modalForm.description || ''} onChange={e => setModalForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('designations', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CATEGORY MODAL */}
      {showModal === 'category' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Asset Category</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category Name *</label>
                    <input className="form-control" placeholder="e.g. Laptop" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                    <textarea className="form-control" rows={2} placeholder="Brief description" value={modalForm.description || ''} onChange={e => setModalForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('categories', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHIFT MODAL */}
      {showModal === 'shift' && (
        <ShiftFormModal
          form={modalForm}
          setForm={setModalForm}
          errors={shiftErrs}
          setErrors={setShiftErrs}
          saving={saving}
          onSave={saveShift}
          onClose={() => setShowModal(null)}
        />
      )}

      {/* HOLIDAY MODAL */}
      {showModal === 'holiday' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Holiday</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Holiday Name *</label>
                    <input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Date</label>
                    <DateInput className="form-control" value={modalForm.date || ''} onChange={e => setModalForm(p => ({ ...p, date: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Type</label>
                    <select className="form-select" value={modalForm.holidayType || modalForm.type || 'National'} onChange={e => setModalForm(p => { const { type: _ignored, ...rest } = p || {}; return { ...rest, holidayType: e.target.value }; })}>
                      {['National', 'Optional', 'Company'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const d = new Date(String(modalForm.date || '') + 'T00:00:00');
                    const isSat = !Number.isNaN(d.getTime()) && d.getDay() === 6;
                    return (
                      <div className="col-12">
                        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: isSat ? 'pointer' : 'not-allowed', color: isSat ? '#1e293b' : '#94a3b8', fontWeight: 600 }}>
                          <input type="checkbox" checked={!!modalForm.workingDayOverride} disabled={!isSat}
                            onChange={e => setModalForm(p => ({ ...p, workingDayOverride: e.target.checked }))} />
                          Treat as working day (compensated Saturday)
                        </label>
                        {!isSat && (
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Only Saturdays can be bookmarked as working days.</div>
                        )}
                        {isSat && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>The date counts as a full working day for attendance, leave and payroll. Existing leave on it is offered for re-evaluation after saving.</div>
                        )}
                        {!!modalForm.workingDayOverride && (
                          <div style={{ marginTop: 8 }}>
                            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Reason</label>
                            <input className="form-control" value={modalForm.overrideReason || ''} onChange={e => setModalForm(p => ({ ...p, overrideReason: e.target.value }))} placeholder="e.g. Worked in lieu of festival holiday" />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveHoliday(modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmModal
        open={!!endSessionTarget}
        title="End Active Sessions"
        confirmText="End Sessions"
        variant="danger"
        confirming={endingSessions}
        onClose={() => setEndSessionTarget(null)}
        onConfirm={confirmEndSessions}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          End all active sessions for <strong>{endSessionTarget?.name}</strong>? This will clock out
          every employee currently clocked in on this shift.
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete"
        confirmText="Delete"
        variant="danger"
        confirming={deleting}
        onClose={() => { if (!deleting) { setDeleteTarget(null); setDeleteImpact(null); } }}
        onConfirm={doDelete}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Are you sure you want to delete{deleteTargetLabel() ? <> <strong>{deleteTargetLabel()}</strong></> : ' this'}? This cannot be undone.
        </p>
        {deleteTarget?.type === 'holidays' && deleteImpact && deleteImpact.nonWorked > 0 && (
          <p style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: '10px 0 0' }}>
            <i className="bi bi-exclamation-triangle me-1" />
            <strong>{deleteImpact.nonWorked}</strong> employee(s) had no clock-in on this date and will be marked <strong>Absent</strong>.
            {deleteImpact.worked > 0 && <> {deleteImpact.worked} with clock-in keep their hours.</>}
          </p>
        )}
      </ConfirmModal>
      <ConfirmModal
        open={confirmSat}
        title="Generate Saturday Holidays"
        confirmText="Generate"
        variant="primary"
        confirming={generating}
        onClose={() => { if (!generating) setConfirmSat(false); }}
        onConfirm={generateSaturdays}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Generate alternate Saturday holidays for <strong>{new Date().getFullYear()}</strong> using{' '}
          <strong>{saturdayPatternLabel()}</strong>? This will not overwrite existing holidays on those dates.
          Saturdays are already treated as non-working by the calendar — this only adds named holiday entries.
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={confirmCleanup}
        title="Remove Saturday Holidays"
        confirmText={`Remove ${cleanupPreview?.count || 0}`}
        variant="danger"
        confirming={cleaning}
        onClose={() => { if (!cleaning) setConfirmCleanup(false); }}
        onConfirm={doCleanup}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Permanently remove the <strong>{cleanupPreview?.count || 0}</strong> auto-generated Saturday
          holiday(s) listed above? Manual holidays are not affected. Re-run{' '}
          <strong>Generate Saturday Holidays</strong> afterwards to rebuild them under the active pattern.
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={!!reevalDate}
        title={`Re-evaluate leave on ${reevalDate || ''}`}
        confirmText={reevalPreview ? `Apply to ${reevalPreview?.totals?.leavesChanged || 0} leave(s)` : 'Apply'}
        variant="primary"
        confirming={reevalConfirming || reevalLoading}
        onClose={() => { if (!reevalConfirming && !reevalLoading) { setReevalDate(null); setReevalPreview(null); } }}
        onConfirm={doReeval}
      >
        {reevalLoading || !reevalPreview ? (
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            <span className="spinner-border spinner-border-sm me-2" />Computing affected leave…
          </p>
        ) : (
          <div style={{ fontSize: 13, color: '#334155' }}>
            <p style={{ margin: '0 0 8px' }}>
              <strong>{reevalPreview.totals.leavesChanged}</strong> leave record(s) change by{' '}
              <strong>{reevalPreview.totals.dayDelta > 0 ? '+' : ''}{reevalPreview.totals.dayDelta}</strong> day(s),
              balance impact <strong>{reevalPreview.totals.balanceDelta > 0 ? '+' : ''}{reevalPreview.totals.balanceDelta}</strong> day(s).
            </p>
            {reevalPreview.totals.closedCycles?.length > 0 && (
              <p style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', margin: '0 0 8px' }}>
                <i className="bi bi-exclamation-triangle me-1" />
                Cycle(s) already closed: <strong>{reevalPreview.totals.closedCycles.join(', ')}</strong>. The
                difference moves through the retro adjustment on the next run — no payroll is re-run.
              </p>
            )}
            {reevalPreview.attendance && (
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
                Attendance on {reevalDate}: {reevalPreview.attendance.worked} worked, {reevalPreview.attendance.onLeave} on leave,{' '}
                {reevalPreview.attendance.nonWorked} without clock-in (past rows flip to Absent on apply).
              </p>
            )}
            {(reevalPreview.changed || []).slice(0, 8).map(c => (
              <div key={c.leaveId} style={{ fontSize: 12, padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
                <strong>{c.type}</strong> {c.from} → {c.to} ({c.status}): {c.oldDays} → <strong>{c.newDays}</strong> day(s),
                balance {c.balanceDelta > 0 ? '+' : ''}{c.balanceDelta}
                {c.payrollClosed && <span style={{ color: '#92400e' }}> · cycle {c.payrollMonth} closed</span>}
              </div>
            ))}
            {(reevalPreview.changed || []).length > 8 && (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>…and {reevalPreview.changed.length - 8} more.</div>
            )}
            {(reevalPreview.skipped || []).length > 0 && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>{reevalPreview.skipped.length} record(s) skipped (see preview for reasons).</div>
            )}
          </div>
        )}
      </ConfirmModal>
      <ConfirmModal
        open={confirmArchive}
        title="Archive Profiles"
        confirmText={`Archive ${archivePreview?.count || 0} Profiles`}
        variant="danger"
        confirming={archiving}
        onClose={() => { if (!archiving) setConfirmArchive(false); }}
        onConfirm={runArchive}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Archive <strong>{archivePreview?.count || 0}</strong> separated profiles older than{' '}
          <strong>{archiveYears} years</strong>? This will change their status to "alumni" and cannot be
          undone without manual intervention.
        </p>
      </ConfirmModal>
    </AppShell>
  );
}
