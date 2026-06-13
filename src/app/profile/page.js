'use client';
import { useEffect, useState } from 'react';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';

const SEV_COLOR = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };
const SEV_BG    = { low: '#f0fdf4', medium: '#fffbeb', high: '#fef2f2' };

export default function ProfilePage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const router = useRouter();

  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [tab, setTab]             = useState('info');

  useEffect(() => {
    if (!user) return;

    // Regular employees — redirect to their Employee record profile page
    if (!['super_admin', 'admin_full'].includes(user.role)) {
      api.get('/api/employees')
        .then(emps => {
          const mine = emps.find(e => e.email === user.email);
          if (mine) router.replace(`/employees/${mine._id}`);
          else setLoading(false);
        })
        .catch(() => setLoading(false));
      return;
    }

    // Admins — load their own audit logs from the audit API
    api.get(`/api/audit?userId=${user.id}`)
      .then(d => setAuditLogs(Array.isArray(d.logs) ? d.logs : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, router]);

  if (loading) return (
    <AppShell title="My Profile">
      <div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  if (!user) return null;

  return (
    <AppShell title="My Profile">
      {/* Hero Banner */}
      <div className="card mb-4" style={{ borderRadius: 16, overflow: 'hidden', border: 'none' }}>
        <div style={{ height: 100, background: `linear-gradient(135deg, ${ROLE_COLORS[user.role] || '#3b82f6'} 0%, #1e293b 100%)` }} />
        <div style={{ padding: '0 28px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: -44 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <div style={{ width: 88, height: 88, borderRadius: 18, background: '#fff', padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', flexShrink: 0 }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 14, background: `linear-gradient(135deg, ${ROLE_COLORS[user.role] || '#3b82f6'}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: '#fff' }}>
                  {user.avatar || user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
              </div>
              <div style={{ paddingBottom: 4 }}>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: 22, color: '#0f172a' }}>{user.name}</h3>
                <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>{user.designation || ROLE_LABELS[user.role]}</span>
                  {user.department && <> &bull; {user.department}</>}
                </div>
              </div>
            </div>
            <span className="badge" style={{ background: (ROLE_COLORS[user.role] || '#64748b') + '20', color: ROLE_COLORS[user.role] || '#64748b', fontSize: 12, padding: '6px 14px', marginBottom: 4 }}>
              {ROLE_LABELS[user.role] || user.role}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', marginTop: 18, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
            {[
              { icon: 'bi-envelope', val: user.email },
              { icon: 'bi-telephone', val: user.phone },
              { icon: 'bi-clock',    val: user.shift },
            ].filter(i => i.val).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569' }}>
                <i className={`bi ${item.icon}`} style={{ color: '#3b82f6', fontSize: 13 }} />
                <span>{item.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'info',  label: 'Info',         icon: 'bi-person' },
          { key: 'audit', label: 'Activity Log',  icon: 'bi-clock-history' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            <i className={`bi ${t.icon}`} style={{ fontSize: 13 }} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="row g-3">
          <div className="col-md-6">
            <div className="card" style={{ borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 16 }}>Account Details</div>
              {[
                ['Full Name',   'bi-person',       user.name],
                ['Email',       'bi-envelope',     user.email],
                ['Phone',       'bi-telephone',    user.phone       || '—'],
                ['Role',        'bi-person-badge', ROLE_LABELS[user.role] || user.role],
                ['Department',  'bi-building',     user.department  || '—'],
                ['Designation', 'bi-briefcase',    user.designation || '—'],
                ['Shift',       'bi-clock',        user.shift       || '—'],
              ].map(([label, icon, val]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 7, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b', marginTop: 2 }}>{val}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="col-md-6">
            <div className="card" style={{ borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 16 }}>System Access</div>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Access Level</div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: (ROLE_COLORS[user.role] || '#64748b') + '15', color: ROLE_COLORS[user.role] || '#64748b' }}>
                  <i className="bi bi-shield-check" />{ROLE_LABELS[user.role] || user.role}
                </span>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Activity Summary</div>
                <div style={{ fontSize: 13, color: '#475569', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div><i className="bi bi-clock-history me-2" style={{ color: '#3b82f6' }} />{auditLogs.length} actions recorded</div>
                  {auditLogs[0] && (
                    <div><i className="bi bi-calendar me-2" style={{ color: '#3b82f6' }} />Last: {new Date(auditLogs[0].createdAt).toLocaleString()}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card" style={{ borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="bi bi-clock-history" style={{ color: '#3b82f6', fontSize: 15 }} />
            <span style={{ fontWeight: 700, fontSize: 14 }}>My Activity Log</span>
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>{auditLogs.length} entries</span>
          </div>
          {auditLogs.length === 0 ? (
            <div className="empty-state"><i className="bi bi-clock-history" /><p>No activity recorded yet</p></div>
          ) : (
            <div className="table-responsive">
              <table className="table mb-0">
                <thead><tr><th>Action</th><th>Module</th><th>Details</th><th>Severity</th><th>Time</th></tr></thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log._id}>
                      <td style={{ fontSize: 13, fontWeight: 600 }}>{log.action}</td>
                      <td><span className="badge" style={{ background: '#eff6ff', color: '#2563eb', fontSize: 11 }}>{log.module}</span></td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.details || '—'}</td>
                      <td><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: SEV_BG[log.severity] || '#f8fafc', color: SEV_COLOR[log.severity] || '#64748b', textTransform: 'capitalize' }}>{log.severity}</span></td>
                      <td style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
