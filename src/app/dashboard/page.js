'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth, ROLE_COLORS, ROLE_LABELS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

function BarChart({ data }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!data || !ref.current) return;
    const ctx = ref.current.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [
          { label: 'Present', data: data.present, backgroundColor: '#3b82f6', borderRadius: 6 },
          { label: 'Absent',  data: data.absent,  backgroundColor: '#f1f5f9', borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 12 } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } },
      },
    });
    return () => chart.destroy();
  }, [data]);
  return <canvas ref={ref} />;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { formatDate, formatDateTime } = useSettings();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/dashboard')
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (!user) return null;

  const role = user.role;
  const isAdmin     = ['super_admin', 'admin_full'].includes(role);
  const isTeamLead  = role === 'team_lead';
  const isTeamAdmin = role === 'team_admin';
  const isRecruiter = role === 'recruiter';
  const isSelf      = ['employee', 'intern'].includes(role);

  const statCards = stats ? (
    isAdmin ? [
      { label: 'Total Employees',  value: stats.totalEmployees,  icon: 'bi-people',         color: '#3b82f6' },
      { label: 'Present Today',    value: stats.presentToday,    icon: 'bi-person-check',   color: '#10b981' },
      { label: 'Pending Leaves',   value: stats.pendingLeaves,   icon: 'bi-calendar-check', color: '#f59e0b' },
      { label: 'Open Tasks',       value: stats.myPendingTasks,  icon: 'bi-check2-square',  color: '#8b5cf6' },
    ] : isTeamLead ? [
      { label: 'Team Members',     value: stats.totalEmployees,  icon: 'bi-people',         color: '#3b82f6' },
      { label: 'Present Today',    value: stats.presentToday,    icon: 'bi-person-check',   color: '#10b981' },
      { label: 'Pending Approvals',value: stats.pendingLeaves,   icon: 'bi-calendar-check', color: '#f59e0b' },
      { label: 'Team Tasks',       value: stats.myPendingTasks,  icon: 'bi-check2-square',  color: '#8b5cf6' },
    ] : isTeamAdmin ? [
      { label: 'Team Members',     value: stats.totalEmployees,  icon: 'bi-people',         color: '#3b82f6' },
      { label: 'Present Today',    value: stats.presentToday,    icon: 'bi-person-check',   color: '#10b981' },
      { label: 'Leave Approvals',  value: stats.pendingLeaves,   icon: 'bi-calendar-check', color: '#f59e0b' },
      { label: 'Team Tasks',       value: stats.myPendingTasks,  icon: 'bi-check2-square',  color: '#8b5cf6' },
    ] : isRecruiter ? [
      { label: 'Open Positions',   value: stats.openJobs,        icon: 'bi-briefcase',      color: '#3b82f6' },
      { label: 'Pending Tasks',    value: stats.myPendingTasks,  icon: 'bi-check2-square',  color: '#10b981' },
      { label: 'My Leave Balance', value: stats.myLeaveBalance,  icon: 'bi-calendar-check', color: '#f59e0b' },
      { label: 'Days Present',     value: stats.myAttendanceThisMonth, icon: 'bi-calendar2-check', color: '#8b5cf6' },
    ] : [
      { label: 'Days Present',     value: stats.myAttendanceThisMonth, icon: 'bi-calendar2-check', color: '#10b981' },
      { label: 'Leave Balance',    value: stats.myLeaveBalance,  icon: 'bi-calendar-check', color: '#3b82f6' },
      { label: 'Pending Tasks',    value: stats.myPendingTasks,  icon: 'bi-check2-square',  color: '#f59e0b' },
      { label: 'Last Payslip',     value: stats.lastPayslip ? `₹${stats.lastPayslip.net?.toLocaleString('en-IN')}` : '—', icon: 'bi-cash-stack', color: '#8b5cf6' },
    ]
  ) : [];

  return (
    <AppShell title="Dashboard">
      <div style={{ background: `linear-gradient(135deg, ${ROLE_COLORS[user.role]}, #1e293b)`, borderRadius: 16, padding: '24px 28px', marginBottom: 24, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h5 style={{ margin: 0, fontWeight: 700, fontSize: 20 }}>Good morning, {user.name.split(' ')[0]}! 👋</h5>
          <p style={{ margin: '4px 0 0', opacity: 0.8, fontSize: 13 }}>
            {ROLE_LABELS[user.role]} · {user.department} · {formatDate(new Date(), { weekday: true })}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            {statCards.map((s, i) => (
              <div key={i} className="col-6 col-xl-3">
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{s.value ?? '—'}</div>
                    </div>
                    <div className="stat-icon" style={{ background: s.color + '15' }}>
                      <i className={`bi ${s.icon}`} style={{ color: s.color }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="row g-3">
            <div className="col-lg-6">
              <div className="card p-3 h-100">
                <div className="section-title mb-3">Recent Activity</div>
                {stats?.recentActivity?.length === 0 && <div className="empty-state"><i className="bi bi-activity" /><p>No recent activity</p></div>}
                {stats?.recentActivity?.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 0', borderBottom: i < stats.recentActivity.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: '#3b82f615', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className="bi bi-activity" style={{ color: '#3b82f6', fontSize: 13 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: '#1e293b', lineHeight: 1.4 }}>{a.text}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{formatDateTime(a.time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-lg-6">
              <div className="card p-3 h-100">
                <div className="section-title mb-3">Announcements</div>
                {stats?.announcements?.length === 0 && <div className="empty-state"><i className="bi bi-megaphone" /><p>No announcements</p></div>}
                {stats?.announcements?.map((a, i) => (
                  <div key={a.id} style={{ padding: '12px 0', borderBottom: i < stats.announcements.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span className="badge" style={{ background: (a.tagColor || '#3b82f6') + '20', color: a.tagColor || '#3b82f6' }}>{a.tag}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{formatDate(a.date)}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{a.body}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
