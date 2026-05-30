'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const NOTIFICATION_RULES = [
  ['Late Login Alert', 'Send alert when employee logs in after threshold', true],
  ['Absence Alert', 'Notify manager when employee is absent without leave', true],
  ['Leave Approval', 'Notify employee when leave is approved/rejected', true],
  ['Payslip Available', 'Notify employee when payslip is generated', true],
  ['Task Overdue', 'Alert when task passes due date', true],
  ['Document Expiry', 'Alert 30 days before document expiry', false],
  ['Performance Review Due', 'Remind employees to complete self-review', true],
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('general');
  const [departments, setDepartments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [config, setConfig] = useState({ timezone: 'Asia/Kolkata', currency: 'INR', dateFormat: 'DD/MM/YYYY', language: 'English', payrollStartDay: '1', attendanceStartDay: '1', saturdayWorking: 'alternate', lateThreshold: '15' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(null); // 'dept' | 'shift' | 'holiday'
  const [modalForm, setModalForm] = useState({});
  const [toast, setToast] = useState(null);
  // Default values for notifications from rules
  const [notifications, setNotifications] = useState(
    Object.fromEntries(NOTIFICATION_RULES.map(([title, desc, defaultOn]) => [title, defaultOn]))
  );

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [d, s, h, c] = await Promise.all([
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=shifts'),
        api.get('/api/settings?type=holidays'),
        api.get('/api/settings?type=config'),
      ]);
      setDepartments(Array.isArray(d) ? d : []);
      setShifts(Array.isArray(s) ? s : []);
      setHolidays(Array.isArray(h) ? h : []);
      
      if (Array.isArray(c)) {
        const globalConfig = c.find(item => item.key === 'global_config');
        if (globalConfig?.value) setConfig(p => ({ ...p, ...globalConfig.value }));
        const notifConfig = c.find(item => item.key === 'notification_rules');
        if (notifConfig?.value) setNotifications(notifConfig.value);
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
      <div className="empty-state"><i className="bi bi-lock" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>Only Super Admin and Admin can access settings.</p></div>
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

  const saveConfig = async (key, value) => {
    setSaving(true);
    try {
      await api.post('/api/settings', { type: 'config', key, value });
      showToast('Settings saved successfully');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (type, id) => {
    try {
      await api.delete('/api/settings', { type, id });
      showToast('Deleted');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const TABS = [
    { key: 'general', label: 'General', icon: 'bi-gear' },
    { key: 'shifts', label: 'Shifts', icon: 'bi-clock' },
    { key: 'departments', label: 'Departments', icon: 'bi-diagram-3' },
    { key: 'holidays', label: 'Holidays', icon: 'bi-calendar3' },
    { key: 'notifications', label: 'Notifications', icon: 'bi-bell' },
  ];

  return (
    <AppShell title="Settings">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Settings & Configuration</h4><p>System-wide settings, shifts, departments, and preferences</p></div>
      </div>

      <div className="row g-3">
        <div className="col-md-3">
          <div className="card p-2">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`nav-item-link ${tab === t.key ? 'active' : ''}`} style={{ marginBottom: 2 }}>
                <i className={`bi ${t.icon}`} />{t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="col-md-9">
          {tab === 'general' && (
            <div className="card p-4">
              <div className="section-title mb-4">General Configuration</div>
              <div className="row g-3">
                {[
                  ['Timezone', 'timezone', ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London']],
                  ['Currency', 'currency', ['INR', 'USD', 'EUR', 'GBP']],
                  ['Date Format', 'dateFormat', ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']],
                  ['Language', 'language', ['English', 'Hindi', 'Tamil', 'Telugu']],
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
                  <input type="number" min="1" max="28" className="form-control" value={config.payrollStartDay} onChange={e => setConfig(p => ({ ...p, payrollStartDay: e.target.value }))} />
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
            </div>
          )}

          {tab === 'departments' && (
            <div className="card p-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div className="section-title" style={{ margin: 0 }}>Department Management</div>
                <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', head: '' }); setShowModal('dept'); }}><i className="bi bi-plus-lg me-1" />Add Department</button>
              </div>
              {loading ? <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div> : (
                <table className="table">
                  <thead><tr><th>Department</th><th>Head</th><th>Actions</th></tr></thead>
                  <tbody>
                    {departments.length === 0 ? <tr><td colSpan={3}><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-diagram-3" /><h6>No departments</h6></div></td></tr> : departments.map(d => (
                      <tr key={d._id}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</td>
                        <td style={{ fontSize: 13 }}>{d.head || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setModalForm({ ...d }); setShowModal('dept'); }}>Edit</button>
                            <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteItem('departments', d._id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'shifts' && (
            <div className="card p-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div className="section-title" style={{ margin: 0 }}>Shift Management</div>
                <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', startTime: '', endTime: '' }); setShowModal('shift'); }}><i className="bi bi-plus-lg me-1" />Add Shift</button>
              </div>
              {loading ? <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div> : (
                <div className="row g-3">
                  {shifts.length === 0 && <div className="col-12"><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-clock" /><h6>No shifts defined</h6></div></div>}
                  {shifts.map(s => (
                    <div key={s._id} className="col-md-6">
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name} Shift</span>
                          <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setModalForm({ ...s }); setShowModal('shift'); }}>Edit</button>
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b' }}><i className="bi bi-clock me-2" />{s.startTime} – {s.endTime}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'holidays' && (
            <div className="card p-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div className="section-title" style={{ margin: 0 }}>Holiday Calendar</div>
                <button className="btn btn-primary btn-sm" onClick={() => { setModalForm({ name: '', date: '', type: 'National' }); setShowModal('holiday'); }}><i className="bi bi-plus-lg me-1" />Add Holiday</button>
              </div>
              {loading ? <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div> : (
                <table className="table">
                  <thead><tr><th>Holiday</th><th>Date</th><th>Type</th><th>Day</th><th>Actions</th></tr></thead>
                  <tbody>
                    {holidays.length === 0 ? <tr><td colSpan={5}><div className="empty-state" style={{ padding: 20 }}><i className="bi bi-calendar3" /><h6>No holidays added</h6></div></td></tr> : holidays.map(h => (
                      <tr key={h._id}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{h.name}</td>
                        <td style={{ fontSize: 13 }}>{h.date}</td>
                        <td><span className="badge" style={{ background: h.type === 'National' ? '#dbeafe' : '#fef3c7', color: h.type === 'National' ? '#2563eb' : '#d97706' }}>{h.type}</span></td>
                        <td style={{ fontSize: 13, color: '#64748b' }}>{h.date ? new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long' }) : '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => { setModalForm({ ...h }); setShowModal('holiday'); }}>Edit</button>
                            <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => deleteItem('holidays', h._id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'notifications' && (
            <div className="card p-4">
              <div className="section-title mb-4">Notification Rules</div>
              {NOTIFICATION_RULES.map(([title, desc]) => (
                <div key={title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #f8fafc' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{desc}</div>
                  </div>
                  <div className="form-check form-switch mb-0">
                    <input className="form-check-input" type="checkbox" checked={!!notifications[title]} onChange={e => setNotifications(p => ({ ...p, [title]: e.target.checked }))} style={{ cursor: 'pointer' }} />
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

      {/* Department Modal */}
      {showModal === 'dept' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Department</h5><button className="btn-close" onClick={() => setShowModal(null)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Name *</label><input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Head</label><input className="form-control" value={modalForm.head || ''} onChange={e => setModalForm(p => ({ ...p, head: e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('departments', modalForm)} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shift Modal */}
      {showModal === 'shift' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Shift</h5><button className="btn-close" onClick={() => setShowModal(null)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Shift Name *</label><input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Start Time</label><input type="time" className="form-control" value={modalForm.startTime || ''} onChange={e => setModalForm(p => ({ ...p, startTime: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>End Time</label><input type="time" className="form-control" value={modalForm.endTime || ''} onChange={e => setModalForm(p => ({ ...p, endTime: e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('shifts', modalForm)} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Holiday Modal */}
      {showModal === 'holiday' && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">{modalForm._id ? 'Edit' : 'Add'} Holiday</h5><button className="btn-close" onClick={() => setShowModal(null)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Holiday Name *</label><input className="form-control" value={modalForm.name || ''} onChange={e => setModalForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Date</label><input type="date" className="form-control" value={modalForm.date || ''} onChange={e => setModalForm(p => ({ ...p, date: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Type</label><select className="form-select" value={modalForm.type || 'National'} onChange={e => setModalForm(p => ({ ...p, type: e.target.value }))}>{['National', 'Optional', 'Company'].map(t => <option key={t}>{t}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => saveItem('holidays', modalForm)} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
