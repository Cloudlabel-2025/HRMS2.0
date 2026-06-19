'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const TAGS = [
  { label: 'General', color: '#3b82f6' }, { label: 'Holiday', color: '#ef4444' },
  { label: 'HR', color: '#8b5cf6' }, { label: 'Policy', color: '#06b6d4' },
  { label: 'Team', color: '#10b981' }, { label: 'Payroll', color: '#f59e0b' },
];
const EMPTY_FORM = { title: '', body: '', audience: 'Company-wide', tag: 'General', tagColor: '#3b82f6' };

export default function CommunicationPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [tab, setTab] = useState('announcements');
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role);
  const isTeamLeadOnly = user?.role === 'team_lead';
  const audienceOptions = isTeamLeadOnly
    ? ['My Team']
    : ['Company-wide', ...departments];

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/announcements');
      setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const data = await api.get('/api/settings?type=departments');
      setDepartments(Array.isArray(data) ? data.map(d => d.name) : []);
    } catch (e) {
      console.warn('Failed to load departments:', e);
    }
  };

  useEffect(() => { if (user) { load(); if (isAdmin) loadDepartments(); } }, [user]);

  const handlePost = async () => {
    if (!form.title || !form.body) return showToast('Title and body are required', 'error');
    if (form.title.length > 40) return showToast('Title must be 40 characters or less', 'error');
    if (!/[a-zA-Z]/.test(form.title)) return showToast('Title must contain at least one letter', 'error');
    setSaving(true);
    try {
      const tag = TAGS.find(t => t.label === form.tag);
      await api.post('/api/announcements', { ...form, tagColor: tag?.color || '#3b82f6' });
      showToast('Announcement posted');
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleLike = async (id) => {
    try {
      const res = await api.put(`/api/announcements/${id}`, { action: 'like' });
      setAnnouncements(prev => prev.map(a => a._id === id ? { ...a, likes: Array(res.likes).fill(null) } : a));
    } catch {}
  };

  return (
    <AppShell title="Announcements">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Announcements & Notifications</h4><p>Company-wide and department-specific communications</p></div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => { setForm(p => ({ ...p, audience: isTeamLeadOnly ? 'My Team' : 'Company-wide' })); setShowModal(true); }}>
            <i className="bi bi-megaphone me-2" />Post Announcement
          </button>
        )}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {announcements.length === 0 && (
            <div className="empty-state"><i className="bi bi-megaphone" /><h6>No announcements yet</h6></div>
          )}
          {announcements.map(a => (
            <div key={a._id} className="card p-4" style={{ border: a.pinned ? '1px solid #3b82f640' : '' }}>
              {a.pinned && <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}><i className="bi bi-pin-angle-fill" />PINNED</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>{a.author?.avatar || a.author?.name?.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{a.author?.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatDate(a.createdAt)} · {a.audience}</div>
                  </div>
                </div>
                <span className="badge" style={{ background: (a.tagColor || '#3b82f6') + '20', color: a.tagColor || '#3b82f6' }}>{a.tag}</span>
              </div>
              <h6 style={{ fontWeight: 700, marginBottom: 8 }}>{a.title}</h6>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.6 }}>{a.body}</p>
              <div style={{ display: 'flex', gap: 12, marginTop: 14, paddingTop: 12, borderTop: '1px solid #f8fafc' }}>
                <button style={{ background: 'none', border: 'none', fontSize: 12, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => handleLike(a._id)}>
                  <i className="bi bi-hand-thumbs-up" />{a.likes?.length || 0} Likes
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Post Announcement</h5><button className="btn-close" onClick={() => setShowModal(false)} /></div>
              <div className="modal-body">
                <div className="mb-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Title</label><input className="form-control" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value.slice(0, 40) }))} maxLength={40} /><div style={{ fontSize: 11, color: form.title.length >= 35 ? '#dc2626' : '#94a3b8', textAlign: 'right', marginTop: 2 }}>{form.title.length}/40</div></div>
                <div className="mb-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Message</label><textarea className="form-control" rows={4} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} /></div>
                <div className="row g-3">
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Audience</label>
                    <select className="form-select" value={form.audience} onChange={e => setForm(p => ({ ...p, audience: e.target.value }))} disabled={isTeamLeadOnly}>
                      {audienceOptions.map(a => <option key={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Tag</label>
                    <select className="form-select" value={form.tag} onChange={e => setForm(p => ({ ...p, tag: e.target.value }))}>
                      {TAGS.map(t => <option key={t.label}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handlePost} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Posting...</> : <><i className="bi bi-megaphone me-2" />Post</>}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
