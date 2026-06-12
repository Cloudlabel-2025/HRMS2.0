'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';

const STATUS_CONFIG = {
  onboarding: { color: '#3b82f6', bg: '#eff6ff', label: 'Onboarding' },
  probation:  { color: '#f59e0b', bg: '#fffbeb', label: 'Probation' },
  active:     { color: '#10b981', bg: '#f0fdf4', label: 'Active' },
  suspended:  { color: '#ef4444', bg: '#fef2f2', label: 'Suspended' },
  resigned:   { color: '#6b7280', bg: '#f9fafb', label: 'Resigned' },
  terminated: { color: '#dc2626', bg: '#fef2f2', label: 'Terminated' },
  retired:    { color: '#6b7280', bg: '#f9fafb', label: 'Retired' },
  rehired:    { color: '#06b6d4', bg: '#ecfeff', label: 'Rehired' },
  alumni:     { color: '#94a3b8', bg: '#f8fafc', label: 'Alumni' },
};

const fmt = s => String(s || '').replace(/_/g, ' ');

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#64748b', bg: '#f1f5f9', label: status };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: cfg.bg, color: cfg.color, textTransform: 'capitalize', border: `1px solid ${cfg.color}30` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

export default function CoreHrPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const router = useRouter();
  const [profiles, setProfiles]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [search, setSearch]             = useState('');
  const [filterDept, setFilterDept]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/api/core/profiles?limit=200');
      setProfiles(Array.isArray(res.items) ? res.items : []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const allItems = useMemo(() => profiles.map(p => ({
    id: p._id,
    name: p.identityId?.legalName || p.employeeNumber || 'Unknown',
    employeeNumber: p.employeeNumber || '',
    department: p.department || '',
    designation: p.designation || '',
    status: p.employmentStatus || 'unknown',
    hireDate: p.hireDate,
  })), [profiles]);

  const allDepts    = [...new Set(allItems.map(i => i.department).filter(Boolean))];
  const allStatuses = [...new Set(profiles.map(p => p.employmentStatus).filter(Boolean))];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter(i => {
      const matchSearch = !q || [i.name, i.employeeNumber, i.department, i.designation, i.status].some(v => String(v || '').toLowerCase().includes(q));
      const matchDept   = !filterDept   || i.department === filterDept;
      const matchStatus = !filterStatus || i.status === filterStatus;
      return matchSearch && matchDept && matchStatus;
    });
  }, [allItems, search, filterDept, filterStatus]);

  return (
    <AppShell title="Core HR Lifecycle">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#3b82f615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="bi bi-diagram-3" style={{ color: '#3b82f6', fontSize: 15 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 1 }}>Core HR</span>
          </div>
          <h4 style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>Employment Lifecycle</h4>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>Review employee status, apply lifecycle transitions, and audit recent changes.</p>
        </div>
        <button className="btn btn-outline-primary btn-sm" onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <i className={`bi bi-arrow-repeat${loading ? ' spin' : ''}`} />Refresh
        </button>
      </div>

      {error && (
        <div className="alert alert-danger d-flex align-items-center justify-content-between" role="alert">
          <span>{error}</span>
          <button className="btn btn-sm btn-outline-danger" onClick={load}>Retry</button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Core Profiles', value: profiles.length,                                                                            icon: 'bi-person-vcard', color: '#3b82f6' },
          { label: 'Active',        value: profiles.filter(p => p.employmentStatus === 'active').length,                                icon: 'bi-person-check', color: '#10b981' },
          { label: 'Onboarding',    value: profiles.filter(p => ['onboarding','probation'].includes(p.employmentStatus)).length,         icon: 'bi-person-plus',  color: '#f59e0b' },
          { label: 'Separated',     value: profiles.filter(p => ['resigned','terminated','retired'].includes(p.employmentStatus)).length, icon: 'bi-person-dash',  color: '#ef4444' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{s.value}</div>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: s.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`bi ${s.icon}`} style={{ color: s.color, fontSize: 17 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-5">
            <div style={{ position: 'relative' }}>
              <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13 }} />
              <input className="form-control" placeholder="Search by name, emp ID, department..." style={{ paddingLeft: 32, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="col-md-3">
            <select className="form-select" style={{ fontSize: 13 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
              <option value="">All Departments</option>
              {allDepts.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" style={{ fontSize: 13 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {allStatuses.map(s => <option key={s} value={s}>{fmt(s)}</option>)}
            </select>
          </div>
          <div className="col-md-1">
            <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={() => { setSearch(''); setFilterDept(''); setFilterStatus(''); }}>
              <i className="bi bi-x-circle" />
            </button>
          </div>
        </div>
      </div>

      {/* Directory Table */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><div className="spinner-border text-primary" /></div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Emp ID</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Lifecycle Status</th>
                  <th>Hire Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-people" /><h6>No employees found</h6></div></td></tr>
                ) : filtered.map(item => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/core-hr/${item.id}`)}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                          {item.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#2563eb' }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>Core Profile</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {item.employeeNumber
                        ? <span className="badge" style={{ background: '#eff6ff', color: '#2563eb', fontWeight: 700 }}>{item.employeeNumber}</span>
                        : <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>{item.department || '—'}</td>
                    <td style={{ fontSize: 13 }}>{item.designation || '—'}</td>
                    <td><StatusBadge status={item.status} /></td>
                    <td style={{ fontSize: 13, color: '#64748b' }}>{item.hireDate ? formatDate(item.hireDate) : '—'}</td>
                    <td>
                      <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 12, padding: '3px 10px' }}
                        onClick={e => { e.stopPropagation(); router.push(`/core-hr/${item.id}`); }}>
                        <i className="bi bi-arrow-right" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`.spin { animation: spin 1s linear infinite; } @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}
