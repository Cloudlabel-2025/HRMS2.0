'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a', label: 'Present', icon: 'bi-check-circle' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent',  icon: 'bi-x-circle' },
  late:    { bg: '#fef3c7', color: '#d97706', label: 'Late',    icon: 'bi-clock' },
  leave:   { bg: '#dbeafe', color: '#2563eb', label: 'On Leave',icon: 'bi-calendar-check' },
};

export default function MonitoringPage() {
  const { user } = useAuth();
  const [team, setTeam] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDept, setFilterDept] = useState('');

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const [attendance, tasks, leaves] = await Promise.all([
          api.get(`/api/attendance?date=${today}`),
          api.get('/api/tasks'),
          api.get('/api/leave?status=approved'),
        ]);

        const attArr   = Array.isArray(attendance) ? attendance : [];
        const tasksArr = Array.isArray(tasks) ? tasks : [];
        const leaveArr = Array.isArray(leaves) ? leaves : [];

        // Build a map of userId → attendance record for today
        const attMap = {};
        for (const r of attArr) {
          const uid = r.userId?._id?.toString() || r.userId?.toString();
          if (uid) attMap[uid] = r;
        }

        // Find employees on approved leave today
        const onLeaveIds = new Set(
          leaveArr
            .filter(l => l.from <= today && l.to >= today)
            .map(l => l.userId?._id?.toString() || l.userId?.toString())
        );

        // Build per-employee task stats
        const taskMap = {};
        for (const t of tasksArr) {
          const uid = t.assignedTo?._id?.toString() || t.assignedTo?.toString();
          if (!uid) continue;
          if (!taskMap[uid]) taskMap[uid] = { total: 0, done: 0, overdue: [] };
          taskMap[uid].total++;
          if (t.status === 'Completed') taskMap[uid].done++;
          if (t.due && t.due < today && t.status !== 'Completed') taskMap[uid].overdue.push(t);
        }

        // Collect all unique employees from attendance + leave
        const empMap = {};
        for (const r of attArr) {
          const u = r.userId;
          if (!u?._id) continue;
          const uid = u._id.toString();
          const isLate = r.clockIn && r.clockIn > '09:30';
          empMap[uid] = {
            _id: uid, name: u.name, avatar: u.avatar, dept: u.department,
            status: isLate ? 'late' : 'present',
            clockIn: r.clockIn || '—',
            tasks: taskMap[uid] || { total: 0, done: 0, overdue: [] },
            lateFlag: isLate,
          };
        }
        // Add employees on leave who have no attendance record
        for (const l of leaveArr) {
          if (!(l.from <= today && l.to >= today)) continue;
          const u = l.userId;
          if (!u?._id) continue;
          const uid = u._id.toString();
          if (!empMap[uid]) {
            empMap[uid] = {
              _id: uid, name: u.name, avatar: u.avatar, dept: u.department,
              status: 'leave', clockIn: '—',
              tasks: taskMap[uid] || { total: 0, done: 0, overdue: [] },
              lateFlag: false,
            };
          }
        }

        const teamArr = Object.values(empMap);

        // Build alerts
        const alertList = [];
        for (const emp of teamArr) {
          if (emp.lateFlag) alertList.push({ type: 'late', icon: 'bi-clock', color: '#f59e0b', text: `${emp.name} logged in late (${emp.clockIn})`, time: emp.clockIn });
          for (const t of emp.tasks.overdue) alertList.push({ type: 'overdue', icon: 'bi-exclamation-triangle', color: '#ef4444', text: `Task "${t.title}" overdue — ${emp.name}`, time: t.due });
        }

        setTeam(teamArr);
        setAlerts(alertList.slice(0, 10));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const depts = [...new Set(team.map(e => e.dept).filter(Boolean))];
  const filtered = team.filter(e =>
    (!filterStatus || e.status === filterStatus) &&
    (!filterDept   || e.dept === filterDept)
  );

  const counts = {
    present: team.filter(e => e.status === 'present').length,
    late:    team.filter(e => e.status === 'late').length,
    absent:  team.filter(e => e.status === 'absent').length,
    leave:   team.filter(e => e.status === 'leave').length,
  };

  return (
    <AppShell title="Monitoring">
      <div className="page-header">
        <div><h4>Employee Monitoring</h4><p>Real-time attendance status, task completion, and alerts</p></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
          <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>Live</span>
        </div>
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Present', key: 'present', color: '#10b981', icon: 'bi-person-check' },
          { label: 'Late',    key: 'late',    color: '#f59e0b', icon: 'bi-clock' },
          { label: 'Absent',  key: 'absent',  color: '#ef4444', icon: 'bi-person-x' },
          { label: 'On Leave',key: 'leave',   color: '#3b82f6', icon: 'bi-calendar-check' },
        ].map(s => (
          <div key={s.key} className="col-6 col-xl-3">
            <div className="stat-card" style={{ cursor: 'pointer', border: filterStatus === s.key ? `2px solid ${s.color}` : '' }}
              onClick={() => setFilterStatus(filterStatus === s.key ? '' : s.key)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{counts[s.key]}</div>
                </div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <div className="row g-3">
          <div className="col-lg-8">
            <div className="card p-3">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div className="section-title" style={{ margin: 0 }}>Team Status</div>
                <select className="form-select" style={{ width: 160, fontSize: 12 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                  <option value="">All Departments</option>
                  {depts.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>

              {filtered.length === 0 && (
                <div className="empty-state"><i className="bi bi-people" /><h6>No attendance records for today</h6></div>
              )}

              <div className="row g-2">
                {filtered.map(emp => {
                  const style = STATUS_STYLE[emp.status] || STATUS_STYLE.absent;
                  const taskPct = emp.tasks.total > 0 ? Math.round((emp.tasks.done / emp.tasks.total) * 100) : 0;
                  return (
                    <div key={emp._id} className="col-md-6">
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ position: 'relative' }}>
                              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>{emp.avatar}</div>
                              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: style.color, border: '2px solid #fff' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.dept}</div>
                            </div>
                          </div>
                          <span className="badge" style={{ background: style.bg, color: style.color, fontSize: 10 }}>{style.label}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                          <span><i className="bi bi-clock me-1" />Login: {emp.clockIn}</span>
                          <span>{emp.tasks.done}/{emp.tasks.total} tasks</span>
                        </div>
                        {emp.tasks.total > 0 && (
                          <div className="progress">
                            <div className="progress-bar" style={{ width: `${taskPct}%`, background: taskPct >= 80 ? '#10b981' : taskPct >= 50 ? '#f59e0b' : '#ef4444' }} />
                          </div>
                        )}
                        {emp.lateFlag && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className="bi bi-exclamation-triangle" />Late login flagged
                          </div>
                        )}
                        {emp.tasks.overdue.length > 0 && (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <i className="bi bi-exclamation-circle" />{emp.tasks.overdue.length} overdue task{emp.tasks.overdue.length > 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="col-lg-4">
            <div className="card p-3">
              <div className="section-title mb-3">
                <i className="bi bi-bell me-2 text-danger" />Alerts & Flags
              </div>
              {alerts.length === 0
                ? <div className="empty-state" style={{ padding: '20px 0' }}><i className="bi bi-bell" /><h6>No alerts today</h6></div>
                : alerts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: a.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={`bi ${a.icon}`} style={{ color: a.color, fontSize: 13 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.4 }}>{a.text}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{a.time}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
