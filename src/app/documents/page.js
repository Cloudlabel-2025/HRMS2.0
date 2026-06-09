'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const CATEGORY_COLORS = { Policy: '#3b82f6', Employee: '#10b981', Contract: '#8b5cf6', HR: '#f59e0b', Other: '#64748b' };
const TYPE_ICONS = { pdf: 'bi-file-earmark-pdf', zip: 'bi-file-earmark-zip', doc: 'bi-file-earmark-word', docx: 'bi-file-earmark-word' };
const EMPTY_FORM = { name: '', category: 'Policy', fileUrl: '', fileSize: '', fileType: 'pdf', access: 'all', expiry: '' };

export default function DocumentsPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const params = filterCat ? `?category=${filterCat}` : '';
      const data = await api.get(`/api/documents${params}`);
      setDocs(Array.isArray(data?.documents) ? data.documents : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user, filterCat]);

  const handleUpload = async () => {
    if (!form.name || !form.fileUrl) return showToast('Name and file URL required', 'error');
    setSaving(true);
    try {
      await api.post('/api/documents', { ...form, expiry: form.expiry || null });
      showToast('Document uploaded');
      setShowUpload(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const isExpiringSoon = (expiry) => {
    if (!expiry) return false;
    const days = (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24);
    return days <= 30 && days > 0;
  };
  const isExpired = (expiry) => expiry && new Date(expiry) < new Date();

  const filtered = docs.filter(d =>
    !search || d.name.toLowerCase().includes(search.toLowerCase())
  );

  const expiringSoon = docs.filter(d => isExpiringSoon(d.expiry)).length;
  const expired = docs.filter(d => isExpired(d.expiry)).length;

  return (
    <AppShell title="Documents">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Document Management</h4><p>{filtered.length} documents · {expiringSoon} expiring soon</p></div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            <i className="bi bi-upload me-2" />Upload Document
          </button>
        )}
      </div>

      {(expiringSoon > 0 || expired > 0) && (
        <div className="alert d-flex align-items-center gap-2 mb-3" style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 10, fontSize: 13 }}>
          <i className="bi bi-exclamation-triangle text-warning" />
          <span><strong>{expiringSoon} document(s)</strong> expiring within 30 days. <strong>{expired}</strong> already expired.</span>
        </div>
      )}

      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-5">
            <div style={{ position: 'relative' }}>
              <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13 }} />
              <input className="form-control" placeholder="Search documents..." style={{ paddingLeft: 32, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="col-md-3">
            <select className="form-select" style={{ fontSize: 13 }} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">All Categories</option>
              {['Policy', 'Employee', 'Contract', 'HR', 'Other'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div className="row g-3">
          {filtered.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-folder2-open" /><h6>No documents found</h6></div></div>}
          {filtered.map(doc => (
            <div key={doc._id} className="col-md-6 col-xl-4">
              <div className="card p-3" style={{ border: isExpired(doc.expiry) ? '1px solid #fca5a5' : isExpiringSoon(doc.expiry) ? '1px solid #fde68a' : '' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className={`bi ${TYPE_ICONS[doc.fileType] || 'bi-file-earmark'}`} style={{ color: '#ef4444', fontSize: 20 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.name}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span className="badge" style={{ background: (CATEGORY_COLORS[doc.category] || '#64748b') + '20', color: CATEGORY_COLORS[doc.category] || '#64748b', fontSize: 10 }}>{doc.category}</span>
                      {isExpired(doc.expiry) && <span className="badge status-rejected" style={{ fontSize: 10 }}>Expired</span>}
                      {isExpiringSoon(doc.expiry) && <span className="badge status-pending" style={{ fontSize: 10 }}>Expiring Soon</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>By {doc.uploadedBy?.name || '—'} · {formatDate(doc.createdAt)}{doc.fileSize ? ` · ${doc.fileSize}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {doc.fileUrl && (
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, flex: 1 }}>
                      <i className="bi bi-eye me-1" />View
                    </a>
                  )}
                  {doc.fileUrl && (
                    <a href={doc.fileUrl} download className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11, flex: 1 }}>
                      <i className="bi bi-download me-1" />Download
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Upload Document</h5><button className="btn-close" onClick={() => setShowUpload(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Document Name *</label><input className="form-control" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>File URL *</label><input className="form-control" placeholder="https://..." value={form.fileUrl} onChange={e => setForm(p => ({ ...p, fileUrl: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category</label><select className="form-select" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>{['Policy', 'Employee', 'Contract', 'HR', 'Other'].map(c => <option key={c}>{c}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>File Type</label><select className="form-select" value={form.fileType} onChange={e => setForm(p => ({ ...p, fileType: e.target.value }))}>{['pdf', 'doc', 'docx', 'zip', 'other'].map(t => <option key={t}>{t}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Access Level</label><select className="form-select" value={form.access} onChange={e => setForm(p => ({ ...p, access: e.target.value }))}><option value="all">All Employees</option><option value="admin">Admin Only</option><option value="employee">Specific Employee</option></select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Expiry Date</label><input type="date" className="form-control" value={form.expiry} onChange={e => setForm(p => ({ ...p, expiry: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>File Size</label><input className="form-control" placeholder="e.g. 2.4 MB" value={form.fileSize} onChange={e => setForm(p => ({ ...p, fileSize: e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowUpload(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleUpload} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Uploading...</> : 'Upload'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
