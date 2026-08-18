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
const EMPTY_FORM = { title: '', body: '', audience: 'Company-wide', selectedDepts: [], tag: 'General', tagColor: '#3b82f6' };
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const COMPRESSIBLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

async function compressAnnouncementImage(file) {
  if (file.size <= MAX_ATTACHMENT_BYTES || !COMPRESSIBLE_IMAGE_TYPES.has(file.type)) return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The selected image could not be compressed'));
      element.src = imageUrl;
    });
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    const largestSide = Math.max(width, height);
    if (largestSide > 2560) {
      const scale = 2560 / largestSide;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (compressed && compressed.size <= MAX_ATTACHMENT_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, '');
        return new File([compressed], `${baseName}.jpg`, { type: 'image/jpeg' });
      }
    }
    throw new Error('Image could not be compressed to 5 MB. Please choose a smaller image.');
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export default function CommunicationPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [compressingAttachment, setCompressingAttachment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role);
  const isTeamLeadOnly = user?.role === 'team_lead';

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

  const handleAttachmentChange = async (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return setAttachmentFile(null);
    if (file.size <= MAX_ATTACHMENT_BYTES) return setAttachmentFile(file);
    if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
      setAttachmentFile(null);
      event.target.value = '';
      return showToast(file.type === 'image/gif' ? 'GIF attachments must be 5 MB or smaller to preserve animation' : 'Non-image attachments must be 5 MB or smaller', 'error');
    }

    setCompressingAttachment(true);
    try {
      const compressedFile = await compressAnnouncementImage(file);
      setAttachmentFile(compressedFile);
      showToast(`Image compressed to ${(compressedFile.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) {
      setAttachmentFile(null);
      event.target.value = '';
      showToast(e.message, 'error');
    } finally {
      setCompressingAttachment(false);
    }
  };

  const handlePost = async () => {
    if (!form.title || !form.body) return showToast('Title and body are required', 'error');
    if (form.title.length > 40) return showToast('Title must be 40 characters or less', 'error');
    if (!/[a-zA-Z]/.test(form.title)) return showToast('Title must contain at least one letter', 'error');
    if (attachmentFile?.size > MAX_ATTACHMENT_BYTES) return showToast('Attachment must be 5 MB or smaller', 'error');
    setSaving(true);
    try {
      const tag = TAGS.find(t => t.label === form.tag);
      let attachment;
      if (attachmentFile) {
        setUploadingAttachment(true);
        const formData = new FormData();
        formData.append('file', attachmentFile);
        const response = await fetch('/api/announcements/upload', { method: 'POST', credentials: 'same-origin', body: formData });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Document upload failed');
        attachment = result.data;
      }
      const payload = {
        title: form.title,
        body: form.body,
        audience: form.audience,
        departments: form.selectedDepts,
        tag: form.tag,
        tagColor: tag?.color || '#3b82f6',
        ...(attachment ? { attachment } : {}),
      };
      await api.post('/api/announcements', payload);
      showToast('Announcement posted');
      setShowModal(false);
      setForm(EMPTY_FORM);
      setAttachmentFile(null);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
      setUploadingAttachment(false);
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
          <button className="btn btn-primary" onClick={() => { setForm({ ...EMPTY_FORM, audience: isTeamLeadOnly ? 'My Team' : 'Company-wide' }); setAttachmentFile(null); setShowModal(true); }}>
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
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatDate(a.createdAt)}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {a.audience === 'Company-wide' ? (
                        <span style={{ background: '#eff6ff', color: '#3b82f6', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid #dbeafe' }}>
                          <i className="bi bi-globe2 me-1" style={{ fontSize: 9 }} />Company-wide
                        </span>
                      ) : Array.isArray(a.departments) && a.departments.length > 0 ? (
                        a.departments.map(d => (
                          <span key={d} style={{ background: '#f0fdf4', color: '#16a34a', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: '1px solid #bbf7d0' }}>
                            {d}
                          </span>
                        ))
                      ) : a.audience === 'My Team' ? (
                        <span style={{ background: '#fef3c7', color: '#d97706', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid #fde68a' }}>
                          <i className="bi bi-people me-1" style={{ fontSize: 9 }} />My Team
                        </span>
                      ) : (
                        <span style={{ background: '#f1f5f9', color: '#475569', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                          {a.audience}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="badge" style={{ background: (a.tagColor || '#3b82f6') + '20', color: a.tagColor || '#3b82f6' }}>{a.tag}</span>
              </div>
              <h6 style={{ fontWeight: 700, marginBottom: 8 }}>{a.title}</h6>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.6 }}>{a.body}</p>
              {a.attachment?.url && <a href={a.attachment.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, color: '#2563eb', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}><i className="bi bi-paperclip" />{a.attachment.name || 'Open attachment'} <i className="bi bi-box-arrow-up-right" /></a>}
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
              <div className="modal-header"><h5 className="modal-title">Post Announcement</h5><button className="btn-close" onClick={() => { setShowModal(false); setAttachmentFile(null); }} /></div>
              <div className="modal-body">
                <div className="mb-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Title</label><input className="form-control" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value.slice(0, 40) }))} maxLength={40} /><div style={{ fontSize: 11, color: form.title.length >= 35 ? '#dc2626' : '#94a3b8', textAlign: 'right', marginTop: 2 }}>{form.title.length}/40</div></div>
                <div className="mb-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Message</label><textarea className="form-control" rows={4} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} /></div>
                <div className="mb-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Attachment <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label><input className="form-control" type="file" accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx" onChange={handleAttachmentChange} disabled={compressingAttachment} /><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{compressingAttachment ? 'Compressing image…' : `Images, PDF, Word, Excel, CSV, or PowerPoint up to 5 MB${attachmentFile ? ` · ${attachmentFile.name}` : ''}`}</div></div>
                <div className="row g-3">
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Audience</label>
                    {isTeamLeadOnly ? (
                      <input className="form-control" value="My Team" disabled />
                    ) : (
                        <div>
                        <button type="button" onClick={() => setForm(p => ({ ...p, audience: 'Company-wide', selectedDepts: [] }))}
                          style={{
                            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: form.audience === 'Company-wide' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                            background: form.audience === 'Company-wide' ? '#eff6ff' : '#fff',
                            color: form.audience === 'Company-wide' ? '#3b82f6' : '#64748b', marginBottom: 4,
                          }}>
                          <i className="bi bi-globe2 me-1" /> Company Wide
                        </button>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                          {form.audience === 'Company-wide' ? 'Audience: Everyone' : `Audience: Specific departments`}
                        </div>
                        {form.selectedDepts.length > 0 && (
                          <div style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, marginBottom: 4 }}>
                            Selected: {form.selectedDepts.join(', ')}
                          </div>
                        )}
                        {departments.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {departments.map(dept => {
                              const selected = form.selectedDepts.includes(dept);
                              return (
                                <button key={dept} type="button" onClick={() => {
                                  setForm(p => {
                                    const next = selected ? p.selectedDepts.filter(d => d !== dept) : [...p.selectedDepts, dept];
                                    return { ...p, selectedDepts: next, audience: next.length > 0 ? 'Departments' : 'Company-wide' };
                                  });
                                }}
                                  style={{
                                    padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                    border: selected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                                    background: selected ? '#eff6ff' : '#fff',
                                    color: selected ? '#3b82f6' : '#64748b',
                                  }}>
                                  {dept}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
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
                <button className="btn btn-outline-secondary" onClick={() => { setShowModal(false); setAttachmentFile(null); }} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={handlePost} disabled={saving || compressingAttachment}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />{uploadingAttachment ? 'Uploading attachment...' : 'Posting...'}</> : <><i className="bi bi-megaphone me-2" />Post</>}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
