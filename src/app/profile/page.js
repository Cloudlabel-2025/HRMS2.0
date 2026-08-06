'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';
import Time from '@/components/Time';
import { formatMins } from '@/lib/format';
import { STATUS_STYLE, WP_STATUS_STYLE } from '@/lib/constants';
import { triggerDownload } from '@/lib/csv-utils';
import { isBreakType, breakStyle } from '@/lib/attendance-breaks';
import { formatTaskDuration } from '@/lib/attendance-constants';

const TABS = [
  { key: 'overview',     label: 'Overview',      icon: 'bi-person-lines-fill' },
  { key: 'personal',     label: 'Personal Info',  icon: 'bi-card-personal' },
  { key: 'attendance',   label: 'Attendance',     icon: 'bi-clock-history' },
  { key: 'workprogress', label: 'Daily Work Sheet', icon: 'bi-list-check' },
  { key: 'assets',       label: 'Assets & Docs',  icon: 'bi-box-seam' },
  { key: 'payroll',      label: 'Payroll',        icon: 'bi-cash-stack' },
  { key: 'audit',        label: 'Audit Log',      icon: 'bi-shield-check' },
];

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const SEV_COLOR = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };
const SEV_BG    = { low: '#f0fdf4', medium: '#fffbeb', high: '#fef2f2' };

function InfoRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.margin = '0 -10px'; e.currentTarget.style.padding = '10px 10px'; e.currentTarget.style.borderRadius = '8px'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.margin = '0'; e.currentTarget.style.padding = '10px 0'; e.currentTarget.style.borderRadius = '0'; }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f615, #8b5cf608)', border: '1px solid #3b82f610', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 14 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', marginTop: 2, textTransform: 'capitalize' }}>{value}</div>
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children, iconColor, iconBg }) {
  return (
    <div className="card" style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 16, border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: iconBg || 'linear-gradient(135deg, #3b82f615, #8b5cf608)', border: '1px solid #3b82f610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className={`bi ${icon}`} style={{ color: iconColor || '#3b82f6', fontSize: 15 }} />
        </div>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>{title}</span>
      </div>
      <div style={{ padding: '4px 20px 14px' }}>{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { formatDate, formatDateTime, formatTime } = useSettings();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');

  const [salaryStructure, setSalaryStructure] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [wpCycles, setWpCycles] = useState([]);
  const [wpLoading, setWpLoading] = useState(false);
  const [expandedCycle, setExpandedCycle] = useState(null);
  const [expandedDate, setExpandedDate] = useState(null);
  const [filterFromMonth, setFilterFromMonth] = useState('');
  const [filterToMonth, setFilterToMonth] = useState('');
  const [filterFromDate, setFilterFromDate] = useState('');
  const [filterToDate, setFilterToDate] = useState('');
  const [showTimer, setShowTimer] = useState(false);
  const [downloadRemaining, setDownloadRemaining] = useState(0);
  const timerRef = useRef(null);

  const [showPhotoActions, setShowPhotoActions] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.get('/api/profile/details').catch(() => null),
      api.get('/api/payroll/structure').catch(() => null),
    ]).then(([details, structure]) => {
      setData(details);
      const own = Array.isArray(structure)
        ? structure.find(s => String(s.userId?._id || s.userId) === String(user._id)) || null
        : structure;
      setSalaryStructure(own);
    }).finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    if (tab === 'workprogress' && data?.employee?._id && wpCycles.length === 0 && !wpLoading) {
      setWpLoading(true);
      api.get(`/api/employees/${data.employee._id}/work-progress`)
        .then(setWpCycles)
        .catch(() => {})
        .finally(() => setWpLoading(false));
    }
  }, [tab, data]);

  useEffect(() => {
    if (tab === 'audit' && auditLogs.length === 0 && !auditLoading) {
      setAuditLoading(true);
      api.get('/api/audit?scope=my')
        .then(d => setAuditLogs(Array.isArray(d.logs) ? d.logs : []))
        .catch(() => {})
        .finally(() => setAuditLoading(false));
    }
  }, [tab]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const compressProfilePhoto = async (file) => {
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('This image could not be processed.'));
        element.src = sourceUrl;
      });
      let width = image.naturalWidth;
      let height = image.naturalHeight;
      const initialScale = Math.min(1, 2400 / Math.max(width, height));
      width = Math.max(1, Math.round(width * initialScale));
      height = Math.max(1, Math.round(height * initialScale));
      let quality = 0.9;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0, width, height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('Unable to compress this image.');
        if (blob.size <= 4.75 * 1024 * 1024) {
          const name = `${file.name.replace(/\.[^.]+$/, '') || 'profile-photo'}.jpg`;
          return new File([blob], name, { type: 'image/jpeg' });
        }
        quality = Math.max(0.55, quality - 0.1);
        if (attempt >= 3) {
          width = Math.max(1, Math.round(width * 0.8));
          height = Math.max(1, Math.round(height * 0.8));
        }
      }
      throw new Error('The image could not be compressed below 5 MB.');
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  };

  const uploadProfilePhoto = async (event) => {
    const photo = event.target.files?.[0];
    event.target.value = '';
    if (!photo) return;
    setShowPhotoActions(false);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) return setPhotoError('Choose a JPG, PNG, or WebP image.');
    setPhotoError('');
    setUploadingPhoto(true);
    try {
      const compressedPhoto = await compressProfilePhoto(photo);
      const formData = new FormData();
      formData.append('photo', compressedPhoto);
      const response = await fetch('/api/profile/avatar', { method: 'POST', credentials: 'same-origin', body: formData });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to upload profile photo');
      window.location.reload();
    } catch (error) {
      setPhotoError(error.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removeProfilePhoto = async () => {
    setPhotoError('');
    setUploadingPhoto(true);
    try {
      const response = await fetch('/api/profile/avatar', { method: 'DELETE', credentials: 'same-origin' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Unable to remove profile photo');
      window.location.reload();
    } catch (error) {
      setPhotoError(error.message);
    } finally {
      setUploadingPhoto(false);
      setShowPhotoActions(false);
    }
  };

  const toggleCycle = (key) => {
    setExpandedCycle(prev => prev === key ? null : key);
    setExpandedDate(null);
  };
  const toggleDate = (dateId) => {
    setExpandedDate(prev => prev === dateId ? null : dateId);
  };
  const resetWpFilters = () => {
    setFilterFromMonth('');
    setFilterToMonth('');
    setFilterFromDate('');
    setFilterToDate('');
  };
  const wpMonthOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    for (const cycle of wpCycles) {
      if (!seen.has(cycle.key)) { seen.add(cycle.key); opts.push({ key: cycle.key, label: cycle.label }); }
    }
    return opts;
  }, [wpCycles]);
  const filteredCycles = useMemo(() => {
    let filtered = wpCycles;
    if (filterFromMonth) filtered = filtered.filter(c => c.key >= filterFromMonth);
    if (filterToMonth) filtered = filtered.filter(c => c.key <= filterToMonth);
    if (filterFromDate || filterToDate) {
      filtered = filtered.map(c => {
        const dates = c.dates.filter(d => {
          if (filterFromDate && d.date < filterFromDate) return false;
          if (filterToDate && d.date > filterToDate) return false;
          return true;
        });
        return { ...c, dates };
      }).filter(c => c.dates.length > 0);
    }
    return filtered;
  }, [wpCycles, filterFromMonth, filterToMonth, filterFromDate, filterToDate]);
  const totalEntryCount = useMemo(() => {
    let count = 0;
    for (const c of filteredCycles) for (const d of c.dates) count += d.workProgress?.length || 0;
    return count;
  }, [filteredCycles]);
  const toCsvRows = (cycles) => {
    const rows = [['Cycle', 'Date', 'Status', 'Clock In', 'Clock Out', 'Hours', '#', 'Type', 'Task Details', 'Start Time', 'End Time', 'Task Status', 'Remarks', 'Feedback']];
    for (const cycle of cycles) {
      for (const d of cycle.dates) {
        if (!d.workProgress?.length) { rows.push([cycle.label, d.date, d.status, formatTime(d.clockIn) || '', formatTime(d.clockOut) || '', formatMins(d.hoursWorked), '', '', '', '', '', '', '', '']); continue; }
        for (let i = 0; i < d.workProgress.length; i++) {
          const wp = d.workProgress[i];
          rows.push([cycle.label, d.date, d.status, formatTime(d.clockIn) || '', formatTime(d.clockOut) || '', formatMins(d.hoursWorked), String(i + 1), wp.type || 'task', wp.taskDetails || '', formatTime(wp.startTime) || '', formatTime(wp.endTime) || '', wp.status || '', wp.remarks || '', wp.feedback || '']);
        }
      }
    }
    return rows;
  };
  const handleWpDownload = () => {
    const rows = toCsvRows(filteredCycles);
    const entryCount = rows.length - 1;
    if (entryCount <= 5) { triggerDownload(rows, `work_progress_${data?.employee?.name || 'export'}.csv`); return; }
    if (timerRef.current) clearInterval(timerRef.current);
    setDownloadRemaining(1800);
    setShowTimer(true);
    timerRef.current = setInterval(() => {
      setDownloadRemaining(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); timerRef.current = null; triggerDownload(rows, `work_progress_${data?.employee?.name || 'export'}.csv`); return 0; }
        return prev - 1;
      });
    }, 1000);
  };
  const closeTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setShowTimer(false); setDownloadRemaining(0);
  };

  if (loading) return (
    <AppShell title="My Profile">
      <div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  if (!data?.employee) return (
    <AppShell title="My Profile">
      <div className="alert alert-danger m-4">Employee record not found. Contact your administrator.</div>
    </AppShell>
  );

  const emp = data.employee;
  const identity = data.identity;
  const profile = data.profile;
  const photoUrl = user?.profilePhoto || user?.avatar || '';
  const initials = (emp.name || user?.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const roleColor = ROLE_COLORS[emp.role] || '#3b82f6';

  const visibleTabs = TABS.filter(t => {
    if (t.key === 'payroll' && !data.payslips?.length && !salaryStructure) return false;
    return true;
  });

  const statusColor = emp.status === 'active' ? '#10b981' : emp.status === 'inactive' ? '#ef4444' : '#64748b';
  const statusBg = emp.status === 'active' ? '#dcfce7' : emp.status === 'inactive' ? '#fee2e2' : '#f1f5f9';

  return (
    <AppShell title="My Profile">
      {/* Hero Banner */}
      <div className="card mb-4" style={{ borderRadius: 16, overflow: 'hidden', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
        <div style={{ height: 80, background: `linear-gradient(135deg, ${roleColor} 0%, #1e293b 100%)`, position: 'relative' }}>
          <div style={{ position: 'absolute', top: -20, right: 20, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
          <div style={{ position: 'absolute', bottom: -30, left: '25%', width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        </div>
        <div style={{ padding: '20px 28px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ width: 88, height: 88, borderRadius: 20, background: '#fff', padding: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', flexShrink: 0, position: 'relative' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 17, background: `linear-gradient(135deg, ${roleColor}, #6366f1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: 1, overflow: 'hidden' }}>
                {photoUrl ? <img src={photoUrl} alt={`${emp.name}'s profile`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : initials}
              </div>
              <button type="button" aria-label="Change profile photo" onClick={() => setShowPhotoActions(v => !v)} disabled={uploadingPhoto}
                style={{ position: 'absolute', right: -8, bottom: -8, width: 30, height: 30, borderRadius: '50%', border: '3px solid #fff', background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.35)', zIndex: 2 }}>
                <i className="bi bi-pencil-fill" style={{ fontSize: 11 }} />
              </button>
            </div>
            <div style={{ paddingTop: 4 }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 24, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.2 }}>{emp.name}</h2>
              <div style={{ fontSize: 14, color: '#475569', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: '#1e293b' }}>{emp.designation || 'No Designation'}</span>
                {emp.department && (
                  <>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                    <span style={{ color: '#64748b' }}>{emp.department}</span>
                  </>
                )}
              </div>
              {profile?.employeeNumber && (
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <i className="bi bi-tag" style={{ fontSize: 11, color: '#94a3b8' }} />
                  {profile.employeeNumber}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                <span className="badge" style={{ background: statusBg, color: statusColor, fontSize: 10.5, padding: '4px 10px', borderRadius: 999 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor, display: 'inline-block', marginRight: 5 }} />
                  {(emp.status || 'active').toUpperCase()}
                </span>
                <span className="badge" style={{ background: roleColor + '15', color: roleColor, fontSize: 10.5, padding: '4px 10px', borderRadius: 999 }}>
                  {ROLE_LABELS[emp.role] || emp.role}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '0 28px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
          {[
            { icon: 'bi-envelope', val: emp.email, label: 'Email' },
            { icon: 'bi-telephone', val: emp.phone, label: 'Phone' },
            { icon: 'bi-calendar2', val: emp.joinDate ? `Joined ${formatDate(emp.joinDate)}` : null, label: 'Joined' },
            { icon: 'bi-clock', val: emp.shift, label: 'Shift' },
            { icon: 'bi-geo-alt', val: profile?.workLocation, label: 'Location' },
          ].filter(i => i.val).map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f8fafc', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={`bi ${item.icon}`} style={{ color: '#3b82f6', fontSize: 12 }} />
              </div>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3, lineHeight: 1 }}>{item.label}</div>
                <div style={{ fontWeight: 600, color: '#1e293b', marginTop: 1, lineHeight: 1.3, fontSize: 12.5 }}>{item.val}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadProfilePhoto} style={{ display: 'none' }} />
      {photoError && <div style={{ marginBottom: 12, fontSize: 12, color: '#dc2626' }}>{photoError}</div>}

      {showPhotoActions && (
        <div onClick={() => setShowPhotoActions(false)} style={{ position: 'fixed', inset: 0, zIndex: 1055, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(15,23,42,0.48)', backdropFilter: 'blur(3px)' }}>
          <div onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 360px)', overflow: 'hidden', borderRadius: 18, background: '#fff', boxShadow: '0 24px 56px rgba(15,23,42,0.28)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid #eef2f7' }}>
              <div>
                <div style={{ color: '#0f172a', fontSize: 17, fontWeight: 750 }}>Profile photo</div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>Keep your profile recognisable to your team.</div>
              </div>
              <button type="button" aria-label="Close photo options" onClick={() => setShowPhotoActions(false)} style={{ width: 30, height: 30, border: 'none', borderRadius: 8, background: '#f1f5f9', color: '#64748b', cursor: 'pointer' }}><i className="bi bi-x-lg" /></button>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '16px 20px', background: '#f8fafc' }}>
              <div style={{ width: 48, height: 48, flexShrink: 0, overflow: 'hidden', borderRadius: 14, background: `linear-gradient(135deg, ${roleColor}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800 }}>
                {photoUrl ? <img src={photoUrl} alt="Current profile" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : initials}
              </div>
              <div><div style={{ color: '#1e293b', fontSize: 13, fontWeight: 700 }}>{emp.name}</div><div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{photoUrl ? 'Current photo' : 'No photo uploaded'}</div></div>
            </div>
            <div style={{ padding: 20, display: 'grid', gap: 10 }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto} style={{ width: '100%', border: 'none', borderRadius: 10, padding: '11px 14px', background: '#2563eb', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}><i className="bi bi-upload me-2" />{uploadingPhoto ? 'Processing image...' : 'Upload new photo'}</button>
              {photoUrl && <button type="button" onClick={removeProfilePhoto} disabled={uploadingPhoto} style={{ width: '100%', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', background: '#fff', color: '#dc2626', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}><i className="bi bi-trash3 me-2" />Remove photo</button>}
              <div style={{ color: '#94a3b8', textAlign: 'center', fontSize: 10.5 }}>JPG, PNG, or WebP · automatically optimised to 5 MB</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f1f4f9', borderRadius: 14, padding: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 18px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7,
            background: tab === t.key ? '#fff' : 'transparent',
            color: tab === t.key ? '#0f172a' : '#64748b',
            boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            transition: 'all 0.2s',
          }}>
            <i className={`bi ${t.icon}`} style={{ fontSize: 14 }} />{t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <div className="row g-3">
          <div className="col-lg-8">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #3b82f615, #8b5cf608)', border: '1px solid #3b82f610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-person-badge" style={{ color: '#3b82f6', fontSize: 13 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Professional Summary</span>
              </div>
              <div style={{ padding: 20 }}>
                <div className="row g-3 mb-4">
                  {[
                    ['Department', emp.department, 'bi-building', '#3b82f6', '#eff6ff'],
                    ['Shift', emp.shift, 'bi-clock', '#8b5cf6', '#f5f3ff'],
                    ['Status', profile?.employmentStatus?.replace(/_/g, ' ') || emp.status, 'bi-activity', '#10b981', '#f0fdf4'],
                    ['Leave Balance', `${emp.leaveBalance || 0} days`, 'bi-calendar-check', '#f59e0b', '#fffbeb'],
                  ].map(([label, val, icon, color, bg]) => (
                    <div key={label} className="col-sm-6">
                      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.03)', transition: 'all 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)'; e.currentTarget.style.transform = 'none'; }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 10, background: bg, border: `1px solid ${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <i className={`bi ${icon}`} style={{ color, fontSize: 15 }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', textTransform: 'capitalize' }}>{val || '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #eff6ff, #eef2ff)', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-stars" style={{ color: '#4f46e5', fontSize: 13 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>Skills & Competencies</span>
                </div>
                {emp.skills?.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {emp.skills.map((s, i) => (
                      <span key={i} className="badge" style={{ background: 'linear-gradient(135deg, #eff6ff, #eef2ff)', color: '#4f46e5', fontSize: 12.5, padding: '6px 14px', fontWeight: 600, borderRadius: 8, border: '1px solid #dbeafe' }}>{s}</span>
                    ))}
                  </div>
                ) : <span style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No skills listed.</span>}
              </div>
            </div>
          </div>

          <div className="col-lg-4">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf615, #3b82f608)', border: '1px solid #8b5cf610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-diagram-3" style={{ color: '#8b5cf6', fontSize: 13 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Reporting Chain</span>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', paddingLeft: 4 }}>
                  <div style={{ position: 'absolute', left: 27, top: 28, bottom: 28, width: 2, background: 'linear-gradient(to bottom, #3b82f6, #10b981, #64748b)', opacity: 0.3 }} />
                  {[
                    { person: emp.teamAdminId, role: 'Team Admin', color: '#3b82f6', sub: 'Administrator' },
                    { person: emp.teamLeadId, role: 'Team Lead', color: '#10b981', sub: 'Manager' },
                    { person: { name: emp.name, avatar: emp.avatar }, role: 'Employee', color: '#64748b', sub: 'Self' },
                  ].filter(r => r.person).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1, background: '#fff', borderRadius: 12, padding: '10px 12px', border: '1px solid transparent', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(4px)'; e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = 'translateX(0)'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}>
                      <div style={{ width: 46, height: 46, borderRadius: 14, background: `linear-gradient(135deg, ${r.color}, #6366f1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0, boxShadow: `0 3px 10px ${r.color}35`, transition: 'transform 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}>
                        {r.person.name?.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a' }}>{r.person.name}</div>
                        <div style={{ fontSize: 11.5, color: '#64748b' }}>{r.role}</div>
                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{r.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PERSONAL INFO TAB */}
      {tab === 'personal' && (
        <div className="row g-3">
          <div className="col-lg-6">
            <SectionCard title="Identity Details" icon="bi-person-vcard">
              {identity ? (
                <>
                  <InfoRow icon="bi-person" label="Legal Name" value={identity.legalName} />
                  <InfoRow icon="bi-person-badge" label="Preferred Name" value={identity.preferredName} />
                  <InfoRow icon="bi-envelope" label="Primary Email" value={identity.primaryEmail} />
                  <InfoRow icon="bi-telephone" label="Personal Phone" value={identity.personalPhone} />
                  <InfoRow icon="bi-telephone-plus" label="Secondary Phone" value={identity.secondaryPhone} />
                  <InfoRow icon="bi-gender-ambiguous" label="Gender" value={identity.gender?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-heart" label="Marital Status" value={identity.maritalStatus?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-flag" label="Nationality" value={identity.nationality} />
                  <InfoRow icon="bi-droplet" label="Blood Group" value={identity.bloodGroup} />

                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: '#f1f4f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="bi bi-shield-lock" style={{ color: '#64748b', fontSize: 11 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sensitive Identifiers</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {[['PAN', identity.identifiers?.pan?.maskedValue], ['Aadhaar', identity.identifiers?.aadhaar?.maskedValue]].map(([label, val]) => (
                        <div key={label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                            <i className="bi bi-credit-card-2-front" style={{ fontSize: 10 }} />{label}
                          </div>
                          {val ? (
                            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 2, color: '#0f172a' }}>{val}</div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#cbd5e1', fontStyle: 'italic' }}>Not entered</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-person-x" />
                  <p>No identity record found</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Employment Profile" icon="bi-briefcase">
              {profile ? (
                <>
                  <InfoRow icon="bi-tag" label="Employee Number" value={profile.employeeNumber} />
                  <InfoRow icon="bi-person-workspace" label="Employment Type" value={profile.employmentType?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-activity" label="Employment Status" value={profile.employmentStatus?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-building" label="Business Unit" value={profile.businessUnit} />
                  <InfoRow icon="bi-geo-alt" label="Work Location" value={profile.workLocation} />
                  <InfoRow icon="bi-calendar2-check" label="Hire Date" value={formatDate(profile.hireDate)} />
                  <InfoRow icon="bi-patch-check" label="Confirmation Date" value={formatDate(profile.confirmationDate)} />
                </>
              ) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-briefcase" />
                  <p>No employment profile found</p>
                </div>
              )}
            </SectionCard>
          </div>

          <div className="col-lg-6">
            <SectionCard title="Address" icon="bi-house" iconColor="#8b5cf6" iconBg="linear-gradient(135deg, #8b5cf615, #a855f708)">
              {identity?.addressHistory?.length > 0 ? identity.addressHistory.map((addr, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, padding: 16, marginTop: 12, transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="bi bi-geo-alt" style={{ color: '#4f46e5', fontSize: 13 }} />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', textTransform: 'capitalize' }}>{addr.addressType}</span>
                    {addr.isCurrent && <span className="badge" style={{ background: '#f0fdf4', color: '#16a34a', fontSize: 10, borderRadius: 999, border: '1px solid #bbf7d0', padding: '2px 8px', fontWeight: 600 }}>Current</span>}
                  </div>
                  <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, paddingLeft: 36 }}>
                    <div>{addr.line1}{addr.line2 ? ', ' + addr.line2 : ''}</div>
                    <div>{[addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')}</div>
                    <div style={{ color: '#64748b' }}>{addr.country}</div>
                    {addr.landmark && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><i className="bi bi-pin-fill" style={{ fontSize: 10 }} />Near: {addr.landmark}</div>}
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-house" />
                  <p>No address on record</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Emergency Contacts" icon="bi-telephone-inbound" iconColor="#ef4444" iconBg="linear-gradient(135deg, #ef444415, #dc262608)">
              {identity?.emergencyContacts?.length > 0 ? identity.emergencyContacts.map((c, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, padding: 16, marginTop: 12, transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = 'none'; }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #ef4444, #dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0, boxShadow: '0 2px 6px rgba(239,68,68,0.3)' }}>
                      {c.name?.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#0f172a' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{c.relation}</div>
                    </div>
                    {c.isPrimary && <span className="badge ms-auto" style={{ background: '#fffbeb', color: '#d97706', borderRadius: 999, border: '1px solid #fde68a', fontSize: 10, padding: '2px 8px', fontWeight: 600 }}>Primary</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <i className="bi bi-telephone-fill" style={{ color: '#94a3b8', fontSize: 11, width: 16, textAlign: 'center' }} />
                      <span>{c.phone}</span>
                    </div>
                    {c.email && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <i className="bi bi-envelope-fill" style={{ color: '#94a3b8', fontSize: 11, width: 16, textAlign: 'center' }} />
                      <span>{c.email}</span>
                    </div>}
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-telephone-x" />
                  <p>No emergency contacts on record</p>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      {/* ATTENDANCE TAB */}
      {tab === 'attendance' && (
        <div className="row g-3">
          <div className="col-md-4">
            <div className="card text-center" style={{ padding: '32px 20px', borderRadius: 14, border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)'; e.currentTarget.style.transform = 'none'; }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: 'linear-gradient(135deg, #10b98115, #05966908)', border: '1px solid #10b98120', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <i className="bi bi-calendar-check" style={{ color: '#10b981', fontSize: 26 }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Leave Balance</div>
              <div style={{ fontSize: 52, fontWeight: 800, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.02em' }}>{emp.leaveBalance || 0}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>days remaining</div>
            </div>
          </div>

          <div className="col-md-8">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f615, #8b5cf608)', border: '1px solid #3b82f610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-calendar-check" style={{ color: '#3b82f6', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Recent Leave Requests</span>
              </div>
              {data.leaves?.length > 0 ? (
                <div className="table-responsive">
                  <table className="table mb-0" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Type</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>From</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>To</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Days</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaves.map(l => (
                        <tr key={l._id} style={{ transition: 'background 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                          <td style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>{l.type}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{formatDate(l.from)}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{formatDate(l.to)}</td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}><span className="badge" style={{ background: '#f1f5f9', color: '#1e293b', fontSize: 12, padding: '4px 10px', borderRadius: 8 }}>{l.days}d</span></td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}><span className={`badge status-${l.status}`} style={{ borderRadius: 8, fontSize: 12, padding: '4px 10px' }}>{l.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state"><i className="bi bi-calendar-x" /><p>No leave requests found</p></div>
              )}
            </div>
          </div>

          <div className="col-12">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf615, #a855f708)', border: '1px solid #8b5cf610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-clock-history" style={{ color: '#8b5cf6', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Attendance — Last 30 Days</span>
              </div>
              {data.attendance?.length > 0 ? (
                <div className="table-responsive">
                  <table className="table mb-0" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Date</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Clock In</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Clock Out</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Hours</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attendance.map(a => (
                        <tr key={a._id} style={{ transition: 'background 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                          <td style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>{formatDate(a.date)}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}><Time value={a.clockIn} fallback={<span style={{ color: '#cbd5e1' }}>—</span>} /></td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}><Time value={a.clockOut} fallback={<span style={{ color: '#cbd5e1' }}>—</span>} /></td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{a.hoursWorked ? `${Math.floor(a.hoursWorked / 60)}h ${a.hoursWorked % 60}m` : <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                            <span className={`badge status-${a.status}`} style={{ borderRadius: 8, fontSize: 12, padding: '4px 10px' }}>{a.status}</span>
                            {a.lateFlag && <span className="badge status-late ms-1" style={{ borderRadius: 8, fontSize: 12, padding: '4px 10px' }}>Late</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state"><i className="bi bi-clock-history" /><p>No attendance records found</p></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ASSETS & DOCS TAB */}
      {tab === 'assets' && (
        <div className="row g-3">
          <div className="col-md-6">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b15, #d9770608)', border: '1px solid #f59e0b10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-box-seam" style={{ color: '#d97706', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Assigned Assets</span>
                {data.assets?.length > 0 && <span className="badge" style={{ background: '#f1f4f9', color: '#64748b', fontSize: 11, borderRadius: 999, padding: '2px 10px', marginLeft: 'auto' }}>{data.assets.length}</span>}
              </div>
              <div style={{ padding: 16 }}>
                {data.assets?.length > 0 ? data.assets.map(a => (
                  <div key={a._id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid #f8fafc', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.padding = '14px 10px'; e.currentTarget.style.margin = '0 -10px'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderRadius = '10px'; e.currentTarget.style.borderColor = 'transparent'; }}
                    onMouseLeave={e => { e.currentTarget.style.padding = '14px 0'; e.currentTarget.style.margin = '0'; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderRadius = '0'; }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #eff6ff, #eef2ff)', border: '1px solid #dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={`bi bi-${a.category?.toLowerCase().includes('laptop') ? 'laptop' : a.category?.toLowerCase().includes('phone') ? 'phone' : a.category?.toLowerCase().includes('monitor') ? 'display' : 'device-hdd'}`} style={{ color: '#4f46e5', fontSize: 18 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>#{a.assetId}</span>
                        <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                        <span style={{ textTransform: 'capitalize', color: a.condition === 'good' ? '#16a34a' : a.condition === 'repair' ? '#dc2626' : '#d97706', fontWeight: 600 }}>{a.condition}</span>
                      </div>
                    </div>
                    <span className="badge" style={{ background: '#f1f5f9', color: '#475569', textTransform: 'capitalize', borderRadius: 8, fontSize: 11, padding: '4px 10px', fontWeight: 600 }}>{a.status}</span>
                  </div>
                )) : <div className="empty-state"><i className="bi bi-box-seam" /><p>No assets assigned</p></div>}
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f615, #2563eb08)', border: '1px solid #3b82f610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-file-earmark-text" style={{ color: '#2563eb', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Documents</span>
                {data.documents?.length > 0 && <span className="badge" style={{ background: '#f1f4f9', color: '#64748b', fontSize: 11, borderRadius: 999, padding: '2px 10px', marginLeft: 'auto' }}>{data.documents.length}</span>}
              </div>
              <div style={{ padding: 16 }}>
                {data.documents?.length > 0 ? data.documents.map(d => (
                  <div key={d._id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: '1px solid #f8fafc', transition: 'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.padding = '14px 10px'; e.currentTarget.style.margin = '0 -10px'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderRadius = '10px'; }}
                    onMouseLeave={e => { e.currentTarget.style.padding = '14px 0'; e.currentTarget.style.margin = '0'; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderRadius = '0'; }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className="bi bi-file-earmark-text" style={{ color: '#64748b', fontSize: 18 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="bi bi-calendar3" style={{ fontSize: 10 }} />
                        {formatDate(d.createdAt)}
                        <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1' }} />
                        {d.fileSize || 'Unknown size'}
                      </div>
                    </div>
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm" style={{ padding: '7px 12px', fontSize: 12, borderRadius: 8, background: '#eff6ff', color: '#2563eb', border: '1px solid #dbeafe', fontWeight: 600, transition: 'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe'; e.currentTarget.style.color = '#1d4ed8'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.color = '#2563eb'; }}>
                      <i className="bi bi-download me-1" />Download
                    </a>
                  </div>
                )) : <div className="empty-state"><i className="bi bi-file-earmark-x" /><p>No documents uploaded</p></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PAYROLL TAB */}
      {tab === 'payroll' && (
        <div className="row g-3">
          <div className="col-12">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #10b98115, #05966908)', border: '1px solid #10b98110', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-cash-stack" style={{ color: '#10b981', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Payslip History</span>
                {data.payslips?.length > 0 && <span className="badge" style={{ background: '#f1f4f9', color: '#64748b', fontSize: 11, borderRadius: 999, padding: '2px 10px', marginLeft: 'auto' }}>{data.payslips.length} entries</span>}
              </div>
              {data.payslips?.length > 0 ? (
                <div className="table-responsive">
                  <table className="table mb-0" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Month</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Earnings</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Deductions</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Net Pay</th>
                        <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payslips.map(p => (
                        <tr key={p._id} style={{ transition: 'background 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                          <td style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 700, color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>{p.month}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>₹{Number(p.monthlyGross || p.grossPay || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#dc2626', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>−₹{Number(p.totalDeductions || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 700, color: '#16a34a', borderBottom: '1px solid #f1f5f9' }}>₹{Number(p.netPay || 0).toLocaleString('en-IN')}</td>
                          <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                            <span className={`badge ${p.status === 'finalized' ? 'status-approved' : 'status-pending'}`} style={{ borderRadius: 8, fontSize: 12, padding: '4px 10px' }}>{p.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state"><i className="bi bi-cash-stack" /><p>No payslips available</p></div>
              )}
            </div>
          </div>

          <div className="col-12">
            <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf615, #a855f708)', border: '1px solid #8b5cf610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-pie-chart" style={{ color: '#8b5cf6', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Salary Structure</span>
              </div>
              {salaryStructure ? (
                <div style={{ padding: '18px 20px' }}>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>CTC (per annum)</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>₹{Number(salaryStructure.grossLPA || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>gross LPA</div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Monthly Gross</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>₹{Math.round(Number(salaryStructure.grossLPA || 0) / 12).toLocaleString('en-IN')}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>approx.</div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', border: '1px solid #f1f5f9', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Status</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#16a34a', textTransform: 'capitalize' }}>Active</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>on record</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state"><i className="bi bi-pie-chart" /><p>No salary structure on record</p></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AUDIT LOG TAB */}
      {tab === 'audit' && (
        <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #6366f115, #4f46e508)', border: '1px solid #6366f110', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi bi-shield-check" style={{ color: '#6366f1', fontSize: 15 }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Activity Audit Log</span>
            <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto', background: '#f1f4f9', borderRadius: 999, padding: '3px 12px', fontWeight: 600, border: '1px solid #e2e8f0' }}>{auditLogs.length} entries</span>
          </div>
          {auditLoading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
          ) : !auditLogs.length ? (
            <div className="empty-state"><i className="bi bi-shield-check" /><p>No activity recorded yet</p></div>
          ) : (
            <div className="table-responsive">
              <table className="table mb-0" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Action</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Module</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>By</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Details</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Severity</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log._id} style={{ transition: 'background 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                      <td style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>{log.action}</td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}><span className="badge" style={{ background: '#eff6ff', color: '#2563eb', fontSize: 11, borderRadius: 8, padding: '4px 8px', fontWeight: 600 }}>{log.module}</span></td>
                      <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#334155', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>{log.userId?.name || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ padding: '12px 16px', fontSize: 12.5, color: '#64748b', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' }}>{log.details || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: SEV_BG[log.severity] || '#f8fafc', color: SEV_COLOR[log.severity] || '#64748b', textTransform: 'capitalize', border: `1px solid ${(SEV_BG[log.severity] || '#f8fafc').replace('ff', '80').replace('f0', '80') || '#e2e8f0'}` }}>
                          {log.severity}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' }}>
                        {formatDateTime(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* WORK PROGRESS TAB */}
      {tab === 'workprogress' && (
        <>
          <div className="card mb-3" style={{ borderRadius: 14, border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #6366f115, #4f46e508)', border: '1px solid #6366f110', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-list-check" style={{ color: '#6366f1', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Daily Work Sheet</span>
              </div>
              <button className="btn btn-sm" style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8, background: '#6366f1', color: '#fff', border: 'none', fontWeight: 600 }}
                onClick={handleWpDownload} disabled={filteredCycles.length === 0}>
                <i className="bi bi-download me-1" />Download{filteredCycles.length > 0 ? ` (${totalEntryCount})` : ''}
              </button>
            </div>
          </div>

          <div className="card mb-3" style={{ borderRadius: 14, border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="bi bi-funnel" style={{ color: '#3b82f6', fontSize: 13 }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>Filters</span>
            </div>
            <div style={{ padding: '14px 20px' }}>
              <div className="row g-3 align-items-end">
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>From Month</label>
                  <select className="form-select" style={{ fontSize: 13 }} value={filterFromMonth} onChange={e => setFilterFromMonth(e.target.value)}>
                    <option value="">All Months</option>
                    {wpMonthOptions.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>To Month</label>
                  <select className="form-select" style={{ fontSize: 13 }} value={filterToMonth} onChange={e => setFilterToMonth(e.target.value)}>
                    <option value="">All Months</option>
                    {wpMonthOptions.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>From Date</label>
                  <DateInput className="form-control" style={{ fontSize: 13 }} value={filterFromDate} onChange={e => setFilterFromDate(e.target.value)} />
                </div>
                <div className="col-md-2">
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>To Date</label>
                  <DateInput className="form-control" style={{ fontSize: 13 }} value={filterToDate} onChange={e => setFilterToDate(e.target.value)} />
                </div>
                <div className="col-md-2">
                  <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={resetWpFilters}>
                    <i className="bi bi-x-circle me-1" />Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {wpLoading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
          ) : filteredCycles.length === 0 ? (
            <div className="card" style={{ borderRadius: 14, border: '1px solid rgba(226,232,240,0.8)' }}>
              <div className="empty-state"><i className="bi bi-journal-text" /><p>No work progress records found</p></div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredCycles.map(cycle => {
                const isCycleOpen = expandedCycle === cycle.key;
                return (
                  <div key={cycle.key} className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                    <button onClick={() => toggleCycle(cycle.key)} style={{
                      width: '100%', padding: '14px 20px', border: 'none', background: isCycleOpen ? '#f8fafc' : '#fff',
                      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.15s',
                    }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: isCycleOpen ? '#6366f115' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className="bi bi-calendar3" style={{ color: isCycleOpen ? '#6366f1' : '#64748b', fontSize: 15 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>{cycle.label}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>{cycle.dates.length} day{cycle.dates.length > 1 ? 's' : ''} with work entries</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{cycle.dates.reduce((sum, d) => sum + (d.workProgress?.length || 0), 0)} entries</span>
                        <i className={`bi ${isCycleOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: '#94a3b8', fontSize: 13 }} />
                      </div>
                    </button>
                    {isCycleOpen && (
                      <div style={{ borderTop: '1px solid #f1f5f9' }}>
                        {cycle.dates.map(dateEntry => {
                          const isDateOpen = expandedDate === dateEntry._id;
                          return (
                            <div key={dateEntry._id}>
                              <button onClick={() => toggleDate(dateEntry._id)} style={{
                                width: '100%', padding: '10px 20px 10px 28px', border: 'none', borderBottom: '1px solid #f1f5f9',
                                background: isDateOpen ? '#f0f7ff' : '#fafbfc', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left',
                              }}>
                                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1e293b', minWidth: 110 }}>
                                  <i className="bi bi-calendar-day me-2" style={{ color: '#3b82f6', fontSize: 12 }} />{formatDate(dateEntry.date)}
                                </div>
                                <span className="badge" style={{ background: (STATUS_STYLE[dateEntry.status] || STATUS_STYLE.present).bg, color: (STATUS_STYLE[dateEntry.status] || STATUS_STYLE.present).color, fontSize: 10.5, fontWeight: 600, borderRadius: 8 }}>
                                  {dateEntry.status}
                                </span>
                                <span style={{ fontSize: 12.5, color: '#64748b' }}><i className="bi bi-box-arrow-in-right me-1" />{formatTime(dateEntry.clockIn) || '--'}</span>
                                <span style={{ fontSize: 12.5, color: '#64748b' }}><i className="bi bi-box-arrow-right me-1" />{formatTime(dateEntry.clockOut) || '--'}</span>
                                <span style={{ fontSize: 12.5, color: '#64748b' }}><i className="bi bi-clock me-1" />{formatMins(dateEntry.hoursWorked)}</span>
                                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{dateEntry.workProgress?.length || 0} task{dateEntry.workProgress?.length !== 1 ? 's' : ''}</span>
                                  <i className={`bi ${isDateOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ color: '#94a3b8', fontSize: 12 }} />
                                </div>
                              </button>
                              {isDateOpen && (
                                <div style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  {dateEntry.workProgress?.length > 0 ? (
                                    <div style={{ padding: '10px 20px 14px 28px' }}>
                                      <div className="table-responsive">
                                        <table className="table mb-0" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                                          <thead>
                                            <tr>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', width: 40 }}>#</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', minWidth: 180 }}>Task Details</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', width: 80 }}>Start</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', width: 80 }}>End</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', width: 80 }}>Duration</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', width: 120 }}>Status</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', minWidth: 140 }}>Remarks</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', minWidth: 140 }}>Feedback</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {dateEntry.workProgress.map((wp, idx) => {
                                              const isBreak = isBreakType(wp.type);
                                              const st = WP_STATUS_STYLE[wp.status] || WP_STATUS_STYLE.pending;
                                              return (
                                                <tr key={idx} style={{ background: isBreak ? '#f8fafc' : 'transparent', transition: 'background 0.15s' }}
                                                  onMouseEnter={e => { if (!isBreak) e.currentTarget.style.background = '#f8fafc'; }}
                                                  onMouseLeave={e => { if (!isBreak) e.currentTarget.style.background = 'transparent'; }}>
                                                  <td style={{ padding: '8px 12px', color: '#94a3b8', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #f1f5f9' }}>{idx + 1}</td>
                                                  <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
                                                    {isBreak ? (
                                                      <span className="badge" style={{ background: breakStyle(wp.type).bg, color: breakStyle(wp.type).color, fontSize: 11, fontWeight: 700, borderRadius: 8 }}>
                                                        <i className={`bi ${breakStyle(wp.type).icon} me-1`} />{wp.taskDetails || wp.type}
                                                      </span>
                                                    ) : (
                                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{wp.taskDetails || '—'}</span>
                                                    )}
                                                  </td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#334155', borderBottom: '1px solid #f1f5f9' }}><Time value={wp.startTime} fallback="--" /></td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#334155', borderBottom: '1px solid #f1f5f9' }}><Time value={wp.endTime} fallback="--" /></td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{formatTaskDuration(wp)}</td>
                                                  <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
                                                    <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 8, background: st.bg, color: st.color, textTransform: 'capitalize' }}>
                                                      {wp.status?.replace(/_/g, ' ') || 'pending'}
                                                    </span>
                                                  </td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#64748b', maxWidth: 180, borderBottom: '1px solid #f1f5f9' }}>{wp.remarks || '—'}</td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#64748b', maxWidth: 180, borderBottom: '1px solid #f1f5f9' }}>{wp.feedback || '—'}</td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ padding: '10px 20px 10px 28px', fontSize: 13, color: '#94a3b8', fontStyle: 'italic', borderBottom: '1px solid #f1f5f9' }}>No work entries for this date</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showTimer && (
            <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }}>
                <div className="modal-content" style={{ borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '28px 24px', textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                      <i className="bi bi-download" style={{ fontSize: 28, color: '#3b82f6' }} />
                    </div>
                    <h6 style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Preparing Download</h6>
                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>Large dataset — download will be ready in approximately 30 minutes</p>
                    <div style={{ fontSize: 42, fontWeight: 800, fontFamily: 'monospace', color: '#1e293b', marginBottom: 16 }}>{formatDuration(downloadRemaining)}</div>
                    <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', marginBottom: 20 }}>
                      <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, #3b82f6, #2563eb)', width: `${downloadRemaining <= 0 ? 100 : ((1800 - downloadRemaining) / 1800) * 100}%`, transition: 'width 1s linear' }} />
                    </div>
                    {downloadRemaining <= 0 ? (
                      <div className="alert alert-success py-2" style={{ fontSize: 13, margin: 0 }}><i className="bi bi-check-circle me-2" />Download started!</div>
                    ) : (
                      <button className="btn btn-outline-secondary btn-sm" onClick={closeTimer} style={{ fontSize: 12 }}>Minimize</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
