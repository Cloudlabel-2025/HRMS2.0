'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

export default function AbsencePage() {
  const { user } = useAuth();
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/absence?month=${month}`);
      setAbsences(Array.isArray(data?.absences) ? data.absences : []);
    } catch (e) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user, month]);

  const flagged = absences.filter(a => a.flagged || a.pattern >= 3);
  const noNotif = absences.filter(a => a.reason?.includes('No notification'));
  const depts = new Set(absences.map(a => a.userId?.department)).size;

  return (
    <AppShell title="Absence Management">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className="bi bi-exclamation-circle me-2" />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Absence Management</h4><p>Track unplanned absences, patterns, and alerts</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="month" className="form-control" style={{ width: 160, fontSize: 13 }} value={month} onChange={e => setMonth(e.target.value)} />
          <button className="btn btn-outline-secondary"><i className="bi bi-download me-2" />Export</button>
        </div>
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Total Absences', value: absences.length, color: '#ef4444', icon: 'bi-person-x' },
          { label: 'Flagged Patterns', value: flagged.length, color: '#f59e0b', icon: 'bi-exclamation-triangle' },
          { label: 'Without Leave Applied', value: noNotif.length, color: '#8b5cf6', icon: 'bi-calendar-x' },
          { label: 'Departments Affected', value: depts, color: '#3b82f6', icon: 'bi-diagram-3' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div><div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div></div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        {loading ? <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div> : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead><tr><th>Employee</th><th>Department</th><th>Date</th><th>Reason</th><th>Absences (Month)</th><th>Pattern Alert</th></tr></thead>
              <tbody>
                {absences.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-person-check" /><h6>No absences recorded for {month}</h6></div></td></tr>
                ) : absences.map(a => (
                  <tr key={a._id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#ef4444,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{a.userId?.avatar || a.userId?.name?.slice(0, 2).toUpperCase()}</div>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{a.userId?.name}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: '#64748b' }}>{a.userId?.department || '—'}</td>
                    <td style={{ fontSize: 13 }}>{a.date}</td>
                    <td style={{ fontSize: 13, color: '#64748b' }}>{a.reason}</td>
                    <td><span style={{ fontWeight: 700, color: a.pattern >= 3 ? '#ef4444' : '#f59e0b', fontSize: 14 }}>{a.pattern || 1}</span></td>
                    <td>
                      {(a.flagged || a.pattern >= 3)
                        ? <span className="badge status-rejected"><i className="bi bi-exclamation-triangle me-1" />Flagged</span>
                        : <span className="badge status-approved">Normal</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
