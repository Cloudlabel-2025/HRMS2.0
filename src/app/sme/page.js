'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const PLAN_COLORS = { Basic: '#64748b', Pro: '#3b82f6', Enterprise: '#8b5cf6' };
const EMPTY_SME = { name: '', contact: '', plan: 'Basic', status: 'trial' };

export default function SMEPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('clients');
  const [smes, setSmes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_SME);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  if (user && !['super_admin', 'admin_full'].includes(user.role)) return (
    <AppShell title="SME Portal">
      <div className="empty-state"><i className="bi bi-building" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>SME Portal is only accessible to Super Admin and Management Admin.</p></div>
    </AppShell>
  );

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/sme');
      const list = Array.isArray(data?.smes) ? data.smes : [];
      setSmes(list);
      if (list.length > 0 && !selected) setSelected(list[0]);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const saveSME = async () => {
    if (!form.name) return showToast('Name required', 'error');
    setSaving(true);
    try {
      if (form._id) {
        await api.put('/api/sme', { id: form._id, ...form });
        showToast('SME updated');
      } else {
        await api.post('/api/sme', form);
        showToast('SME client added');
      }
      setShowModal(false);
      setForm(EMPTY_SME);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.put('/api/sme', { id: selected._id, saturdayConfig: selected.saturdayConfig, payrollStart: selected.payrollStart, attendanceStart: selected.attendanceStart, defaultShift: selected.defaultShift });
      showToast(`Settings saved for ${selected.name}`);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="SME Portal">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>SME Portal</h4><p>Manage SME client organizations with isolated data</p></div>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY_SME); setShowModal(true); }}><i className="bi bi-plus-lg me-2" />Add SME Client</button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['clients', 'settings'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'clients' ? 'All Clients' : 'SME Settings'}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'clients' && (
            <div className="row g-3">
              {smes.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-building" /><h6>No SME clients yet</h6></div></div>}
              {smes.map(sme => (
                <div key={sme._id} className="col-md-6">
                  <div className="card p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 800 }}>{sme.name[0]}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{sme.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{sme.contact}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span className="badge" style={{ background: PLAN_COLORS[sme.plan] + '20', color: PLAN_COLORS[sme.plan] }}>{sme.plan}</span>
                        <span className={`badge ${sme.status === 'active' ? 'status-approved' : 'status-pending'}`}>{sme.status}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 12, flex: 1 }} onClick={() => { setForm({ ...sme }); setShowModal(true); }}><i className="bi bi-pencil me-1" />Edit</button>
                      <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 12, flex: 1 }} onClick={() => { setSelected(sme); setTab('settings'); }}><i className="bi bi-gear me-1" />Settings</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'settings' && (
            <div className="row g-3">
              <div className="col-md-3">
                <div className="card p-2">
                  {smes.map(s => (
                    <button key={s._id} onClick={() => setSelected(s)} className={`nav-item-link ${selected?._id === s._id ? 'active' : ''}`} style={{ marginBottom: 2, fontSize: 13 }}>
                      <i className="bi bi-building" />{s.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="col-md-9">
                {selected ? (
                  <div className="card p-4">
                    <div className="section-title mb-4">Settings — {selected.name}</div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Saturday Working</label>
                        <select className="form-select" value={selected.saturdayConfig || 'alternate'} onChange={e => setSelected(p => ({ ...p, saturdayConfig: e.target.value }))}>
                          <option value="all">All Saturdays</option>
                          <option value="alternate">Alternate Saturdays</option>
                          <option value="none">No Saturdays</option>
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Default Shift</label>
                        <select className="form-select" value={selected.defaultShift || 'Morning (9AM-6PM)'} onChange={e => setSelected(p => ({ ...p, defaultShift: e.target.value }))}>
                          {['Morning (9AM-6PM)', 'Evening (2PM-11PM)', 'Flexible'].map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Payroll Cycle Start Day</label>
                        <input type="number" min="1" max="28" className="form-control" value={selected.payrollStart || 1} onChange={e => setSelected(p => ({ ...p, payrollStart: +e.target.value }))} />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Attendance Cycle Start Day</label>
                        <input type="number" min="1" max="28" className="form-control" value={selected.attendanceStart || 1} onChange={e => setSelected(p => ({ ...p, attendanceStart: +e.target.value }))} />
                      </div>
                      <div className="col-12">
                        <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : <><i className="bi bi-check-lg me-2" />Save Settings</>}</button>
                      </div>
                    </div>
                  </div>
                ) : <div className="card p-4"><div className="empty-state"><i className="bi bi-building" /><h6>Select a client</h6></div></div>}
              </div>
            </div>
          )}
        </>
      )}

      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">{form._id ? 'Edit' : 'Add'} SME Client</h5><button className="btn-close" onClick={() => setShowModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Company Name *</label><input className="form-control" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Contact Email</label><input type="email" className="form-control" value={form.contact} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Plan</label><select className="form-select" value={form.plan} onChange={e => setForm(p => ({ ...p, plan: e.target.value }))}>{['Basic', 'Pro', 'Enterprise'].map(p => <option key={p}>{p}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label><select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>{['active', 'trial', 'inactive'].map(s => <option key={s}>{s}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveSME} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
