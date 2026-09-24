'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';
import DateInput from '@/components/DateInput';

const KIND_STYLE = {
  absent:        { bg: '#fee2e2', color: '#dc2626', label: 'Absent',      icon: 'bi-x-circle' },
  not_arrived:   { bg: '#f1f5f9', color: '#64748b', label: 'Not Arrived', icon: 'bi-hourglass-split' },
  on_leave:      { bg: '#dbeafe', color: '#2563eb', label: 'On Leave',    icon: 'bi-calendar-check' },
  on_permission: { bg: '#e0e7ff', color: '#1d4ed8', label: 'On Permission', icon: 'bi-patch-check' },
  late:          { bg: '#fef3c7', color: '#d97706', label: 'Late',        icon: 'bi-clock' },
  half_day:      { bg: '#f3e8ff', color: '#7c3aed', label: 'Half Day',    icon: 'bi-clock-history' },
  present:       { bg: '#dcfce7', color: '#16a34a', label: 'Present',     icon: 'bi-check-circle' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'absent', label: 'Absent' },
  { key: 'not_arrived', label: 'Not Arrived' },
  { key: 'on_leave', label: 'On Leave' },
  { key: 'on_permission', label: 'On Permission' },
  { key: 'late', label: 'Late' },
  { key: 'half_day', label: 'Half Day' },
  { key: 'unnotified', label: 'Without Leave' },
  { key: 'flagged', label: 'Flagged' },
];

