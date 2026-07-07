'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';

const CATEGORY_COLORS = { Policy: '#3b82f6', Employee: '#10b981', Contract: '#8b5cf6', HR: '#f59e0b', Other: '#64748b' };
const CATEGORIES = ['Policy', 'Employee', 'Contract', 'HR', 'Other'];
const ACCESS_OPTIONS = ['all', 'admin', 'employee'];

const FILE_ICONS = {
  pdf: 'bi-file-earmark-pdf', zip: 'bi-file-earmark-zip',
  doc: 'bi-file-earmark-word', docx: 'bi-file-earmark-word',
  xls: 'bi-file-earmark-spreadsheet', xlsx: 'bi-file-earmark-spreadsheet',
  jpg: 'bi-file-earmark-image', jpeg: 'bi-file-earmark-image',
  png: 'bi-file-earmark-image', gif: 'bi-file-earmark-image',
  mp4: 'bi-file-earmark-play', mov: 'bi-file-earmark-play',
};

const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.zip,.txt,.ppt,.pptx';

function formatBytes(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb > 1024) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${kb.toFixed(1)} KB`;
}

function PreviewThumbnail({ doc }) {
  const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(doc.fileType);
  if (isImage && doc.fileUrl) {
    return <img src={doc.fileUrl} alt={doc.name} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8 }} />;
  }
  const icon = FILE_ICONS[doc.fileType] || 'bi-file-earmark';
  return <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: 8, fontSize: 48, color: CATEGORY_COLORS[doc.category] || '#94a3b8' }}><i className={`bi ${icon}`} /></div>;
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [docs, setDocs] = useState([]);
  const [trashDocs, setTrashDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [tab, setTab] = useState('active');
  const [viewMode, setViewMode] = useState('grid');
  const [currentPage, setCurrentPage] = useState(1);
  const [trashPage, setTrashPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => {
    setTrashPage(1);
  }, [tab]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTab, setUploadTab] = useState('file');
  const [form, setForm] = useState({ name: '', category: 'Policy', fileUrl: '', access: 'all', employeeId: '', expiry: '' });
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [empSearch, setEmpSearch] = useState('');
  const [empDropdownOpen, setEmpDropdownOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const fileInputRef = useRef(null);
  const empSearchRef = useRef(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const loadActive = async () => {
    setLoading(true);
    try {
      const params = filterCat ? `?category=${filterCat}` : '';
      const data = await api.get(`/api/documents${params}`);
      setDocs(Array.isArray(data?.documents) ? data.documents : []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  const loadTrash = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/documents/trash');
      setTrashDocs(Array.isArray(data?.documents) ? data.documents : []);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) { tab === 'active' ? loadActive() : loadTrash(); } }, [user, filterCat, tab]);

  useEffect(() => { setCurrentPage(1); }, [search, filterCat, tab]);

  useEffect(() => {
    const handleClick = (e) => { if (empSearchRef.current && !empSearchRef.current.contains(e.target)) setEmpDropdownOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const loadEmployees = async () => {
    try { const data = await api.get('/api/employees'); setEmployees(Array.isArray(data) ? data : []); }
    catch (e) { /* silent */ }
  };

  const filteredEmps = employees.filter(e => {
    if (!empSearch) return false;
    const q = empSearch.toLowerCase();
    return e.name?.toLowerCase().includes(q) || e.employeeNumber?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q);
  });

  const handleSelectEmployee = (emp) => {
    const empId = emp.userId || emp._id;
    setForm(p => ({ ...p, employeeId: empId }));
    setSelectedEmp(emp);
    setEmpDropdownOpen(false);
    setEmpSearch('');
  };

  const handleClearEmployee = () => {
    setForm(p => ({ ...p, employeeId: '' }));
    setSelectedEmp(null);
  };

  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  const validateAndSetFile = (file) => {
    if (!file) return;
    if (file.size > MAX_SIZE) return showToast(`File exceeds 10 MB limit (${formatBytes(file.size)})`, 'error');
    if (file.size === 0) return showToast('File is empty', 'error');
    
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = UPLOAD_ACCEPT.split(',').map(e => e.replace('.', '').toLowerCase());
    if (!allowed.includes(ext)) {
      return showToast(`File type .${ext} is not allowed`, 'error');
    }

    setSelectedFile(file);
    if (!form.name) setForm(p => ({ ...p, name: file.name.replace(/\.[^.]+$/, '') }));
  };

  const handleFileSelect = (e) => {
    validateAndSetFile(e.target.files?.[0]);
  };

  const handleUpload = async () => {
    if (uploadTab === 'file') {
      if (!selectedFile) return showToast('Please select a file', 'error');
      setUploading(true);
      setUploadProgress(0);
      try {
        // 1. Get signed upload config from server
        const config = await api.get('/api/documents/upload-auth');

        // 2. Upload directly to Cloudinary from the browser
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('api_key', config.apiKey);
        fd.append('timestamp', config.timestamp);
        fd.append('signature', config.signature);
        fd.append('folder', config.folder);

        const progressInterval = setInterval(() => setUploadProgress(p => Math.min(p + 10, 90)), 300);

        const cloudResp = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`, {
          method: 'POST',
          body: fd,
        });

        clearInterval(progressInterval);

        if (!cloudResp.ok) {
          const errText = await cloudResp.text();
          throw new Error(`Cloudinary upload failed: ${errText}`);
        }

        const cloudResult = await cloudResp.json();
        setUploadProgress(100);

        // 3. Save document metadata to our API
        await api.post('/api/documents', {
          name: form.name || selectedFile.name,
          category: form.category,
          fileUrl: cloudResult.secure_url,
          fileSize: String(cloudResult.bytes),
          fileType: cloudResult.format,
          mimeType: cloudResult.resource_type === 'image' ? `image/${cloudResult.format}` : `application/${cloudResult.format}`,
          cloudinaryPublicId: cloudResult.public_id,
          access: form.access,
          employeeId: form.employeeId || undefined,
          expiry: form.expiry || undefined,
        });

        showToast('Document uploaded');
        setTimeout(() => { setShowUpload(false); resetForm(); loadActive(); }, 400);
      } catch (e) { showToast(e.message, 'error'); }
      finally { setUploading(false); setUploadProgress(0); }
    } else {
      if (!form.name || !form.fileUrl) return showToast('Name and URL required', 'error');
      setSaving(true);
      try {
        await api.post('/api/documents', form);
        showToast('Document added');
        setShowUpload(false);
        resetForm();
        loadActive();
      } catch (e) { showToast(e.message, 'error'); }
      finally { setSaving(false); }
    }
  };

  const resetForm = () => {
    setForm({ name: '', category: 'Policy', fileUrl: '', access: 'all', employeeId: '', expiry: '' });
    setSelectedFile(null);
    setSelectedEmp(null);
    setEmpSearch('');
    setUploadProgress(0);
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/api/documents/${id}`);
      showToast('Moved to trash');
      loadActive();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleRestore = async (id) => {
    try {
      await api.post('/api/documents/trash', { action: 'restore', id });
      showToast('Document restored');
      loadTrash();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handlePermanentDelete = async (id, name) => {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone. The file will also be removed from Cloudinary.`)) return;
    try {
      await api.post('/api/documents/trash', { action: 'permanent-delete', id });
      showToast('Permanently deleted');
      loadTrash();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const isExpiringSoon = (expiry) => {
    if (!expiry) return false;
    const days = (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24);
    return days <= 30 && days > 0;
  };
  const isExpired = (expiry) => expiry && new Date(expiry) < new Date();

  const getExpiryText = (expiry) => {
    if (!expiry) return null;
    const days = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0) return `Expired ${Math.abs(days)} day(s) ago`;
    if (days === 0) return 'Expires today';
    if (days <= 30) return `Expiring in ${days} day(s)`;
    return `Exp: ${formatDate(expiry)}`;
  };
  
  const isDanger = (expiry) => {
    if (!expiry) return false;
    const days = Math.ceil((new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24));
    return days <= 30;
  };

  const filtered = docs.filter(d => !search || d.name.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
  const paginatedDocs = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const expiringSoon = docs.filter(d => isExpiringSoon(d.expiry)).length;
  const expired = docs.filter(d => isExpired(d.expiry)).length;

  return (
    <AppShell title="Documents">
      {toast && (
        <div className="toast-container-custom">
          <div className={'toast-custom ' + toast.type}>
            <i className={'bi ' + (toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle') + ' me-2'} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div><h4>Documents</h4><p>Manage policies, contracts, and employee documents</p></div>
        {isAdmin && tab === 'active' && (
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowUpload(true); loadEmployees(); }}>
            <i className="bi bi-cloud-arrow-up me-2" />Upload Document
          </button>
        )}
      </div>

      {(expiringSoon > 0 || expired > 0) && tab === 'active' && (
        <div style={{ padding: '12px 18px', borderRadius: 10, marginBottom: 16, background: expired > 0 ? '#fef2f2' : '#fffbeb', border: `1px solid ${expired > 0 ? '#fecaca' : '#fde68a'}`, display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
          {expired > 0 && <span style={{ color: '#dc2626' }}><i className="bi bi-exclamation-triangle-fill me-1" />{expired} document(s) expired</span>}
          {expiringSoon > 0 && <span style={{ color: '#d97706' }}><i className="bi bi-clock me-1" />{expiringSoon} document(s) expiring within 30 days</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'active', label: 'Documents' },
          ...(isAdmin ? [{ key: 'trash', label: `Trash${trashDocs.length ? ` (${trashDocs.length})` : ''}` }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); if (t.key === 'trash') loadTrash(); }}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            <i className={`bi ${t.key === 'trash' ? 'bi-trash' : 'bi-folder'} me-2`} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'active' && (
        <div className="card p-3 mb-3">
          <div className="row g-2">
            <div className="col-md-6">
              <div className="input-group">
                <span className="input-group-text"><i className="bi bi-search" /></span>
                <input className="form-control" placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="col-md-3">
              <select className="form-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">All Categories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-md-3 d-flex justify-content-end align-items-center">
              <div className="btn-group" role="group" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                <button type="button" className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-secondary'}`} style={{ padding: '6px 16px' }} onClick={() => setViewMode('grid')}>
                  <i className="bi bi-grid-fill" />
                </button>
                <button type="button" className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`} style={{ padding: '6px 16px' }} onClick={() => setViewMode('list')}>
                  <i className="bi bi-list-ul" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'trash' ? (
        <div className="card p-4">
          <div className="section-title mb-3">Trash <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>— Documents are auto-deleted after 30 days</span></div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner-border text-primary spinner-border-sm" /></div>
          ) : trashDocs.length === 0 ? (
            <div className="empty-state"><i className="bi bi-trash" /><h6>Trash is empty</h6></div>
          ) : (
            <>
              <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr><th>Name</th><th>Category</th><th>Deleted</th><th>Auto-delete in</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {trashDocs.slice((trashPage - 1) * itemsPerPage, trashPage * itemsPerPage).map(d => {
                    const daysLeft = d.deletedAt ? 30 - Math.floor((Date.now() - new Date(d.deletedAt)) / (1000 * 60 * 60 * 24)) : 30;
                    return (
                      <tr key={d._id}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>
                          <i className={`${FILE_ICONS[d.fileType] || 'bi-file-earmark'} me-2`} />
                          {d.name}
                        </td>
                        <td><span className="badge" style={{ background: CATEGORY_COLORS[d.category] || '#e2e8f0', color: '#fff' }}>{d.category}</span></td>
                        <td style={{ fontSize: 13 }}>{d.deletedAt ? formatDate(d.deletedAt) : '—'}</td>
                        <td>
                          <span style={{ color: daysLeft <= 7 ? '#dc2626' : '#64748b', fontWeight: daysLeft <= 7 ? 600 : 400, fontSize: 13 }}>
                            {daysLeft > 0 ? `${daysLeft} day(s)` : 'Any time'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-outline-success" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handleRestore(d._id)}>
                              <i className="bi bi-arrow-return-left me-1" />Restore
                            </button>
                            <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => handlePermanentDelete(d._id, d.name)}>
                              <i className="bi bi-trash-fill me-1" />Delete Forever
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {trashDocs.length > 0 && (
              <div className="mt-3">
                <Pagination
                  currentPage={trashPage}
                  totalPages={Math.ceil(trashDocs.length / itemsPerPage)}
                  onPageChange={setTrashPage}
                  totalItems={trashDocs.length}
                  pageSize={itemsPerPage}
                />
              </div>
            )}
          </>
          )}
        </div>
      ) : (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="card">
              <div className="empty-state"><i className="bi bi-folder2-open" /><h6>No documents found</h6></div>
            </div>
          ) : (
            <>
              {viewMode === 'grid' ? (
                <div className="row g-3 mb-4">
                  {paginatedDocs.map(d => {
                const expiring = isExpiringSoon(d.expiry);
                const expiredDoc = isExpired(d.expiry);
                return (
                  <div key={d._id} className="col-md-6 col-lg-4">
                    <div className="card" style={{ overflow: 'hidden' }}>
                      <PreviewThumbnail doc={d} />
                      <div style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</div>
                          </div>
                          {isAdmin && (
                            <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 11, padding: '2px 6px', marginLeft: 8, flexShrink: 0 }} onClick={() => handleDelete(d._id)} title="Move to trash">
                              <i className="bi bi-trash" />
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                          <span className="badge" style={{ background: CATEGORY_COLORS[d.category] || '#e2e8f0', color: '#fff', fontSize: 10 }}>{d.category}</span>
                          <span className="badge" style={{ background: '#f1f5f9', color: '#475569', fontSize: 10 }}>{d.fileType?.toUpperCase() || 'FILE'}</span>
                          {d.fileSize && <span className="badge" style={{ background: '#f1f5f9', color: '#475569', fontSize: 10 }}>{formatBytes(d.fileSize)}</span>}
                          {d.access === 'admin' && <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 10 }}>Admin</span>}
                          {expiredDoc && <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: 10 }}>Expired</span>}
                          {expiring && <span className="badge" style={{ background: '#fffbeb', color: '#d97706', fontSize: 10 }}>Expiring</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
                          {d.uploadedBy?.name && <span><i className="bi bi-upload me-1" />{d.uploadedBy.name}</span>}
                          {d.employeeId?.name && <span style={{ marginLeft: 12 }}><i className="bi bi-person me-1" />{d.employeeId.name}</span>}
                          {d.expiry && (
                            <span style={{ marginLeft: 12, color: isDanger(d.expiry) ? '#dc2626' : 'inherit', fontWeight: isDanger(d.expiry) ? 600 : 'normal' }}>
                              <i className="bi bi-calendar me-1" />{getExpiryText(d.expiry)}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '4px 10px', flex: 1, textAlign: 'center' }}>
                            <i className="bi bi-eye me-1" />View
                          </a>
                          <a href={d.fileUrl} download className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11, padding: '4px 10px', flex: 1, textAlign: 'center' }}>
                            <i className="bi bi-download me-1" />Download
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
                </div>
              ) : (
                <div className="card mb-4" style={{ overflow: 'hidden' }}>
                  <div className="table-responsive">
                    <table className="table mb-0 align-middle">
                      <thead className="table-light">
                        <tr>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Details</th>
                          <th>Uploaded By</th>
                          <th className="text-end">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedDocs.map(d => {
                          const expiring = isExpiringSoon(d.expiry);
                          const expiredDoc = isExpired(d.expiry);
                          return (
                            <tr key={d._id}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: CATEGORY_COLORS[d.category] || '#94a3b8', fontSize: 20 }}>
                                    <i className={`bi ${FILE_ICONS[d.fileType] || 'bi-file-earmark'}`} />
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>{d.name}</div>
                                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                      {d.access === 'admin' && <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 9 }}>Admin</span>}
                                      {expiredDoc && <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: 9 }}>Expired</span>}
                                      {expiring && <span className="badge" style={{ background: '#fffbeb', color: '#d97706', fontSize: 9 }}>Expiring</span>}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td><span className="badge" style={{ background: CATEGORY_COLORS[d.category] || '#e2e8f0', color: '#fff', fontSize: 11 }}>{d.category}</span></td>
                              <td>
                                <div style={{ fontSize: 12, color: '#64748b' }}>
                                  <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{d.fileType || 'FILE'}</span>
                                  {d.fileSize && <span> • {formatBytes(d.fileSize)}</span>}
                                </div>
                                {d.expiry && (
                                  <div style={{ fontSize: 11, color: isDanger(d.expiry) ? '#dc2626' : '#94a3b8', marginTop: 2, fontWeight: isDanger(d.expiry) ? 600 : 'normal' }}>
                                    <i className="bi bi-calendar me-1" />{getExpiryText(d.expiry)}
                                  </div>
                                )}
                              </td>
                              <td>
                                <div style={{ fontSize: 12, color: '#475569' }}>
                                  {d.uploadedBy?.name && <div><i className="bi bi-upload me-1" />{d.uploadedBy.name}</div>}
                                  {d.employeeId?.name && <div style={{ marginTop: 2 }}><i className="bi bi-person me-1" />{d.employeeId.name}</div>}
                                </div>
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                  <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary" style={{ padding: '4px 8px' }} title="View">
                                    <i className="bi bi-eye" />
                                  </a>
                                  <a href={d.fileUrl} download className="btn btn-sm btn-outline-secondary" style={{ padding: '4px 8px' }} title="Download">
                                    <i className="bi bi-download" />
                                  </a>
                                  {isAdmin && (
                                    <button className="btn btn-sm btn-outline-danger" style={{ padding: '4px 8px' }} onClick={() => handleDelete(d._id)} title="Move to trash">
                                      <i className="bi bi-trash" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              {filtered.length > 0 && (
                <div className="mt-3">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={Math.ceil(filtered.length / itemsPerPage)}
                    onPageChange={setCurrentPage}
                    totalItems={filtered.length}
                    pageSize={itemsPerPage}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Upload Document</h5>
                <button className="btn-close" onClick={() => { setShowUpload(false); resetForm(); }} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 8, padding: 3, width: 'fit-content' }}>
                  <button onClick={() => setUploadTab('file')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: uploadTab === 'file' ? '#fff' : 'transparent', color: uploadTab === 'file' ? '#1e293b' : '#64748b', boxShadow: uploadTab === 'file' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                    <i className="bi bi-cloud-upload me-1" />Upload File
                  </button>
                  <button onClick={() => setUploadTab('url')} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: uploadTab === 'url' ? '#fff' : 'transparent', color: uploadTab === 'url' ? '#1e293b' : '#64748b', boxShadow: uploadTab === 'url' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                    <i className="bi bi-link me-1" />Paste URL
                  </button>
                </div>

                {uploadTab === 'file' ? (
                  <div>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragEnter={e => e.preventDefault()}
                      onDragLeave={e => e.preventDefault()}
                      onDragOver={e => {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                      }}
                      onDrop={e => {
                        e.preventDefault();
                        if (e.dataTransfer?.files?.length) {
                          validateAndSetFile(e.dataTransfer.files[0]);
                        }
                      }}
                      style={{ border: `2px dashed ${selectedFile ? '#3b82f6' : '#e2e8f0'}`, borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer', background: selectedFile ? '#f0f7ff' : '#fafafa', transition: 'all 0.2s', marginBottom: 16 }}
                      onMouseEnter={e => { if (!selectedFile) e.currentTarget.style.borderColor = '#3b82f6'; }}
                      onMouseLeave={e => { if (!selectedFile) e.currentTarget.style.borderColor = '#e2e8f0'; }}>
                      {selectedFile ? (
                        <div>
                          <i className="bi bi-file-earmark-check" style={{ fontSize: 36, color: '#3b82f6' }} />
                          <div style={{ fontWeight: 600, marginTop: 8, fontSize: 14 }}>{selectedFile.name}</div>
                          <div style={{ fontSize: 12, color: '#64748b' }}>{formatBytes(selectedFile.size)}</div>
                          <button className="btn btn-sm btn-outline-secondary mt-2" onClick={e => { e.stopPropagation(); setSelectedFile(null); }}>
                            <i className="bi bi-x me-1" />Remove
                          </button>
                        </div>
                      ) : (
                        <div>
                          <i className="bi bi-cloud-upload" style={{ fontSize: 40, color: '#94a3b8' }} />
                          <div style={{ fontWeight: 600, marginTop: 8, fontSize: 14, color: '#475569' }}>Drop a file here or click to browse</div>
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>PDF, Word, Excel, Images, ZIP — max 10MB</div>
                        </div>
                      )}
                      <input ref={fileInputRef} type="file" accept={UPLOAD_ACCEPT} style={{ display: 'none' }} onChange={handleFileSelect} />
                    </div>

                    {uploadProgress > 0 && (
                      <div className="progress mb-3" style={{ height: 6 }}>
                        <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mb-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>File URL</label>
                    <input className="form-control" placeholder="https://example.com/document.pdf" value={form.fileUrl} onChange={e => setForm(p => ({ ...p, fileUrl: e.target.value }))} />
                  </div>
                )}

                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Document Name *</label>
                    <input className="form-control" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter document name" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category</label>
                    <select className="form-select" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Access</label>
                    <select className="form-select" value={form.access} onChange={e => setForm(p => ({ ...p, access: e.target.value }))}>
                      {ACCESS_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Expiry Date</label>
                    <input type="date" className="form-control" value={form.expiry} onChange={e => setForm(p => ({ ...p, expiry: e.target.value }))} />
                  </div>
                  <div className="col-md-6" ref={empSearchRef} style={{ position: 'relative' }}>
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employee (if employee-specific)</label>
                    {selectedEmp ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc' }}>
                        <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#3b82f6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                          {selectedEmp.name?.slice(0, 2).toUpperCase()}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedEmp.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{selectedEmp.employeeNumber} · {selectedEmp.department}</div>
                        </div>
                        <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11, padding: '2px 6px' }} onClick={handleClearEmployee}>
                          <i className="bi bi-x" />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <input className="form-control" placeholder="Search employee by name, ID or department..." value={empSearch}
                          onChange={e => { setEmpSearch(e.target.value); setEmpDropdownOpen(true); }}
                          onFocus={() => { if (empSearch) setEmpDropdownOpen(true); }} />
                        {empDropdownOpen && filteredEmps.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                            {filteredEmps.map(emp => {
                              const empId = emp.userId || emp._id;
                              return (
                                <div key={empId} onClick={() => handleSelectEmployee(emp)}
                                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}
                                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                  <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#e2e8f0', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                                    {emp.name?.slice(0, 2).toUpperCase()}
                                  </span>
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
                                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.employeeNumber} · {emp.department || '—'}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {empDropdownOpen && empSearch && filteredEmps.length === 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '12px 16px', fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                            No employees found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => { setShowUpload(false); resetForm(); }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleUpload} disabled={uploading || saving}>
                  {uploading ? <><span className="spinner-border spinner-border-sm me-2" />Uploading ({uploadProgress}%)...</> :
                   saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> :
                   <><i className={`bi ${uploadTab === 'file' ? 'bi-cloud-upload' : 'bi-link'} me-2`} />{uploadTab === 'file' ? 'Upload' : 'Add Document'}</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
