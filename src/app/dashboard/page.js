'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

  // Quick actions based on role
  const quickActions = isAdmin ? [
    { icon: 'bi-person-plus', label: 'Add Employee', color: '#3b82f6', href: '/employees' },
    { icon: 'bi-calendar-check', label: 'Approve Leaves', color: '#f59e0b', href: '/leave' },
    { icon: 'bi-cash-stack', label: 'Run Payroll', color: '#10b981', href: '/payroll' },
    { icon: 'bi-megaphone', label: 'Announce', color: '#8b5cf6', href: '/communication' },
  ] : [
    { icon: 'bi-clock', label: 'Mark Attendance', color: '#3b82f6', href: '/attendance' },
    { icon: 'bi-calendar-plus', label: 'Request Leave', color: '#f59e0b', href: '/leave' },
    { icon: 'bi-check2-square', label: 'My Tasks', color: '#10b981', href: '/tasks' },
    { icon: 'bi-person-badge', label: 'My Profile', color: '#8b5cf6', href: '/self-service' },
  ];

  return (
    <AppShell title="Dashboard">
      {/* Greeting banner */}
      <div style={{
        background: `linear-gradient(135deg, ${ROLE_COLORS[user.role]} 0%, #1e293b 100%)`,
        borderRadius: 20, padding: '28px 32px', marginBottom: 28,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: '-30px', right: '-30px', width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-50px', left: '30%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h5 style={{ margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: '-0.01em' }}>
              {(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()}, {user.name.split(' ')[0]}!
            </h5>
            <p style={{ margin: '6px 0 0', opacity: 0.75, fontSize: 13.5 }}>
              {ROLE_LABELS[user.role]} · {user.department} · {formatDate(new Date(), { weekday: true })}
            </p>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="row g-3 mb-4">
            {statCards.map((s, i) => (
              <div key={i} className="col-6 col-xl-3">
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600, marginBottom: 6, letterSpacing: 0.2 }}>{s.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.02em' }}>{s.value ?? '—'}</div>
                    </div>
                    <div className="stat-icon" style={{ background: `linear-gradient(135deg, ${s.color}18, ${s.color}08)`, border: `1px solid ${s.color}20` }}>
                      <i className={`bi ${s.icon}`} style={{ color: s.color }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={{ marginBottom: 28 }}>
            <h6 style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 14, letterSpacing: 0.5, textTransform: 'uppercase' }}>Quick Actions</h6>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {quickActions.map((a, i) => (
                <Link key={i} href={a.href}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '10px 18px', borderRadius: 999,
                    background: '#fff', border: `1px solid ${a.color}20`,
                    color: a.color, textDecoration: 'none',
                    fontSize: 13, fontWeight: 600,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = a.color; e.currentTarget.style.color = '#fff'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${a.color}30`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = a.color; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; }}>
                  <i className={`bi ${a.icon}`} style={{ fontSize: 15 }} />
                  <span>{a.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Activity + Announcements */}
          <div className="row g-3">
            <div className="col-lg-6">
              <div className="card p-3 p-md-4 h-100" style={{ border: 'none !important' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f615, #8b5cf615)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-activity" style={{ color: '#3b82f6', fontSize: 15 }} />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Recent Activity</span>
                </div>
                {stats?.recentActivity?.length === 0 && <div className="empty-state"><i className="bi bi-activity" /><p>No recent activity</p></div>}
                {stats?.recentActivity?.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 0', borderBottom: i < stats.recentActivity.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    {/* Timeline dot */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', border: '2px solid #dbeafe', flexShrink: 0 }} />
                      {i < stats.recentActivity.length - 1 && <div style={{ width: 1, flex: 1, background: '#e2e8f0', marginTop: 4 }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.45, fontWeight: 500 }}>{a.text}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="bi bi-clock" style={{ fontSize: 10 }} />{formatDateTime(a.time)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-lg-6">
              <div className="card p-3 p-md-4 h-100" style={{ border: 'none !important' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b15, #ef444415)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-megaphone" style={{ color: '#f59e0b', fontSize: 15 }} />
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Announcements</span>
                </div>
                {stats?.announcements?.length === 0 && <div className="empty-state"><i className="bi bi-megaphone" /><p>No announcements</p></div>}
                {stats?.announcements?.map((a, i) => (
                  <div key={a.id || i} style={{
                    padding: 16, marginBottom: 12,
                    background: '#f8fafc', borderRadius: 12,
                    border: '1px solid #f1f5f9',
                    transition: 'all 0.2s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = 'none'; }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className="badge" style={{ background: (a.tagColor || '#3b82f6') + '18', color: a.tagColor || '#3b82f6', fontSize: 10.5, padding: '4px 10px' }}>{a.tag}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="bi bi-calendar3" style={{ fontSize: 10 }} />{formatDate(a.date)}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 650, color: '#0f172a', marginBottom: 4, letterSpacing: '-0.01em' }}>{a.title}</div>
                    <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.55 }}>{a.body}</div>
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
