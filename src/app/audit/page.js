'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const SEVERITY_STYLE = {
  high:   { bg: '#fee2e2', color: '#dc2626', icon: 'bi-shield-exclamation' },
  medium: { bg: '#fef3c7', color: '#d97706', icon: 'bi-info-circle' },
  low:    { bg: '#dcfce7', color: '#16a34a', icon: 'bi-check-circle' },
};
const MODULE_COLORS = {
  Payroll: '#8b5cf6', Employees: '#3b82f6', Documents: '#f59e0b',
  Leave: '#10b981', Settings: '#ef4444', Finance: '#06b6d4', Auth: '#64748b',
};

export default function AuditPage() {
  const { user } = useAuth();
  const { formatDateTime } = useSettings();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterModule, setFilterModule] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterModule) params.set('module', filterModule);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (search) params.set('search', search);
      const data = await api.get(`/api/audit?${params}`);
      setLogs(Array.isArray(data?.logs) ? data.logs : []);
    } catch (e) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user, filterModule, filterSeverity]);

  if (user?.role !== 'super_admin') return (
    <AppShell title="Audit Logs">
      <div className="empty-state"><i className="bi bi-shield-lock" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>Only Super Admin can view audit logs.</p></div>
    </AppShell>
  );

  const modules = [...new Set(logs.map(l => l.module))];

  return (
    <AppShell title="Audit Logs">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className="bi bi-exclamation-circle me-2" />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Audit Logs</h4><p>Track all critical actions across the system</p></div>
        <button className="btn btn-outline-secondary"><i className="bi bi-download me-2" />Export Logs</button>
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Total Events', value: logs.length, color: '#3b82f6' },
          { label: 'High Severity', value: logs.filter(l => l.severity === 'high').length, color: '#ef4444' },
          { label: 'Medium', value: logs.filter(l => l.severity === 'medium').length, color: '#f59e0b' },
          { label: 'Low', value: logs.filter(l => l.severity === 'low').length, color: '#10b981' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="stat-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-4">
            <div style={{ position: 'relative' }}>
              <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13 }} />
              <input className="form-control" placeholder="Search action, user, details..." style={{ paddingLeft: 32, fontSize: 13 }} value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && load()} />
            </div>
          </div>
          <div className="col-md-3">
            <select className="form-select" style={{ fontSize: 13 }} value={filterModule} onChange={e => setFilterModule(e.target.value)}>
              <option value="">All Modules</option>
              {modules.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" style={{ fontSize: 13 }} value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
              <option value="">All Severity</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="col-md-2">
            <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={() => { setSearch(''); setFilterModule(''); setFilterSeverity(''); }}>Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div> : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead><tr><th>Timestamp</th><th>Action</th><th>Module</th><th>User</th><th>Details</th><th>Severity</th></tr></thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-shield-check" /><h6>No logs found</h6></div></td></tr>
                ) : logs.map(log => {
                  const sev = SEVERITY_STYLE[log.severity] || SEVERITY_STYLE.low;
                  return (
                    <tr key={log._id}>
                      <td style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{formatDateTime(log.createdAt)}</td>
                      <td style={{ fontSize: 13, fontWeight: 700 }}>{log.action}</td>
                      <td><span className="badge" style={{ background: (MODULE_COLORS[log.module] || '#64748b') + '20', color: MODULE_COLORS[log.module] || '#64748b' }}>{log.module}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>{log.userId?.avatar || '?'}</div>
                          <span style={{ fontSize: 12 }}>{log.userId?.name || 'System'}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 280 }}>{log.details}</td>
                      <td><span className="badge" style={{ background: sev.bg, color: sev.color }}><i className={`bi ${sev.icon} me-1`} />{log.severity}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
