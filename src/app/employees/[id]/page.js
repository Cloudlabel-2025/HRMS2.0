'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';

const TABS = [
  { key: 'overview',     label: 'Overview',      icon: 'bi-person-lines-fill' },
  { key: 'personal',    label: 'Personal Info',  icon: 'bi-card-personal' },
  { key: 'attendance',  label: 'Attendance',     icon: 'bi-clock-history' },
  { key: 'workprogress',label: 'Work Progress',  icon: 'bi-list-check' },
  { key: 'assets',      label: 'Assets & Docs',  icon: 'bi-box-seam' },
  { key: 'payroll',     label: 'Payroll',        icon: 'bi-cash-stack' },
  { key: 'audit',       label: 'Audit Log',      icon: 'bi-shield-check' },
];

const WP_STATUS_STYLE = {
  pending: { bg: '#f8fafc', color: '#94a3b8' },
  work_in_progress: { bg: '#dbeafe', color: '#2563eb' },
  completed: { bg: '#dcfce7', color: '#16a34a' },
  task_blocked: { bg: '#fef3c7', color: '#d97706' },
  stopped: { bg: '#fee2e2', color: '#dc2626' },
};
const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a' },
  absent: { bg: '#fee2e2', color: '#dc2626' },
  late: { bg: '#fef3c7', color: '#d97706' },
  leave: { bg: '#dbeafe', color: '#2563eb' },
  holiday: { bg: '#f1f5f9', color: '#64748b' },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatMins(mins) {
  if (!mins) return '--';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
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

function composeAddressLine(form) {
  return [form.addressLine1, form.addressLine2, form.addressLine3].map(v => String(v || '').trim()).filter(Boolean).join(', ');
}

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { formatDate, formatDateTime } = useSettings();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState({ msg: '', type: 'success' });
  const [idForm, setIdForm] = useState({ panNumber: '', aadhaarNumber: '' });
  const [idSaving, setIdSaving] = useState(false);
  const [showIdForm, setShowIdForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  // Work progress state
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
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts] = useState([]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: 'success' }), 3000);
  };
  const recordAuditAction = (action, details, severity = 'low') => {
    api.post('/api/audit/action', { action, module: 'Employees', details, severity }).catch(() => {});
  };
  const rejectEdit = (message) => {
    showToast(message, 'error');
    recordAuditAction('Employee Profile Validation Failed', `${data?.employee?.name || 'Employee'}: ${message}`, 'medium');
  };

  useEffect(() => {
    if (id) {
      api.get(`/api/employees/${id}/details`)
        .then(res => { setData(res); })
        .catch(e => { showToast(e.message, 'error'); setTimeout(() => router.push('/employees'), 2000); })
        .finally(() => setLoading(false));
      api.get('/api/settings?type=departments').then(d => setDepartments(Array.isArray(d) ? d.map(x => x.name) : [])).catch(() => {});
      api.get('/api/settings?type=designations').then(d => setDesignations(Array.isArray(d) ? d : [])).catch(() => {});
      api.get('/api/settings?type=shifts').then(d => setShifts(Array.isArray(d) ? d : [])).catch(() => {});
    }
  }, [id, router]);

  const openEdit = () => {
    const emp = data?.employee;
    if (!emp) return;
    const currentAddress = data?.identity?.addressHistory?.find(a => a.isCurrent) || data?.identity?.addressHistory?.[0] || {};
    const emergency = data?.identity?.emergencyContacts?.find(c => c.isPrimary) || data?.identity?.emergencyContacts?.[0] || {};
    setEditForm({
      name: emp.name || '',
      email: emp.email || '',
      phone: emp.phone || '',
      bloodGroup: data?.identity?.bloodGroup || '',
      gender: data?.identity?.gender || '',
      addressLine1: currentAddress.line1 || '',
      addressLine2: currentAddress.line2 || '',
      addressLine3: currentAddress.landmark || '',
      cityTown: currentAddress.city || '',
      pinCode: currentAddress.postalCode || '',
      emergencyContactName: emergency.name || '',
      emergencyContactPhone: emergency.phone || '',
      department: emp.department || '',
      designation: emp.designation || '',
      role: emp.role || 'employee',
      shift: emp.shift || '',
      status: emp.status || 'active',
      joinDate: emp.joinDate ? emp.joinDate.slice(0, 10) : '',
      skills: (emp.skills || []).join(', '),
    });
    setShowEditModal(true);
  };

  const saveEdit = async () => {
    const NAME_RE = /^[A-Za-z\s]+$/;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!editForm.name?.trim()) return rejectEdit('Name is required');
    if (!NAME_RE.test(editForm.name.trim())) return rejectEdit('Name must contain only letters and spaces');
    if (!editForm.email?.trim() || !EMAIL_RE.test(editForm.email.trim())) return rejectEdit('Valid email is required');
    if (editForm.phone && !/^[0-9]{10}$/.test(editForm.phone.trim())) return rejectEdit('Phone must be exactly 10 digits');
    if (editForm.pinCode && !/^[0-9]{6}$/.test(editForm.pinCode)) return rejectEdit('Pin code must be exactly 6 digits');
    setEditSaving(true);
    try {
      const payload = { ...editForm, skills: editForm.skills.split(',').map(s => s.trim()).filter(Boolean) };
      await api.put(`/api/employees/${id}`, payload);
      if (data?.identity?._id) {
        await api.put(`/api/core/identities/${data.identity._id}`, {
          preferredName: editForm.name,
          primaryEmail: editForm.email,
          personalPhone: editForm.phone || '',
          gender: editForm.gender || data.identity.gender || 'prefer_not_to_say',
          bloodGroup: editForm.bloodGroup || '',
          addressHistory: editForm.addressLine1 || editForm.cityTown || editForm.pinCode ? [{
            addressType: 'current',
            line1: composeAddressLine(editForm) || editForm.addressLine1,
            city: editForm.cityTown || 'N/A',
            state: 'N/A',
            country: 'India',
            postalCode: editForm.pinCode || '000000',
            landmark: editForm.addressLine3 || '',
            isCurrent: true,
          }] : data.identity.addressHistory || [],
          emergencyContacts: editForm.emergencyContactName || editForm.emergencyContactPhone ? [{
            name: editForm.emergencyContactName || 'Emergency Contact',
            relation: 'Emergency',
            phone: editForm.emergencyContactPhone || '0000000000',
            isPrimary: true,
          }] : data.identity.emergencyContacts || [],
        });
      }
      showToast('Employee updated successfully');
      setShowEditModal(false);
      const res = await api.get(`/api/employees/${id}/details`);
      setData(res);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setEditSaving(false); }
  };

  // Work progress — fetch data
  useEffect(() => {
    if (tab === 'workprogress' && id && wpCycles.length === 0 && !wpLoading) {
      setWpLoading(true);
      api.get(`/api/employees/${id}/work-progress`)
        .then(data => setWpCycles(data || []))
        .catch(e => showToast(e.message, 'error'))
        .finally(() => setWpLoading(false));
    }
  }, [tab, id]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

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
        if (!d.workProgress?.length) { rows.push([cycle.label, d.date, d.status, d.clockIn || '', d.clockOut || '', formatMins(d.hoursWorked), '', '', '', '', '', '', '', '']); continue; }
        for (let i = 0; i < d.workProgress.length; i++) {
          const wp = d.workProgress[i];
          rows.push([cycle.label, d.date, d.status, d.clockIn || '', d.clockOut || '', formatMins(d.hoursWorked), String(i + 1), wp.type || 'task', wp.taskDetails || '', wp.startTime || '', wp.endTime || '', wp.status || '', wp.remarks || '', wp.feedback || '']);
        }
      }
    }
    return rows;
  };
  const triggerDownload = (rows, filename) => {
    const csv = '\uFEFF' + rows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  };
  const handleWpDownload = () => {
    const rows = toCsvRows(filteredCycles);
    const entryCount = rows.length - 1;
    if (entryCount <= 5) { triggerDownload(rows, `work_progress_${emp?.name || 'export'}.csv`); showToast('Downloaded successfully'); return; }
    if (timerRef.current) clearInterval(timerRef.current);
    setDownloadRemaining(1800);
    setShowTimer(true);
    timerRef.current = setInterval(() => {
      setDownloadRemaining(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); timerRef.current = null; triggerDownload(rows, `work_progress_${emp?.name || 'export'}.csv`); return 0; }
        return prev - 1;
      });
    }, 1000);
  };
  const closeTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setShowTimer(false); setDownloadRemaining(0);
  };

  if (loading) return (
    <AppShell title="Loading...">
      <div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  if (!data) return (
    <AppShell title="Not Found">
      <div className="alert alert-danger m-4">Employee not found.</div>
    </AppShell>
  );

  const emp = data.employee;
  const identity = data.identity;
  const profile = data.profile;
  const canEdit = ['super_admin', 'admin_full'].includes(user?.role);

  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const AADHAAR_RE = /^[0-9]{12}$/;

  const saveIdentifiers = async () => {
    if (!data?.identity?._id) return rejectEdit('No identity record found');
    if (!idForm.panNumber && !idForm.aadhaarNumber) return rejectEdit('Enter PAN or Aadhaar to save');
    const pan = idForm.panNumber.toUpperCase().trim();
    const aadhaar = idForm.aadhaarNumber.replace(/\D/g, '');
    if (pan && !PAN_RE.test(pan)) return rejectEdit('Invalid PAN - must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)');
    if (aadhaar && !AADHAAR_RE.test(aadhaar)) return rejectEdit('Invalid Aadhaar - must be exactly 12 digits');
    setIdSaving(true);
    try {
      const payload = { identifiers: {} };
      if (pan) payload.identifiers.panNumber = pan;
      if (aadhaar) payload.identifiers.aadhaarNumber = aadhaar;
      await api.put(`/api/core/identities/${data.identity._id}`, payload);
      showToast('Identifiers saved securely');
      setIdForm({ panNumber: '', aadhaarNumber: '' });
      setShowIdForm(false);
      // Refresh data
      const res = await api.get(`/api/employees/${id}/details`);
      setData(res);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setIdSaving(false);
    }
  };
  const visibleTabs = TABS.filter(t => {
    if (t.key === 'payroll' && !['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role) && (!data.payslips?.length)) return false;
    if (t.key === 'audit' && (!['super_admin', 'admin_full'].includes(user?.role) || user?._id === emp.userId?.toString() || user?.id === emp.userId?.toString())) return false;
    if (t.key === 'workprogress' && !(['super_admin', 'admin_full'].includes(user?.role) || user?._id === emp.userId?.toString() || user?.id === emp.userId?.toString() || (['team_admin', 'team_lead'].includes(user?.role) && user?.department === emp.department))) return false;
    return true;
  });

  const statusColor = emp.status === 'active' ? '#10b981' : emp.status === 'inactive' ? '#ef4444' : '#64748b';
  const statusBg = emp.status === 'active' ? '#dcfce7' : emp.status === 'inactive' ? '#fee2e2' : '#f1f5f9';

  return (
    <AppShell title="Employee Profile">
      {toast.msg && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      {/* Hero Banner */}
      <div className="card mb-4" style={{ borderRadius: 16, overflow: 'hidden', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
        <div style={{ height: 80, background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#3b82f6'} 0%, #1e293b 100%)`, position: 'relative' }}>
          <div style={{ position: 'absolute', top: -20, right: 20, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
          <div style={{ position: 'absolute', bottom: -30, left: '25%', width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        </div>
        <div style={{ padding: '20px 28px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ width: 88, height: 88, borderRadius: 20, background: '#fff', padding: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', flexShrink: 0 }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 17, background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#3b82f6'}, #6366f1)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>
                {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
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
                  {emp.status.toUpperCase()}
                </span>
                <span className="badge" style={{ background: (ROLE_COLORS[emp.role] || '#64748b') + '15', color: ROLE_COLORS[emp.role] || '#64748b', fontSize: 10.5, padding: '4px 10px', borderRadius: 999 }}>
                  {ROLE_LABELS[emp.role] || emp.role}
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            {canEdit && (
              <button className="btn btn-sm" style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, background: '#f1f4f9', border: '1px solid #e2e8f0', color: '#475569', fontWeight: 600, transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f1f4f9'; }} onClick={openEdit}>
                <i className="bi bi-pencil me-1" />Edit
              </button>
            )}
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

                  {/* PAN / Aadhaar — admin only */}
                  {canEdit && (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, background: '#f1f4f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <i className="bi bi-shield-lock" style={{ color: '#64748b', fontSize: 11 }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sensitive Identifiers</span>
                        </div>
                        <button className="btn btn-sm" style={{ fontSize: 11, padding: '4px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 600 }} onClick={() => setShowIdForm(p => !p)}>
                          <i className={`bi ${showIdForm ? 'bi-x-lg' : 'bi-pencil'} me-1`} style={{ fontSize: 10 }} />{showIdForm ? 'Cancel' : 'Update'}
                        </button>
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
                      {showIdForm && (
                        <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 16 }}>
                          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
                            <div style={{ width: 20, height: 20, borderRadius: 6, background: '#fde68a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <i className="bi bi-lock-fill" style={{ fontSize: 10, color: '#d97706' }} />
                            </div>
                            Values are stored encrypted. Only masked values are shown after saving.
                          </div>
                          <div className="row g-3">
                            <div className="col-6">
                              <label className="form-label" style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>PAN Number</label>
                              <input className="form-control" style={{ fontSize: 13, fontFamily: 'monospace', letterSpacing: 1, borderRadius: 8 }} placeholder="ABCDE1234F" maxLength={10} value={idForm.panNumber} onChange={e => setIdForm(p => ({ ...p, panNumber: e.target.value.toUpperCase() }))} />
                            </div>
                            <div className="col-6">
                              <label className="form-label" style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>Aadhaar Number</label>
                              <input className="form-control" style={{ fontSize: 13, fontFamily: 'monospace', letterSpacing: 1, borderRadius: 8 }} placeholder="123456789012" maxLength={12} value={idForm.aadhaarNumber} onChange={e => setIdForm(p => ({ ...p, aadhaarNumber: e.target.value.replace(/\D/g, '') }))} />
                            </div>
                            <div className="col-12">
                              <button className="btn btn-sm" style={{ background: '#f59e0b', color: '#fff', border: 'none', fontSize: 12, borderRadius: 8, padding: '8px 16px', fontWeight: 600 }} onClick={saveIdentifiers} disabled={idSaving}>
                                {idSaving ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />Saving...</> : <><i className="bi bi-shield-check me-1" />Save Securely</>}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{l.from}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{l.to}</td>
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
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{a.clockIn || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{a.clockOut || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
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
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>Gross</th>
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
                      <td style={{ padding: '12px 16px', fontSize: 13, color: '#334155', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>₹{Number(p.grossPay || 0).toLocaleString('en-IN')}</td>
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
      )}

      {/* AUDIT LOG TAB */}
      {tab === 'audit' && (
        <div className="card" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #6366f115, #4f46e508)', border: '1px solid #6366f110', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi bi-shield-check" style={{ color: '#6366f1', fontSize: 15 }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Activity Audit Log</span>
            <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto', background: '#f1f4f9', borderRadius: 999, padding: '3px 12px', fontWeight: 600, border: '1px solid #e2e8f0' }}>{data.auditLogs?.length || 0} entries</span>
          </div>
          {!data.auditLogs?.length ? (
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
                  {data.auditLogs.map(log => (
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
          {/* Header */}
          <div className="card mb-3" style={{ borderRadius: 14, border: '1px solid rgba(226,232,240,0.8)', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #6366f115, #4f46e508)', border: '1px solid #6366f110', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-list-check" style={{ color: '#6366f1', fontSize: 15 }} />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Work Progress</span>
              </div>
              <button className="btn btn-sm" style={{ fontSize: 12, padding: '6px 16px', borderRadius: 8, background: '#6366f1', color: '#fff', border: 'none', fontWeight: 600 }}
                onClick={handleWpDownload} disabled={filteredCycles.length === 0}>
                <i className="bi bi-download me-1" />Download{filteredCycles.length > 0 ? ` (${totalEntryCount})` : ''}
              </button>
            </div>
          </div>

          {/* Filters */}
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
                                <span style={{ fontSize: 12.5, color: '#64748b' }}><i className="bi bi-box-arrow-in-right me-1" />{dateEntry.clockIn || '--'}</span>
                                <span style={{ fontSize: 12.5, color: '#64748b' }}><i className="bi bi-box-arrow-right me-1" />{dateEntry.clockOut || '--'}</span>
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
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', width: 120 }}>Status</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', minWidth: 140 }}>Remarks</th>
                                              <th style={{ padding: '8px 12px', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, background: '#f8fafc', borderBottom: '1px solid #f1f5f9', minWidth: 140 }}>Feedback</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {dateEntry.workProgress.map((wp, idx) => {
                                              const isBreak = wp.type === 'break' || wp.type === 'lunch';
                                              const st = WP_STATUS_STYLE[wp.status] || WP_STATUS_STYLE.pending;
                                              return (
                                                <tr key={idx} style={{ background: isBreak ? '#f8fafc' : 'transparent', transition: 'background 0.15s' }}
                                                  onMouseEnter={e => { if (!isBreak) e.currentTarget.style.background = '#f8fafc'; }}
                                                  onMouseLeave={e => { if (!isBreak) e.currentTarget.style.background = 'transparent'; }}>
                                                  <td style={{ padding: '8px 12px', color: '#94a3b8', fontWeight: 700, fontSize: 12, borderBottom: '1px solid #f1f5f9' }}>{idx + 1}</td>
                                                  <td style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
                                                    {isBreak ? (
                                                      <span className="badge" style={{ background: wp.type === 'lunch' ? '#f5f3ff' : '#fffbeb', color: wp.type === 'lunch' ? '#7c3aed' : '#d97706', fontSize: 11, fontWeight: 700, borderRadius: 8 }}>
                                                        <i className={`bi ${wp.type === 'lunch' ? 'bi-egg-fried' : 'bi-cup-hot'} me-1`} />{wp.type === 'lunch' ? 'Lunch break' : 'Break'}
                                                      </span>
                                                    ) : (
                                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{wp.taskDetails || '—'}</span>
                                                    )}
                                                  </td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{wp.startTime || '--'}</td>
                                                  <td style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, color: '#334155', borderBottom: '1px solid #f1f5f9' }}>{wp.endTime || '--'}</td>
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

          {/* Download timer modal */}
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

      {/* Inline Edit Modal */}
      {showEditModal && (
        <div className="modal show d-block" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" style={{ animation: 'dropIn 0.2s cubic-bezier(0.4,0,0.2,1)' }}>
            <div className="modal-content" style={{ borderRadius: 16, border: 'none', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', padding: '20px 24px' }}>
                <h5 className="modal-title" style={{ fontWeight: 700, fontSize: 17 }}>Edit Employee — {data?.employee?.name}</h5>
                <button className="btn-close" onClick={() => setShowEditModal(false)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Full Name *</label>
                    <input type="text" className="form-control" value={editForm.name || ''}
                      onChange={e => setEditForm(p => ({ ...p, name: e.target.value.replace(/[^A-Za-z\s]/g, '') }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Blood Group</label>
                    <select className="form-select" value={editForm.bloodGroup || ''} onChange={e => setEditForm(p => ({ ...p, bloodGroup: e.target.value }))}>
                      <option value="">Select</option>
                      {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Gender</label>
                    <select className="form-select" value={editForm.gender || ''} onChange={e => setEditForm(p => ({ ...p, gender: e.target.value }))}>
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non_binary">Non-Binary</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Email *</label>
                    <input type="email" className="form-control" autoComplete="off" value={editForm.email || ''}
                      onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Phone</label>
                    <input type="tel" className="form-control" maxLength={10} value={editForm.phone || ''}
                      onChange={e => setEditForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Numbers only, 10 digits</div>
                  </div>
                  <div className="col-12">
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>Address Details</div>
                  </div>
                  <div className="col-md-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Address Line 1</label><input className="form-control" value={editForm.addressLine1 || ''} onChange={e => setEditForm(p => ({ ...p, addressLine1: e.target.value }))} /></div>
                  <div className="col-md-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Address Line 2</label><input className="form-control" value={editForm.addressLine2 || ''} onChange={e => setEditForm(p => ({ ...p, addressLine2: e.target.value }))} /></div>
                  <div className="col-md-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Address Line 3</label><input className="form-control" value={editForm.addressLine3 || ''} onChange={e => setEditForm(p => ({ ...p, addressLine3: e.target.value }))} /></div>
                  <div className="col-md-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>City / Town</label><input className="form-control" value={editForm.cityTown || ''} onChange={e => setEditForm(p => ({ ...p, cityTown: e.target.value }))} /></div>
                  <div className="col-md-3"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Pin Code</label><input className="form-control" maxLength={6} value={editForm.pinCode || ''} onChange={e => setEditForm(p => ({ ...p, pinCode: e.target.value.replace(/\D/g, '').slice(0, 6) }))} /></div>
                  <div className="col-md-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Emergency Contact Name</label><input className="form-control" value={editForm.emergencyContactName || ''} onChange={e => setEditForm(p => ({ ...p, emergencyContactName: e.target.value.replace(/[^A-Za-z\s]/g, '') }))} /></div>
                  <div className="col-md-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Emergency Contact Phone</label><input className="form-control" maxLength={10} value={editForm.emergencyContactPhone || ''} onChange={e => setEditForm(p => ({ ...p, emergencyContactPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} /></div>
                  <div className="col-12">
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>Work Details</div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Join Date</label>
                    <DateInput className="form-control" value={editForm.joinDate || ''}
                      onChange={e => setEditForm(p => ({ ...p, joinDate: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Department</label>
                    <select className="form-select" value={editForm.department || ''} onChange={e => setEditForm(p => ({ ...p, department: e.target.value }))}>
                      <option value="">Select Department</option>
                      {departments.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Designation</label>
                    <select className="form-select" value={editForm.designation || ''} onChange={e => setEditForm(p => ({ ...p, designation: e.target.value }))}>
                      <option value="">Select Designation</option>
                      {designations.map(d => <option key={d._id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Shift</label>
                    <select className="form-select" value={editForm.shift || ''} onChange={e => setEditForm(p => ({ ...p, shift: e.target.value }))}>
                      <option value="">Select Shift</option>
                      {shifts.map(s => <option key={s._id} value={s.name}>{s.name}{s.startTime && s.endTime ? ` (${s.startTime}–${s.endTime})` : ''}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Role</label>
                    <select className="form-select" value={editForm.role || ''} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                      {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label>
                    <select className="form-select" value={editForm.status || ''} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Skills <span style={{ fontWeight: 400, color: '#94a3b8' }}>(comma separated)</span></label>
                    <input className="form-control" placeholder="e.g. React, Node.js, AWS" value={editForm.skills || ''}
                      onChange={e => setEditForm(p => ({ ...p, skills: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>
                  {editSaving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
