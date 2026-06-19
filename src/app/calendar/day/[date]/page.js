'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatTime(d) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export default function DayActivityPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { date } = useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [actionsExpanded, setActionsExpanded] = useState(true);

  useEffect(() => {
    if (!user || !date) return;
    const load = async () => {
      setLoading(true);
      try {
        const d = Array.isArray(date) ? date[0] : date;
        const [attendanceArr, leaves, tasks, goals, reviews, announcements, auditRaw] = await Promise.all([
          api.get(`/api/attendance?scope=my&date=${d}`).catch(() => []),
          api.get('/api/leave?scope=my').catch(() => []),
          api.get('/api/tasks?scope=my').catch(() => []),
          api.get('/api/performance/goals').catch(() => ({ goals: [] })),
          api.get('/api/performance/reviews').catch(() => ({ reviews: [] })),
          api.get('/api/announcements').catch(() => ({ announcements: [] })),
          api.get(`/api/audit?scope=my&date=${d}`).catch(() => ({ logs: [] })),
        ]);

        const attendance = Array.isArray(attendanceArr) && attendanceArr.length > 0 ? attendanceArr[0] : null;

        const leavesOnDay = Array.isArray(leaves)
          ? leaves.filter(l => l.from <= d && l.to >= d)
          : [];

        const tasksOnDay = Array.isArray(tasks)
          ? tasks.filter(t => {
              if (!t.assignedTo) return false;
              const assignedId = typeof t.assignedTo === 'object' ? t.assignedTo?._id : t.assignedTo;
              const userId = user._id;
              if (assignedId?.toString() !== userId?.toString()) return false;
              const taskDate = t.due;
              const createdDate = t.createdAt ? t.createdAt.slice(0, 10) : null;
              return taskDate === d || createdDate === d;
            })
          : [];

        const goalsOnDay = Array.isArray(goals?.goals)
          ? goals.goals.filter(g => {
              if (!g.userId) return false;
              const uid = typeof g.userId === 'object' ? g.userId?._id : g.userId;
              if (uid?.toString() !== user._id?.toString()) return false;
              return g.createdAt?.slice(0, 10) === d;
            })
          : [];

        const reviewsOnDay = Array.isArray(reviews?.reviews)
          ? reviews.reviews.filter(r => {
              if (!r.userId) return false;
              const uid = typeof r.userId === 'object' ? r.userId?._id : r.userId;
              if (uid?.toString() !== user._id?.toString()) return false;
              return r.createdAt?.slice(0, 10) === d;
            })
          : [];

        const announcementsOnDay = Array.isArray(announcements?.announcements)
          ? announcements.announcements.filter(a => a.createdAt?.slice(0, 10) === d)
          : [];

        const actions = Array.isArray(auditRaw?.logs) ? auditRaw.logs : [];

        setData({
          attendance,
          leaves: leavesOnDay,
          tasks: tasksOnDay,
          goals: goalsOnDay,
          reviews: reviewsOnDay,
          announcements: announcementsOnDay,
          actions,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, date]);

  const d = Array.isArray(date) ? date[0] : date;
  const dt = d ? new Date(d + 'T00:00:00') : new Date();
  const dayOfWeek = dt.toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <AppShell title={`Activity - ${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`}>
      <div className="container-fluid px-4 py-3" style={{ maxWidth: 900, margin: '0 auto' }}>
        <button className="btn btn-sm btn-outline-secondary mb-3" style={{ borderRadius: 8, padding: '6px 14px', fontSize: 12 }}
          onClick={() => router.back()}>
          <i className="bi bi-arrow-left me-1" /> Back
        </button>

        <div style={{
          padding: '20px 24px', borderRadius: 16, marginBottom: 24,
          background: 'linear-gradient(135deg, #1e293b, #334155)',
          color: '#fff',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6, marginBottom: 4 }}>
            {dayOfWeek}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>
            {MONTHS[dt.getMonth()]} {dt.getDate()}, {dt.getFullYear()}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border" role="status" style={{ color: '#3b82f6' }} />
          </div>
        ) : !data ? (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <i className="bi bi-exclamation-circle" />
            <h6>Could not load activity</h6>
          </div>
        ) : (
          <>
            {/* Actions Performed */}
            {data.actions.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div onClick={() => setActionsExpanded(!actionsExpanded)}
                  style={{ padding: '16px 20px', borderBottom: actionsExpanded ? '1px solid #f1f5f9' : 'none', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#0ea5e915', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-activity" style={{ color: '#0ea5e9', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Actions Performed</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{data.actions.length} action{data.actions.length > 1 ? 's' : ''}</span>
                    <i className={`bi ${actionsExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ fontSize: 12, color: '#94a3b8' }} />
                  </span>
                </div>
                {actionsExpanded && (
                <div style={{ padding: '8px 12px' }}>
                  {data.actions.map((a, i) => (
                    <div key={a._id} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: a.severity === 'high' ? '#fee2e2' :
                                    a.severity === 'medium' ? '#fef3c7' : '#f1f5f9',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <i className="bi bi-lightning" style={{
                          color: a.severity === 'high' ? '#dc2626' :
                                 a.severity === 'medium' ? '#d97706' : '#64748b',
                          fontSize: 16,
                        }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{a.action}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {a.details}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                          <span className="badge" style={{
                            background: '#e0f2fe', color: '#0284c7',
                            fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                          }}>{a.module}</span>
                          {a.targetUserId && (
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>
                              <i className="bi bi-person me-1" />
                              {typeof a.targetUserId === 'object' ? a.targetUserId.name || a.targetUserId._id : ''}
                            </span>
                          )}
                          {a.createdAt && (
                            <span style={{ fontSize: 10, color: '#94a3b8' }}>
                              <i className="bi bi-clock me-1" />
                              {new Date(a.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Attendance */}
            <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: '#3b82f615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className="bi bi-clock" style={{ color: '#3b82f6', fontSize: 14 }} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Attendance</span>
                {data.attendance && (
                  <span className="badge" style={{
                    marginLeft: 'auto',
                    background: data.attendance.status === 'present' ? '#dcfce7' :
                                data.attendance.status === 'late' ? '#fef3c7' :
                                data.attendance.status === 'half_day' ? '#fff7ed' :
                                data.attendance.status === 'leave' || data.attendance.status === 'holiday' ? '#fee2e2' :
                                '#f1f5f9',
                    color: data.attendance.status === 'present' ? '#16a34a' :
                           data.attendance.status === 'late' ? '#d97706' :
                           data.attendance.status === 'half_day' ? '#ea580c' :
                           data.attendance.status === 'leave' || data.attendance.status === 'holiday' ? '#dc2626' :
                           '#64748b',
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                  }}>
                    {data.attendance.status ? data.attendance.status.charAt(0).toUpperCase() + data.attendance.status.slice(1) : 'N/A'}
                  </span>
                )}
              </div>
              <div style={{ padding: '16px 20px' }}>
                {data.attendance ? (
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Clock In</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{data.attendance.clockIn || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Clock Out</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{data.attendance.clockOut || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Hours Worked</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                        {data.attendance.hoursWorked ? `${(data.attendance.hoursWorked / 60).toFixed(1)}h` : '—'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>No attendance record for this day</div>
                )}
              </div>
            </div>

            {/* Work Progress */}
            {data.attendance?.workProgress?.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#8b5cf615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-graph-up-arrow" style={{ color: '#8b5cf6', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Work Progress</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{data.attendance.workProgress.length} entries</span>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {data.attendance.workProgress.map((wp, i) => (
                    <div key={i} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                        background: wp.status === 'completed' ? '#16a34a' :
                                    wp.status === 'work_in_progress' ? '#3b82f6' :
                                    wp.status === 'task_blocked' ? '#dc2626' :
                                    '#94a3b8',
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                          {wp.type === 'break' ? 'Break' : wp.type === 'lunch' ? 'Lunch' : wp.taskDetails || 'Task'}
                        </div>
                        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: '#64748b' }}>
                          {wp.startTime && <span>{wp.startTime}{wp.endTime ? ` - ${wp.endTime}` : ''}</span>}
                        </div>
                        <span className="badge" style={{
                          background: wp.status === 'completed' ? '#dcfce7' :
                                      wp.status === 'work_in_progress' ? '#dbeafe' :
                                      wp.status === 'task_blocked' ? '#fee2e2' : '#f1f5f9',
                          color: wp.status === 'completed' ? '#16a34a' :
                                 wp.status === 'work_in_progress' ? '#3b82f6' :
                                 wp.status === 'task_blocked' ? '#dc2626' : '#64748b',
                          fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 20, marginTop: 4,
                        }}>
                          {wp.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        {wp.remarks && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{wp.remarks}</div>}
                        {wp.feedback && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, fontStyle: 'italic' }}>Feedback: {wp.feedback}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tasks */}
            {data.tasks.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#d9770615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-check2-square" style={{ color: '#d97706', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Tasks</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{data.tasks.length} task{data.tasks.length > 1 ? 's' : ''}</span>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {data.tasks.map((t, i) => (
                    <div key={t._id} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                        background: t.status === 'Completed' ? '#16a34a' :
                                    t.status === 'In Progress' ? '#3b82f6' :
                                    t.status === 'Blocked' ? '#dc2626' : '#94a3b8',
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{t.title}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {t.description?.slice(0, 100)}{t.description?.length > 100 ? '...' : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                          <span className="badge" style={{
                            background: t.status === 'Completed' ? '#dcfce7' :
                                        t.status === 'In Progress' ? '#dbeafe' :
                                        t.status === 'Blocked' ? '#fee2e2' : '#f1f5f9',
                            color: t.status === 'Completed' ? '#16a34a' :
                                   t.status === 'In Progress' ? '#3b82f6' :
                                   t.status === 'Blocked' ? '#dc2626' : '#64748b',
                            fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                          }}>{t.status}</span>
                          {t.priority && (
                            <span className="badge" style={{
                              background: t.priority === 'high' ? '#fee2e2' :
                                          t.priority === 'medium' ? '#fef3c7' : '#f1f5f9',
                              color: t.priority === 'high' ? '#dc2626' :
                                     t.priority === 'medium' ? '#d97706' : '#64748b',
                              fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                            }}>{t.priority}</span>
                          )}
                          {t.due === d && (
                            <span className="badge" style={{
                              background: '#fef3c7', color: '#d97706',
                              fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                            }}>Due today</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leaves */}
            {data.leaves.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#16a34a15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-calendar-check" style={{ color: '#16a34a', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Leaves</span>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {data.leaves.map((l, i) => (
                    <div key={l._id} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: '#16a34a15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <i className="bi bi-calendar-check" style={{ color: '#16a34a', fontSize: 16 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{l.type} Leave</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {l.from === l.to ? l.from : `${l.from} to ${l.to}`} ({l.days} day{l.days > 1 ? 's' : ''})
                        </div>
                        {l.reason && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{l.reason}</div>}
                        <span className="badge" style={{
                          marginTop: 4,
                          background: l.status === 'approved' ? '#dcfce7' :
                                      l.status === 'pending' ? '#fef3c7' : '#fee2e2',
                          color: l.status === 'approved' ? '#16a34a' :
                                 l.status === 'pending' ? '#d97706' : '#dc2626',
                          fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                        }}>
                          {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Goals */}
            {data.goals.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#6366f115', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-bullseye" style={{ color: '#6366f1', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Goals</span>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {data.goals.map((g, i) => (
                    <div key={g._id} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: '#6366f115', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <i className="bi bi-bullseye" style={{ color: '#6366f1', fontSize: 16 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{g.title}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{g.kpi} • Target: {g.target}</div>
                        <span className="badge" style={{
                          marginTop: 4,
                          background: g.status === 'achieved' ? '#dcfce7' :
                                      g.status === 'missed' ? '#fee2e2' : '#dbeafe',
                          color: g.status === 'achieved' ? '#16a34a' :
                                 g.status === 'missed' ? '#dc2626' : '#3b82f6',
                          fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                        }}>
                          {g.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reviews */}
            {data.reviews.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#f59e0b15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-star" style={{ color: '#f59e0b', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Reviews</span>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {data.reviews.map((r, i) => (
                    <div key={r._id} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: '#f59e0b15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <i className="bi bi-star" style={{ color: '#f59e0b', fontSize: 16 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>Review: {r.cycle}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          Self: {r.selfScore ?? '—'} | Peer: {r.peerScore ?? '—'} | Manager: {r.managerScore ?? '—'} | Overall: {r.overall ?? '—'}
                        </div>
                        <span className="badge" style={{
                          marginTop: 4,
                          background: r.status === 'completed' ? '#dcfce7' :
                                      r.status === 'in_review' ? '#dbeafe' :
                                      r.status === 'improvement_plan' ? '#fef3c7' : '#f1f5f9',
                          color: r.status === 'completed' ? '#16a34a' :
                                 r.status === 'in_review' ? '#3b82f6' :
                                 r.status === 'improvement_plan' ? '#d97706' : '#64748b',
                          fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                        }}>
                          {r.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Announcements */}
            {data.announcements.length > 0 && (
              <div className="card mb-3" style={{ border: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: '#7c3aed15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className="bi bi-megaphone" style={{ color: '#7c3aed', fontSize: 14 }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Announcements</span>
                </div>
                <div style={{ padding: '8px 12px' }}>
                  {data.announcements.map((a, i) => (
                    <div key={a._id} style={{
                      padding: '14px 12px', margin: '4px 0', borderRadius: 10,
                      border: '1px solid #f1f5f9', display: 'flex', gap: 12, alignItems: 'flex-start',
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: '#7c3aed15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <i className="bi bi-megaphone" style={{ color: '#7c3aed', fontSize: 16 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{a.title}</div>
                        {a.body && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, whiteSpace: 'pre-line' }}>{a.body.slice(0, 200)}{a.body.length > 200 ? '...' : ''}</div>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          {a.tag && (
                            <span className="badge" style={{
                              background: (a.tagColor || '#3b82f6') + '20',
                              color: a.tagColor || '#3b82f6',
                              fontSize: 10, fontWeight: 600, padding: '2px 10px', borderRadius: 20,
                            }}>{a.tag}</span>
                          )}
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>By {a.author?.name || 'Unknown'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!data.attendance && !data.attendance?.workProgress?.length && data.tasks.length === 0 && data.leaves.length === 0 && data.goals.length === 0 && data.reviews.length === 0 && data.announcements.length === 0 && data.actions.length === 0 && (
              <div className="empty-state" style={{ padding: '60px 0' }}>
                <i className="bi bi-journal-text" />
                <h6>No activity recorded for this day</h6>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
