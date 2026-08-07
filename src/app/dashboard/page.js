'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth, ROLE_COLORS, ROLE_LABELS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';
import { formatMins } from '@/lib/format';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const WORK_STATUS_COLORS = { pending: '#64748b', work_in_progress: '#3b82f6', stopped: '#f59e0b' };
const WORK_STATUS_LABELS = { pending: 'Pending', work_in_progress: 'Work in Progress', stopped: 'Stopped' };

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
  const { formatDate } = useSettings();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [continueTask, setContinueTask] = useState(null);
  const [continuing, setContinuing] = useState(false);
  const [taskMsg, setTaskMsg] = useState('');
  const [announcementQueue, setAnnouncementQueue] = useState([]);
  const [acknowledgingAnnouncement, setAcknowledgingAnnouncement] = useState(false);

  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [permissionForm, setPermissionForm] = useState({ date: '', startTime: '', endTime: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState('');

  const resetForm = () => {
    setPermissionForm({ date: '', startTime: '', endTime: '', reason: '' });
    setModalError('');
    setModalSuccess('');
  };

  const submitPermission = async () => {
    setModalError('');
    setModalSuccess('');

    const { date, startTime, endTime, reason } = permissionForm;
    if (!date) return setModalError('Date is required');
    if (!startTime) return setModalError('Start time is required');
    if (!endTime) return setModalError('End time is required');
    if (!reason || reason.trim().length < 10) return setModalError('Reason must be at least 10 characters');
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return setModalError('Invalid start or end time format');

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let durationMins = (eh * 60 + em) - (sh * 60 + sm);
    if (durationMins < 0) durationMins += 24 * 60;
    if (durationMins > 120) {
      return setModalError('Permission duration cannot exceed 2 hours');
    }

    setSubmitting(true);
    try {
      await api.post('/api/self-service/requests', {
        requestType: 'permission',
        reason,
        payload: { date, startTime, endTime }
      });
      setModalSuccess('Permission request submitted successfully!');
      setTimeout(() => {
        setShowPermissionModal(false);
        resetForm();
      }, 1500);
    } catch (e) {
      setModalError(e.message || 'Failed to submit permission request');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    api.get('/api/dashboard')
      .then(setStats)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    api.get('/api/notifications')
      .then(notes => setAnnouncementQueue((Array.isArray(notes) ? notes : []).filter(note => note.type === 'announcement' && !note.read)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPendingPage(1);
  }, [stats?.pendingTasks?.length]);

  const refresh = () => api.get('/api/dashboard').then(setStats).catch(e => setError(e.message));

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const refetch = () => {
      if (document.visibilityState === 'hidden') return;
      refreshRef.current();
    };
    window.addEventListener('focus', refetch);
    window.addEventListener('popstate', refetch);
    window.addEventListener('pageshow', refetch);
    document.addEventListener('visibilitychange', refetch);
    return () => {
      window.removeEventListener('focus', refetch);
      window.removeEventListener('popstate', refetch);
      window.removeEventListener('pageshow', refetch);
      document.removeEventListener('visibilitychange', refetch);
    };
  }, []);

  const handleContinue = async () => {
    setContinuing(true);
    try {
      await api.post('/api/attendance/continue-task', { taskDetails: continueTask.text });
      setTaskMsg('Task added to today\'s worksheet.');
      setTimeout(() => {
        setContinueTask(null);
        setTaskMsg('');
        refresh();
      }, 1500);
    } catch (e) {
      setTaskMsg(e.message || 'Failed to continue task');
    } finally {
      setContinuing(false);
    }
  };

  const acknowledgeAnnouncement = async () => {
    const announcement = announcementQueue[0];
    if (!announcement || acknowledgingAnnouncement) return;
    setAcknowledgingAnnouncement(true);
    try {
      await api.patch('/api/notifications', { id: announcement._id });
      setAnnouncementQueue(queue => queue.slice(1));
    } catch (e) {
      setError(e.message || 'Unable to acknowledge the announcement. Please try again.');
    } finally {
      setAcknowledgingAnnouncement(false);
    }
  };

  if (!user) return null;

  const role = user.role;
  const isSuperAdmin = role === 'super_admin';
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

  const statCardRoutes = {
    'Total Employees': '/employees',
    'Team Members': '/employees',
    'Present Today': '/attendance',
    'Days Present': '/attendance',
    'Pending Leaves': '/leave',
    'Pending Approvals': '/leave',
    'Leave Approvals': '/leave',
    'My Leave Balance': '/leave',
    'Leave Balance': '/leave',
    'Open Tasks': '/tasks',
    'Team Tasks': '/tasks',
    'Pending Tasks': '/tasks',
    'Open Positions': '/recruitment',
    'Last Payslip': '/payroll',
  };

  // Quick actions based on role
  const quickActions = isAdmin ? [
    { icon: 'bi-person-plus', label: 'Add Employee', color: '#3b82f6', href: '/employees' },
    { icon: 'bi-calendar-check', label: 'Approve Leaves', color: '#f59e0b', href: '/leave' },
    { icon: 'bi-cash-stack', label: 'Run Payroll', color: '#10b981', href: '/payroll' },
    { icon: 'bi-megaphone', label: 'Announce', color: '#8b5cf6', href: '/communication' },
    ...(!isSuperAdmin ? [{ icon: 'bi-shield-check', label: 'Request Permission', color: '#14b8a6', onClick: () => setShowPermissionModal(true) }] : []),
  ] : [
    { icon: 'bi-clock', label: 'Mark Attendance', color: '#3b82f6', href: '/attendance' },
    { icon: 'bi-calendar-plus', label: 'Request Leave', color: '#f59e0b', href: '/leave' },
    { icon: 'bi-shield-check', label: 'Request Permission', color: '#10b981', onClick: () => setShowPermissionModal(true) },
    { icon: 'bi-person-badge', label: 'My Profile', color: '#8b5cf6', href: '/self-service' },
  ];

  const currentAnnouncement = announcementQueue[0];

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
                <Link
                  href={statCardRoutes[s.label] || '/dashboard'}
                  className="stat-card"
                  aria-label={`Open ${s.label}`}
                  style={{ display: 'block', textDecoration: 'none', transition: 'transform 0.15s ease, box-shadow 0.15s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 22px rgba(15, 23, 42, 0.10)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = ''; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600, marginBottom: 6, letterSpacing: 0.2 }}>{s.label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a', lineHeight: 1, letterSpacing: '-0.02em' }}>{s.value ?? '—'}</div>
                    </div>
                    <div className="stat-icon" style={{ background: `linear-gradient(135deg, ${s.color}18, ${s.color}08)`, border: `1px solid ${s.color}20` }}>
                      <i className={`bi ${s.icon}`} style={{ color: s.color }} />
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={{ marginBottom: 28 }}>
            <h6 style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 14, letterSpacing: 0.5, textTransform: 'uppercase' }}>Quick Actions</h6>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {quickActions.map((a, i) => {
                const isButton = !!a.onClick;
                const Component = isButton ? 'button' : Link;
                const props = isButton
                  ? { onClick: a.onClick, type: 'button' }
                  : { href: a.href };

                return (
                  <Component key={i} {...props}
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
                  </Component>
                );
              })}
            </div>
          </div>

          {/* Employee monitoring + announcements */}
          <div className="row g-3">
            <div className="col-lg-6">
              <div className="card p-3 p-md-4 h-100" style={{ border: 'none !important' }}>
                {isAdmin ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f615, #8b5cf615)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="bi bi-person-lines-fill" style={{ color: '#3b82f6', fontSize: 15 }} />
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Employee Monitoring</span>
                      {stats?.monitoring && <Link href="/monitoring" style={{ marginLeft: 'auto', color: '#3b82f6', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>Open monitoring <i className="bi bi-arrow-right" /></Link>}
                    </div>
                    {stats?.monitoring ? <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.45, marginBottom: 7 }}>Today&apos;s exceptions</div>
                      {stats.monitoring.alerts.length === 0 ? <div style={{ padding: '13px 0', color: '#10b981', fontSize: 13, fontWeight: 600 }}><i className="bi bi-check-circle-fill" style={{ marginRight: 7 }} />No late or absent employees today.</div> : stats.monitoring.alerts.map((alert, i) => (
                        <div key={`${alert.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: '1px solid #f1f5f9' }}>
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: alert.status === 'Late' ? '#fef3c7' : '#fee2e2', color: alert.status === 'Late' ? '#b45309' : '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><i className={`bi ${alert.status === 'Late' ? 'bi-clock-history' : 'bi-person-x'}`} /></div>
                          <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: '#334155', fontSize: 13, fontWeight: 650 }}>{alert.name}</div><div style={{ color: '#94a3b8', fontSize: 11.5 }}>{alert.department || 'No department'}</div></div>
                          <span style={{ color: alert.status === 'Late' ? '#b45309' : '#b91c1c', fontSize: 11.5, fontWeight: 700 }}>{alert.status}</span>
                        </div>
                      ))}
                    </> : <div className="empty-state"><i className="bi bi-shield-lock" /><p>Monitoring information is available to authorised managers.</p></div>}
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #8b5cf615, #3b82f615)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <i className="bi bi-check2-square" style={{ color: '#8b5cf6', fontSize: 15 }} />
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Pending Tasks</span>
                    </div>
                    {stats?.pendingTasks?.length ? (
                      <>
                        {stats.pendingTasks.slice((pendingPage - 1) * 8, pendingPage * 8).map((task, i) => {
                          const isOwn = task.assigneeId === String(user?._id);
                          return (
                            <div key={task._id || i}
                              onClick={isOwn ? () => { setTaskMsg(''); setContinueTask(task); } : undefined}
                              onMouseEnter={isOwn ? e => { e.currentTarget.style.background = '#f8fafc'; } : undefined}
                              onMouseLeave={isOwn ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
                              style={{ padding: '9px 8px', margin: '0 -8px', borderRadius: 8, borderTop: i === 0 ? 'none' : '1px solid #f1f5f9', cursor: isOwn ? 'pointer' : 'default', transition: 'background 0.15s ease' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f1f5f9', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><i className={isOwn ? 'bi bi-list-task' : 'bi bi-lock'} /></div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ color: '#334155', fontSize: 13, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.text}</div>
                                  <div style={{ color: '#94a3b8', fontSize: 11.5 }}>
                                    {formatDate(task.date)}{task.duration ? ` · ${formatMins(task.duration)}` : ''}{task.assignee ? ` · ${task.assignee}` : ''}{task.attempts > 0 ? ` · Tried ${task.attempts} time${task.attempts > 1 ? 's' : ''}` : ''}
                                  </div>
                                  {task.remarks ? <div style={{ color: '#94a3b8', fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.remarks}</div> : null}
                                </div>
                                <span className="badge" style={{ background: (WORK_STATUS_COLORS[task.status] || '#64748b') + '20', color: WORK_STATUS_COLORS[task.status] || '#64748b', fontSize: 10.5, fontWeight: 700 }}>{WORK_STATUS_LABELS[task.status] || task.status}</span>
                              </div>
                            </div>
                          );
                        })}
                        <Pagination currentPage={pendingPage} totalPages={Math.ceil((stats?.pendingTasks?.length || 0) / 8)} onPageChange={setPendingPage} totalItems={stats?.pendingTasks?.length || 0} pageSize={8} />
                      </>
                    ) : <div className="empty-state"><i className="bi bi-check2-circle" /><p>No pending tasks</p></div>}
                  </>
                )}
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
                    {a.attachment?.url && <a href={a.attachment.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, color: '#2563eb', fontSize: 11.5, fontWeight: 700, textDecoration: 'none' }}><i className="bi bi-paperclip" />{a.attachment.name || 'Open attachment'}</a>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {currentAnnouncement && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="announcement-modal-title"
          style={{
            position: 'fixed', inset: 0, padding: 16,
            backgroundColor: 'rgba(15, 23, 42, 0.68)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
          }}>
          <div className="card shadow-lg" style={{ width: '100%', maxWidth: 520, borderRadius: 16, border: 'none', overflow: 'hidden' }}>
            <div style={{ padding: '24px 24px 12px', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, margin: '0 auto 13px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eff6ff', color: '#2563eb' }}><i className="bi bi-megaphone-fill" style={{ fontSize: 21 }} /></div>
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7 }}>New announcement</div>
              <h5 id="announcement-modal-title" style={{ color: '#0f172a', fontWeight: 750, margin: '7px 0 0' }}>{currentAnnouncement.title.replace(/^Announcement:\s*/, '')}</h5>
            </div>
            <div style={{ padding: '8px 24px 24px', color: '#475569', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', textAlign: 'center' }}>{currentAnnouncement.message}</div>
            {currentAnnouncement.attachment?.url && <div style={{ padding: '0 24px 24px', textAlign: 'center' }}><a href={currentAnnouncement.attachment.url} download={currentAnnouncement.attachment.name || true} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 13px', borderRadius: 8, background: '#eff6ff', color: '#2563eb', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}><i className="bi bi-download" />Download {currentAnnouncement.attachment.name || 'attachment'}</a></div>}
            <div style={{ padding: '14px 24px 20px', borderTop: '1px solid #f1f5f9', textAlign: 'center' }}>
              <button type="button" className="btn btn-primary px-5" onClick={acknowledgeAnnouncement} disabled={acknowledgingAnnouncement}>{acknowledgingAnnouncement ? 'Please wait...' : 'OK'}</button>
            </div>
          </div>
        </div>
      )}

      {showPermissionModal && !isSuperAdmin && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, transition: 'all 0.3s ease-in-out'
        }}>
          <div className="card shadow-lg" style={{ width: '100%', maxWidth: 500, borderRadius: 16, border: 'none', overflow: 'hidden' }}>
            <div className="card-header border-0 bg-white pt-4 px-4 d-flex justify-content-between align-items-center">
              <h5 className="fw-bold m-0" style={{ color: '#0f172a' }}>Request Permission</h5>
              <button type="button" className="btn-close" onClick={() => { setShowPermissionModal(false); resetForm(); }}></button>
            </div>
            <div className="card-body px-4 py-3">
              {modalError && <div className="alert alert-danger py-2" style={{ fontSize: 13 }}>{modalError}</div>}
              {modalSuccess && <div className="alert alert-success py-2" style={{ fontSize: 13 }}>{modalSuccess}</div>}

              <div className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: 13, color: '#475569' }}>Date <span style={{color:'#ef4444'}}>*</span></label>
                <input type="date" className="form-control" value={permissionForm.date} onChange={e => setPermissionForm(prev => ({ ...prev, date: e.target.value }))} min={new Date().toISOString().split('T')[0]} />
              </div>

              <div className="row g-3 mb-3">
                <div className="col-6">
                  <label className="form-label fw-semibold" style={{ fontSize: 13, color: '#475569' }}>Start Time <span style={{color:'#ef4444'}}>*</span></label>
                  <input type="time" className="form-control" value={permissionForm.startTime} onChange={e => setPermissionForm(prev => ({ ...prev, startTime: e.target.value }))} />
                </div>
                <div className="col-6">
                  <label className="form-label fw-semibold" style={{ fontSize: 13, color: '#475569' }}>End Time <span style={{color:'#ef4444'}}>*</span></label>
                  <input type="time" className="form-control" value={permissionForm.endTime} onChange={e => setPermissionForm(prev => ({ ...prev, endTime: e.target.value }))} />
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label fw-semibold" style={{ fontSize: 13, color: '#475569' }}>Reason <span style={{color:'#ef4444'}}>*</span></label>
                <textarea className="form-control" rows="3" placeholder="Please explain why you need permission (min 10 chars)" value={permissionForm.reason} onChange={e => { const v = e.target.value.replace(/[^a-zA-Z0-9 ]/g, ''); setPermissionForm(prev => ({ ...prev, reason: v })); }}></textarea>
              </div>
            </div>
            <div className="card-footer bg-light border-0 px-4 py-3 d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-outline-secondary px-3 py-2 btn-sm fw-bold" onClick={() => { setShowPermissionModal(false); resetForm(); }} disabled={submitting}>Cancel</button>
              <button type="button" className="btn btn-primary px-3 py-2 btn-sm fw-bold" onClick={submitPermission} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Request'}</button>
            </div>
          </div>
        </div>
      )}

      {continueTask && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="continue-task-modal-title"
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, transition: 'all 0.3s ease-in-out'
          }}>
          <div className="card shadow-lg" style={{ width: '100%', maxWidth: 500, borderRadius: 16, border: 'none', overflow: 'hidden' }}>
            <div className="card-header border-0 bg-white pt-4 px-4 d-flex justify-content-between align-items-center">
              <h5 id="continue-task-modal-title" className="fw-bold m-0" style={{ color: '#0f172a' }}>Continue Task</h5>
              <button type="button" className="btn-close" onClick={() => { setContinueTask(null); setTaskMsg(''); }}></button>
            </div>
            <div className="card-body px-4 py-3">
              {taskMsg && (
                <div className={`alert ${taskMsg.startsWith('Task added') ? 'alert-success' : 'alert-danger'} py-2`} style={{ fontSize: 13 }}>{taskMsg}</div>
              )}
              <div style={{ color: '#475569', fontSize: 13.5, marginBottom: 8 }}>Do you want to continue this task?</div>
              <div style={{
                padding: '11px 13px', borderRadius: 10, background: '#f8fafc', border: '1px solid #f1f5f9',
                color: '#0f172a', fontSize: 13.5, fontWeight: 650, wordBreak: 'break-word'
              }}>{continueTask.text}</div>
            </div>
            <div className="card-footer bg-light border-0 px-4 py-3 d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-outline-secondary px-3 py-2 btn-sm fw-bold" onClick={() => { setContinueTask(null); setTaskMsg(''); }} disabled={continuing}>Cancel</button>
              <button type="button" className="btn btn-primary px-3 py-2 btn-sm fw-bold" onClick={handleContinue} disabled={continuing}>{continuing ? 'Please wait...' : 'Yes, Continue'}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
