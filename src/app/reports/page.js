'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

const REPORT_TYPES = [
  { key: 'attendance', label: 'Attendance Report', icon: 'bi-clock', color: '#3b82f6' },
  { key: 'leave', label: 'Leave & Absence', icon: 'bi-calendar-check', color: '#10b981' },
  { key: 'payroll', label: 'Payroll Report', icon: 'bi-cash-stack', color: '#8b5cf6' },
  { key: 'tasks', label: 'Task & Project', icon: 'bi-check2-square', color: '#f59e0b' },
  { key: 'performance', label: 'Performance', icon: 'bi-graph-up-arrow', color: '#ef4444' },
  { key: 'finance', label: 'Financial', icon: 'bi-bar-chart-line', color: '#06b6d4' },
  { key: 'lifecycle', label: 'HR Lifecycle', icon: 'bi-diagram-3', color: '#f97316' },
];

function BarChart({ labels, datasets }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const ctx = ref.current.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 10 } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } },
      },
    });
    return () => chart.destroy();
  }, [labels, datasets]);
  return <canvas ref={ref} />;
}

function LineChart({ labels, datasets }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const ctx = ref.current.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } },
      },
    });
    return () => chart.destroy();
  }, [labels, datasets]);
  return <canvas ref={ref} />;
}

const fmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

export default function ReportsPage() {
  const { user } = useAuth();
  const [activeReport, setActiveReport] = useState('attendance');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ dept: '', month: new Date().toISOString().slice(0, 7) });
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const generate = async () => {
    setLoading(true);
    setData(null);
    try {
      const params = new URLSearchParams({ type: activeReport, ...filters });
      const res = await api.get(`/api/reports?${params}`);
      setData(res);
    } catch (e) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) generate(); }, [user, activeReport]);

  return (
    <AppShell title="Reports & Analytics">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className="bi bi-exclamation-circle me-2" />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Reports & Analytics</h4><p>Generate, filter, and export reports across all modules</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline-secondary"><i className="bi bi-file-earmark-excel me-2" />Export Excel</button>
          <button className="btn btn-outline-danger"><i className="bi bi-file-earmark-pdf me-2" />Export PDF</button>
        </div>
      </div>

      {/* Report type selector */}
      <div className="row g-3 mb-4">
        {REPORT_TYPES.map(r => (
          <div key={r.key} className="col-6 col-md-4 col-xl-2">
            <div onClick={() => setActiveReport(r.key)}
              style={{ background: activeReport === r.key ? r.color : '#fff', border: `2px solid ${activeReport === r.key ? r.color : '#e2e8f0'}`, borderRadius: 12, padding: '14px 12px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
              <i className={`bi ${r.icon}`} style={{ fontSize: 22, color: activeReport === r.key ? '#fff' : r.color, display: 'block', marginBottom: 6 }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: activeReport === r.key ? '#fff' : '#1e293b' }}>{r.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-3">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Department</label>
            <select className="form-select" style={{ fontSize: 13 }} value={filters.dept} onChange={e => setFilters(p => ({ ...p, dept: e.target.value }))}>
              <option value="">All Departments</option>
              {['Engineering', 'HR', 'Finance', 'Design', 'Marketing', 'Operations', 'Sales'].map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Month</label>
            <input type="month" className="form-control" style={{ fontSize: 13 }} value={filters.month} onChange={e => setFilters(p => ({ ...p, month: e.target.value }))} />
          </div>
          <div className="col-md-3">
            <button className="btn btn-primary w-100" onClick={generate} disabled={loading}>
              {loading ? <><span className="spinner-border spinner-border-sm me-2" />Generating...</> : <><i className="bi bi-search me-2" />Generate Report</>}
            </button>
          </div>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>}

      {!loading && data && (
        <>
          {/* Summary cards */}
          {data.summary && (
            <div className="row g-3 mb-4">
              {data.summary.map((s, i) => (
                <div key={i} className="col-6 col-xl-3">
                  <div className="stat-card">
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.color || '#1e293b' }}>{s.value}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Chart */}
          {data.chart && data.chart.type === 'bar' && (
            <div className="card p-3 mb-4">
              <div className="section-title mb-3">{data.chart.title}</div>
              <div style={{ height: 280 }}>
                <BarChart labels={data.chart.labels} datasets={data.chart.datasets} />
              </div>
            </div>
          )}
          {data.chart && data.chart.type === 'line' && (
            <div className="card p-3 mb-4">
              <div className="section-title mb-3">{data.chart.title}</div>
              <div style={{ height: 280 }}>
                <LineChart labels={data.chart.labels} datasets={data.chart.datasets} />
              </div>
            </div>
          )}

          {/* Lifecycle dept chart */}
          {data.deptChart && (
            <div className="card p-3 mb-4">
              <div className="section-title mb-3">{data.deptChart.title}</div>
              <div style={{ height: 240 }}>
                <BarChart labels={data.deptChart.labels} datasets={data.deptChart.datasets} />
              </div>
            </div>
          )}

          {/* Self-service request summary */}
          {data.ssRows && data.ssRows.length > 0 && (
            <div className="card mb-4">
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Self-Service Request Summary</span>
              </div>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr>{data.ssColumns?.map(c => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {data.ssRows.map((row, i) => (
                      <tr key={i}>{data.ssColumns?.map(c => (
                        <td key={c} style={{ fontSize: 13, fontWeight: c === 'Request Type' ? 600 : 400, textTransform: 'capitalize' }}>
                          {c === 'Pending' ? <span className="badge status-pending">{row[c]}</span>
                           : c === 'Approved' ? <span className="badge status-approved">{row[c]}</span>
                           : c === 'Rejected' ? <span className="badge status-rejected">{row[c]}</span>
                           : row[c]}
                        </td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Table */}
          {data.rows && data.rows.length > 0 && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr>{data.columns?.map(c => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i}>{data.columns?.map(c => <td key={c} style={{ fontSize: 13 }}>{row[c] ?? '—'}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !data && (
        <div className="card p-5 text-center">
          <i className="bi bi-file-earmark-bar-graph" style={{ fontSize: 48, color: '#94a3b8', display: 'block', marginBottom: 12 }} />
          <h6 style={{ color: '#64748b' }}>{REPORT_TYPES.find(r => r.key === activeReport)?.label}</h6>
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Select filters above and click Generate Report</p>
        </div>
      )}
    </AppShell>
  );
}
