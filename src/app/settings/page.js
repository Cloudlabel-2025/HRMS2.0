'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

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
  { key: 'roles',        label: 'Roles',        icon: 'bi-person-badge' },
  { key: 'designations', label: 'Designations', icon: 'bi-briefcase' },
  { key: 'shifts',       label: 'Shifts',       icon: 'bi-clock' },
  { key: 'holidays',     label: 'Holidays',     icon: 'bi-calendar3' },
  { key: 'notifications',label: 'Notifications',icon: 'bi-bell' },
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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { formatDate, updateSettings } = useSettings();
  const [tab, setTab]               = useState('general');
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles]           = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts]         = useState([]);
  const [holidays, setHolidays]     = useState([]);
  const [config, setConfig]         = useState({
    timezone: 'Asia/Kolkata', currency: 'INR', dateFormat: 'DD/MM/YYYY',
    language: 'English', payrollStartDay: getDefaultPayrollStartDate(), attendanceStartDay: '1',
    saturdayWorking: 'alternate', lateThreshold: '15',
  });
  const [archiveYears, setArchiveYears] = useState(3);
  const [archivePreview, setArchivePreview] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [showModal, setShowModal]   = useState(null);
  const [modalForm, setModalForm]   = useState({});
  const [toast, setToast]           = useState(null);
  const [notifications, setNotifications] = useState(
    Object.fromEntries(NOTIFICATION_RULES.map(([title, , def]) => [title, def]))
  );

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [d, r, dg, s, h, c] = await Promise.all([
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=roles'),
        api.get('/api/settings?type=designations'),
        api.get('/api/settings?type=shifts'),
        api.get('/api/settings?type=holidays'),
        api.get('/api/settings?type=config'),
      ]);
      setDepartments(Array.isArray(d)  ? d  : []);
      setRoles(Array.isArray(r)        ? r  : []);
      setDesignations(Array.isArray(dg)? dg : []);
      setShifts(Array.isArray(s)       ? s  : []);
      setHolidays(Array.isArray(h)     ? h  : []);
      if (Array.isArray(c)) {
        const gc = c.find(i => i.key === 'global_config');
        if (gc?.value) setConfig(p => ({ ...p, ...gc.value, payrollStartDay: toDateInputValue(gc.value.payrollStartDay) || p.payrollStartDay }));
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
        await api.put('/api/settings', { type, id: body._id, ...body });
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

  const deleteItem = async (type, id) => {
    if (!confirm('Are you sure you want to delete this?')) return;
    try {
      await api.delete('/api/settings', { type, id });
      showToast('Deleted');
      load();
    } catch (e) {
      showToast(e.message, 'error');
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
    if (!confirm(`Archive ${archivePreview?.count} separated profiles older than ${archiveYears} years? This will change their status to "alumni" and cannot be undone without manual intervention.`)) return;
    setArchiving(true);
    try {
      const res = await api.post('/api/core/archive', { olderThanYears: archiveYears });
      showToast(`${res.archived} profiles archived successfully`);
      setArchivePreview(null);
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
              {TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className={'nav-item-link' + (tab === t.key ? ' active' : '')}
                  style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
                  <i className={'bi ' + t.icon} />{t.label}
                </button>
              ))}
            </div>
            {/* Desktop: vertical */}
            <div className="d-none d-md-block">
              {TABS.map(t => (
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
                ].map(([label, key, opts]) => (
                  <div key={key} className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
                    <select className="form-select" value={config[key]} onChange={e => setConfig(p => ({ ...p, [key]: e.target.value }))}>
                      {opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Payroll Cycle Start Day</label>
                  <input type="date" className="form-control" value={toDateInputValue(config.payrollStartDay)} onChange={e => setConfig(p => ({ ...p, payrollStartDay: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Payroll Cycle End Day</label>
                  <input type="date" className="form-control" value={toDateInputValue(config.payrollEndDay)} onChange={e => setConfig(p => ({ ...p, payrollEndDay: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Late Login Threshold (minutes)</label>
                  <input type="number" className="form-control" value={config.lateThreshold} onChange={e => setConfig(p => ({ ...p, lateThreshold: e.target.value }))} />
                </div>
                <div className="col-md-6">
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Saturday Working</label>
                  <select className="form-select" value={config.saturdayWorking} onChange={e => setConfig(p => ({ ...p, saturdayWorking: e.target.value }))}>
                    <option value="all">All Saturdays Working</option>
                    <option value="alternate">Alternate Saturdays</option>
                    <option value="none">No Saturdays</option>
                  </select>
                </div>
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
                        <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Years Since Last Update</label>
                        <input type="number" className="form-control" min={1} max={20} style={{ width: 100 }} value={archiveYears} onChange={e => { setArchiveYears(Number(e.target.value)); setArchivePreview(null); }} />
                      </div>
                      <button className="btn btn-outline-secondary btn-sm" onClick={previewArchive} style={{ height: 38 }}>
                        <i className="bi bi-search me-1" />Preview
                      </button>
                      {archivePreview && archivePreview.count > 0 && (
                        <button className="btn btn-danger btn-sm" onClick={runArchive} disabled={archiving} style={{ height: 38 }}>
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
                              <i className="bi bi-exclamation-triangle me-2" />{archivePreview.count} profiles eligible for archival (separated before {new Date(archivePreview.cutoff).toLocaleDateString()})
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
            [{ key: 'name', label: 'Department', bold: true }, { key: 'head', label: 'Head' }],
            () => { setModalForm({ name: '', head: '' }); setShowModal('dept'); },
            item => { setModalForm({ ...item }); setShowModal('dept'); },
            id => deleteItem('departments', id)
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

          {/* SHIFTS */}
          {tab === 'shifts' && (
            <div className="card p-3 p-md-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                <div className="section-title" style={{ margin: 0 }}>Shift Management</div>
                <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', startTime: '', endTime: '' }); setShowModal('shift'); }}>
                  <i className="bi bi-plus-lg me-1" />Add Shift
                </button>
              </div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
              ) : (
                <div className="row g-3">
                  {shifts.length === 0 && <div className="col-12"><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-clock" /><h6>No shifts defined</h6></div></div>}
                  {shifts.map(s => (
                    <div key={s._id} className="col-md-6">
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setModalForm({ ...s }); setShowModal('shift'); }}>Edit</button>
                            <button className="btn btn-sm btn-outline-danger"  style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteItem('shifts', s._id)}>Delete</button>
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b' }}>
                          <i className="bi bi-clock me-2" />
                          {s.startTime && s.endTime ? `${s.startTime} – ${s.endTime}` : 'No timing set'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* HOLIDAYS */}
          {tab === 'holidays' && (
            <div className="card p-3 p-md-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                <div className="section-title" style={{ margin: 0 }}>Holiday Calendar</div>
                <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', date: '', type: 'National' }); setShowModal('holiday'); }}>
                  <i className="bi bi-plus-lg me-1" />Add Holiday
                </button>
              </div>
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
                                <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setModalForm({ ...h }); setShowModal('holiday'); }}>Edit</button>
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
                            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setModalForm({ ...h }); setShowModal('holiday'); }}>Edit</button>
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

      {/* SHIFT MODAL */}
      {showModal === 'shift' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Shift</h5>
                <button className="btn-close" onClick={() => setShowModal(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Shift Name *</label>
                    <input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Start Time</label>
                    <input type="time" className="form-control" value={modalForm.startTime || ''} onChange={e => setModalForm(p => ({ ...p, startTime: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>End Time</label>
                    <input type="time" className="form-control" value={modalForm.endTime || ''} onChange={e => setModalForm(p => ({ ...p, endTime: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('shifts', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
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
                    <input type="date" className="form-control" value={modalForm.date || ''} onChange={e => setModalForm(p => ({ ...p, date: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Type</label>
                    <select className="form-select" value={modalForm.type || 'National'} onChange={e => setModalForm(p => ({ ...p, type: e.target.value }))}>
                      {['National', 'Optional', 'Company'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('holidays', modalForm)} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