export default function AbsencePage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [absences, setAbsences] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [toast, setToast] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [cardFilter, setCardFilter] = useState('all');
  const [searchValue, setSearchValue] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [department, setDepartment] = useState('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [month, cardFilter, searchValue, fromDate, toDate, department]);

  // Clear date range when month changes if out of bounds
  const handleMonthChange = (v) => {
    setMonth(v);
    setFromDate('');
    setToDate('');
  };

  const monthBounds = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return { min: '', max: '' };
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { min: `${month}-01`, max: `${month}-${String(last).padStart(2, '0')}` };
  }, [month]);

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/absence?month=${month}`);
      setAbsences(Array.isArray(data?.absences) ? data.absences : []);
      setSummary(data?.summary || null);
    } catch (e) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user, month]);

  const departmentOptions = useMemo(() => {
    const s = new Set(absences.map(a => a.userId?.department).filter(Boolean));
    return [...s].sort();
  }, [absences]);

  const depts = departmentOptions.length;

  // Client-side filter pipeline — respects all active filters; report uses same pipeline
  const filteredAbsences = useMemo(() => {
    let out = absences;
    if (fromDate) out = out.filter(a => (a.date || '') >= fromDate);
    if (toDate) out = out.filter(a => (a.date || '') <= toDate);
    if (department) out = out.filter(a => (a.userId?.department || '') === department);
    if (searchValue.trim()) {
      const q = searchValue.trim().toLowerCase();
      out = out.filter(a => (a.userId?.name || '').toLowerCase().includes(q));
    }
    switch (cardFilter) {
      case 'flagged': return out.filter(a => a.flagged || (a.pattern || 0) >= 3);
      case 'unnotified': return out.filter(a => a.kind === 'absent' && !a.hasLeave);
      case 'all': return out;
      default: return out.filter(a => a.kind === cardFilter);
    }
  }, [absences, cardFilter, searchValue, fromDate, toDate, department]);

  const hasActiveFilters = cardFilter !== 'all' || !!searchValue.trim() || !!fromDate || !!toDate || !!department;

  const clearFilters = () => {
    setCardFilter('all');
    setSearchValue('');
    setFromDate('');
    setToDate('');
    setDepartment('');
  };

  const counts = useMemo(() => {
    // Cards reflect scope after date/search/department but BEFORE status filter so siblings don't zero out
    let scoped = absences;
    if (fromDate) scoped = scoped.filter(a => (a.date || '') >= fromDate);
    if (toDate) scoped = scoped.filter(a => (a.date || '') <= toDate);
    if (department) scoped = scoped.filter(a => (a.userId?.department || '') === department);
    if (searchValue.trim()) {
      const q = searchValue.trim().toLowerCase();
      scoped = scoped.filter(a => (a.userId?.name || '').toLowerCase().includes(q));
    }
    const c = { totalAbsences: 0, notArrived: 0, onLeave: 0, onPermission: 0, late: 0, halfDay: 0, withoutLeave: 0 };
    for (const a of scoped) {
      if (a.kind === 'absent') c.totalAbsences++;
      if (a.kind === 'not_arrived') c.notArrived++;
      if (a.kind === 'on_leave') c.onLeave++;
      if (a.kind === 'on_permission' || a.permissionStatus === 'approved') c.onPermission++;
      if (a.kind === 'late') c.late++;
      if (a.kind === 'half_day') c.halfDay++;
      if (a.kind === 'absent' && !a.hasLeave) c.withoutLeave++;
    }
    return c;
  }, [absences, searchValue, fromDate, toDate, department]);

  const filterLabel = FILTERS.find(f => f.key === cardFilter)?.label || 'All';

  const buildFilename = (ext) => {
    const base = `absence-management-${month}`;
    const parts = [];
    if (fromDate || toDate) parts.push(`${fromDate || monthBounds.min}_to_${toDate || monthBounds.max}`);
    if (cardFilter !== 'all') parts.push(cardFilter);
    if (department) parts.push(department.replace(/\s+/g, '_'));
    const suffix = parts.length ? `-${parts.join('-')}` : '';
    return `${base}${suffix}.${ext}`;
  };

  const handleExportCsv = () => {
    if (!filteredAbsences.length) return showToast('No absence records available to export', 'error');
    const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Employee', 'Department', 'Date', 'Status', 'Reason', 'Permission', 'Leave', 'Absences This Month', 'Pattern Alert'],
      ...filteredAbsences.map(a => [
        a.userId?.name || '',
        a.userId?.department || '',
        a.date || '',
        a.statusLabel || a.kind || '',
        a.reason || '',
        a.permission ? `${a.permission.status || ''} ${a.permission.startTime || ''}-${a.permission.endTime || ''}`.trim() : (a.permissionStatus || ''),
        a.leave ? `${a.leave.type || a.leave.typeCode || ''}${a.leave.halfDay ? ' (half day)' : ''}` : '',
        a.pattern || 0,
        a.flagged || (a.pattern || 0) >= 3 ? 'Flagged' : 'Normal',
      ]),
    ];
    const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = buildFilename('csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('CSV downloaded', 'success');
  };

  const handleDownload = async (format) => {
    if (!filteredAbsences.length) return showToast('No absence records available to export', 'error');
    if (format === 'csv') return handleExportCsv();
    setDownloadLoading(true);
    try {
      const meta = { month, fromDate, toDate, statusFilter: cardFilter, searchValue: searchValue.trim(), department, formatDate };
      if (format === 'excel') {
        const { buildAbsenceExcel } = await import('@/lib/absence-export');
        const buffer = await buildAbsenceExcel(filteredAbsences, meta);
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildFilename('xlsx');
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (format === 'pdf') {
        const { buildAbsencePdf } = await import('@/lib/absence-export');
        const doc = await buildAbsencePdf(filteredAbsences, meta);
        doc.save(buildFilename('pdf'));
      }
      showToast('Downloaded successfully', 'success');
    } catch (e) {
      showToast('Download failed: ' + (e.message || String(e)), 'error');
    } finally {
      setDownloadLoading(false);
      setDownloadOpen(false);
    }
  };

  const cards = [
    { label: 'Total Absences', value: counts.totalAbsences || 0, color: '#ef4444', icon: 'bi-person-x', filter: 'absent' },
    { label: 'Not Arrived Yet', value: counts.notArrived || 0, color: '#64748b', icon: 'bi-hourglass-split', filter: 'not_arrived' },
    { label: 'Without Leave Applied', value: counts.withoutLeave || 0, color: '#8b5cf6', icon: 'bi-calendar-x', filter: 'unnotified' },
    { label: 'On Leave', value: counts.onLeave || 0, color: '#3b82f6', icon: 'bi-calendar-check', filter: 'on_leave' },
    { label: 'On Permission', value: counts.onPermission || 0, color: '#1d4ed8', icon: 'bi-patch-check', filter: 'on_permission' },
    { label: 'Late Clock-ins', value: counts.late || 0, color: '#f59e0b', icon: 'bi-clock', filter: 'late' },
  ];

  return (
    <AppShell title="Absence Management">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className="bi bi-exclamation-circle me-2" />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Absence Management</h4><p>Track absences, not-arrived, leave &amp; permissions · {depts} dept{depts !== 1 ? 's' : ''}{hasActiveFilters ? ` · ${filteredAbsences.length} filtered` : ''}</p></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="month" className="form-control" style={{ width: 160, fontSize: 13 }} value={month} onChange={e => handleMonthChange(e.target.value)} />
          <div style={{ position: 'relative' }}>
            <button className="btn btn-outline-secondary" onClick={() => setDownloadOpen(v => !v)} disabled={downloadLoading || filteredAbsences.length === 0} style={{ fontSize: 13 }}>
              {downloadLoading ? <span className="spinner-border spinner-border-sm me-2" /> : <i className="bi bi-download me-2" />}
              Download
              <i className={`bi ms-2 ${downloadOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ fontSize: 11 }} />
            </button>
            {downloadOpen && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', minWidth: 180, zIndex: 20, overflow: 'hidden' }}>
                <button type="button" onClick={() => handleDownload('excel')} disabled={downloadLoading} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: '#fff', textAlign: 'left', fontSize: 13, cursor: 'pointer' }}><i className="bi bi-file-earmark-spreadsheet" style={{ color: '#16a34a' }} /> Excel (.xlsx)</button>
                <button type="button" onClick={() => handleDownload('pdf')} disabled={downloadLoading} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: '#fff', textAlign: 'left', fontSize: 13, cursor: 'pointer', borderTop: '1px solid #f1f5f9' }}><i className="bi bi-file-earmark-pdf" style={{ color: '#dc2626' }} /> PDF (.pdf)</button>
                <button type="button" onClick={() => handleDownload('csv')} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: '#fff', textAlign: 'left', fontSize: 13, cursor: 'pointer', borderTop: '1px solid #f1f5f9' }}><i className="bi bi-filetype-csv" style={{ color: '#64748b' }} /> CSV (.csv)</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        {cards.map((s, i) => (
          <div key={i} className="col-6 col-xl-2 d-flex">
            <button type="button" className="stat-card" onClick={() => setCardFilter(cardFilter === s.filter ? 'all' : s.filter)} aria-pressed={cardFilter === s.filter} style={{ width: '100%', minHeight: 150, textAlign: 'left', cursor: 'pointer', border: cardFilter === s.filter ? `2px solid ${s.color}` : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ minHeight: 36, fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div><div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div></div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ padding: '11px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select
            className="form-select"
            value={cardFilter}
            onChange={e => setCardFilter(e.target.value)}
            style={{ width: 180, fontSize: 13 }}
            aria-label="Filter absence records by status"
          >
            {FILTERS.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select
            className="form-select"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            style={{ width: 170, fontSize: 13 }}
            aria-label="Filter by department"
          >
            <option value="">All Departments</option>
            {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div style={{ width: 155 }}>
            <DateInput value={fromDate} onChange={e => setFromDate(e.target.value)} min={monthBounds.min} max={toDate || monthBounds.max} placeholder={monthBounds.min} title="From date" className="form-control" style={{ fontSize: 13 }} />
          </div>
          <div style={{ width: 155 }}>
            <DateInput value={toDate} onChange={e => setToDate(e.target.value)} min={fromDate || monthBounds.min} max={monthBounds.max} placeholder={monthBounds.max} title="To date" className="form-control" style={{ fontSize: 13 }} />
          </div>
          <input
            type="text"
            className="form-control"
            placeholder="Search employee..."
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            style={{ width: 180, fontSize: 13 }}
            aria-label="Search by employee name"
          />
          {hasActiveFilters && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearFilters} style={{ fontSize: 12 }}>
              <i className="bi bi-x-circle me-1" />Clear
            </button>
          )}
          {!loading && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{filterLabel} · {filteredAbsences.length} record{filteredAbsences.length !== 1 ? 's' : ''}</span>}
        </div>
        {loading ? <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div> : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead><tr><th>Employee</th><th>Department</th><th>Date</th><th>Status</th><th>Reason / Detail</th><th>Permission</th><th>Leave</th><th>Absences (Month)</th><th>Pattern Alert</th></tr></thead>
              <tbody>
                {filteredAbsences.length === 0 ? (
                  <tr><td colSpan={9}><div className="empty-state"><i className="bi bi-person-check" /><h6>No {filterLabel.toLowerCase()} records{hasActiveFilters ? ' for current filters' : ` for ${month}`}</h6><p style={{ fontSize: 11, color: '#94a3b8' }}>{hasActiveFilters ? 'Try clearing filters or changing the month.' : 'Employees who have not arrived yet appear under “Not Arrived” until the half-day threshold.'}</p></div></td></tr>
                ) : filteredAbsences.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(a => {
                  const style = KIND_STYLE[a.kind] || KIND_STYLE.absent;
                  return (
                    <tr key={a._id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#ef4444,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{a.userId?.avatar || a.userId?.name?.slice(0, 2).toUpperCase()}</div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{a.userId?.name}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 13, color: '#64748b' }}>{a.userId?.department || '—'}</td>
                      <td style={{ fontSize: 13 }}>{formatDate(a.date)}</td>
                      <td>
                        <span className="badge" style={{ background: style.bg, color: style.color, fontSize: 10 }}>
                          <i className={`bi ${style.icon} me-1`} />{a.statusLabel || style.label}
                        </span>
                        {a.permissionStatus && a.kind !== 'on_permission' && (
                          <div style={{ marginTop: 4 }}>
                            <span className="badge" style={{ background: a.permissionStatus === 'approved' ? '#eff6ff' : '#fef3c7', color: a.permissionStatus === 'approved' ? '#1d4ed8' : '#92400e', fontSize: 10 }}>
                              <i className={`bi ${a.permissionStatus === 'approved' ? 'bi-patch-check' : 'bi-hourglass-split'} me-1`} />
                              Permission · {a.permissionStatus === 'approved' ? 'Approved' : 'Pending'}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 220 }}>{a.reason || '—'}</td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>
                        {a.permission
                          ? <span>{a.permission.startTime || ''}{a.permission.startTime ? '–' : ''}{a.permission.endTime || ''}</span>
                          : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>
                        {a.leave ? <span>{a.leave.type || a.leave.typeCode}{a.leave.halfDay ? ' (½)' : ''}</span> : '—'}
                      </td>
                      <td><span style={{ fontWeight: 700, color: (a.pattern || 0) >= 3 ? '#ef4444' : '#f59e0b', fontSize: 14 }}>{a.pattern || 0}</span></td>
                      <td>
                        {(a.flagged || (a.pattern || 0) >= 3)
                          ? <span className="badge status-rejected"><i className="bi bi-exclamation-triangle me-1" />Flagged</span>
                          : <span className="badge status-approved">Normal</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filteredAbsences.length > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={Math.ceil(filteredAbsences.length / pageSize)}
            onPageChange={setCurrentPage}
            totalItems={filteredAbsences.length}
            pageSize={pageSize}
          />
        )}
      </div>
    </AppShell>
  );
}
