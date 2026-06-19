'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const RATING_COLOR = (r) => r >= 4.5 ? '#10b981' : r >= 3.5 ? '#3b82f6' : r >= 2.5 ? '#f59e0b' : '#ef4444';
const RATING_LABEL = (r) => r >= 4.5 ? 'Excellent' : r >= 3.5 ? 'Good' : r >= 2.5 ? 'Average' : 'Needs Improvement';
const STATUS_STYLE = {
  completed: { bg: '#dcfce7', color: '#16a34a', label: 'Completed' },
  in_review: { bg: '#dbeafe', color: '#2563eb', label: 'In Review' },
  improvement_plan: { bg: '#fee2e2', color: '#dc2626', label: 'PIP' },
  pending: { bg: '#fef3c7', color: '#d97706', label: 'Pending' },
};

function StarRating({ value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(i => <i key={i} className={`bi ${i <= Math.round(value) ? 'bi-star-fill' : 'bi-star'}`} style={{ color: '#f59e0b', fontSize: 12 }} />)}
      <span style={{ fontSize: 12, fontWeight: 700, color: RATING_COLOR(value), marginLeft: 4 }}>{value}</span>
    </div>
  );
}

function getCurrentCycle(payrollStartDay) {
  const d = new Date();
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  let cycleMonth, cycleYear;
  if (day >= payrollStartDay) {
    const next = new Date(year, month + 1, 1);
    cycleMonth = next.getMonth();
    cycleYear = next.getFullYear();
  } else {
    cycleMonth = month;
    cycleYear = year;
  }
  const quarter = Math.floor(cycleMonth / 3) + 1;
  return `C${quarter}${cycleYear}`;
}

function getCycleDateRange(payrollStartDay, payrollEndDay) {
  const d = new Date();
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  let cycleMonth, cycleYear;
  if (day >= payrollStartDay) {
    const next = new Date(year, month + 1, 1);
    cycleMonth = next.getMonth();
    cycleYear = next.getFullYear();
  } else {
    cycleMonth = month;
    cycleYear = year;
  }
  const quarterIndex = Math.floor(cycleMonth / 3);
  const quarterStartMonth = quarterIndex * 3;
  const quarterEndMonth = quarterStartMonth + 2;
  let startY, startM;
  if (quarterStartMonth === 0) {
    startY = cycleYear - 1;
    startM = 11;
  } else {
    startY = cycleYear;
    startM = quarterStartMonth - 1;
  }
  const endY = cycleYear;
  const endM = quarterEndMonth;
  const pad = n => String(n).padStart(2, '0');
  return {
    min: `${startY}-${pad(startM + 1)}-${pad(payrollStartDay)}`,
    max: `${endY}-${pad(endM + 1)}-${pad(payrollEndDay)}`,
  };
}

const EMPTY_GOAL = { title: '', target: '', progress: 0, cycle: '', userId: '' };
const EMPTY_REVIEW = { userId: '', cycle: '', projectId: '', taskId: '', selfScore: '', selfComment: '', peerScore: '', peerComment: '', managerScore: '', managerComment: '', status: 'pending' };

export default function PerformancePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [goals, setGoals] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showFeedback, setShowFeedback] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeGoals, setEmployeeGoals] = useState([]);
  const [loadingEmployeeGoals, setLoadingEmployeeGoals] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [editGoalForm, setEditGoalForm] = useState({ status: 'in_progress', progress: 0 });
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL);
  const [reviewForm, setReviewForm] = useState(EMPTY_REVIEW);
  const [reviewProjects, setReviewProjects] = useState([]);
  const [reviewTasks, setReviewTasks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [payrollStartDay, setPayrollStartDay] = useState(26);
  const [payrollEndDay, setPayrollEndDay] = useState(25);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [g, r, e, c] = await Promise.all([
        api.get('/api/performance/goals'),
        api.get('/api/performance/reviews'),
        isAdmin ? api.get('/api/employees') : Promise.resolve([]),
        api.get('/api/settings?type=config').catch(() => []),
      ]);
      setGoals(Array.isArray(g?.goals) ? g.goals : []);
      setReviews(Array.isArray(r?.reviews) ? r.reviews : []);
      setEmployees(Array.isArray(e) ? e : []);
      if (Array.isArray(c)) {
        const gc = c.find(i => i.key === 'global_config');
        if (gc?.value?.payrollStartDay) {
          const dayNum = Number(gc.value.payrollStartDay.split('-')[2]);
          if (dayNum >= 1 && dayNum <= 31) setPayrollStartDay(dayNum);
        }
        if (gc?.value?.payrollEndDay) {
          const dayNum = Number(gc.value.payrollEndDay.split('-')[2]);
          if (dayNum >= 1 && dayNum <= 31) setPayrollEndDay(dayNum);
        }
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (tab === 'employee-goals' && employees.length === 0) {
      (async () => {
        try {
          const e = await api.get('/api/employees');
          setEmployees(Array.isArray(e) ? e : []);
        } catch {}
      })();
    }
  }, [tab]);

  const saveGoal = async () => {
    if (!goalForm.title) return showToast('Goal title required', 'error');
    if (goalForm.title.length > 30) return showToast('Goal title must be at most 30 characters', 'error');
    if (!/^[a-zA-Z0-9]+$/.test(goalForm.title)) return showToast('Goal title must contain only letters and numbers', 'error');
    if (!goalForm.target) return showToast('Target date is required', 'error');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(goalForm.target) <= today) return showToast('Target date must be a future date', 'error');
    if (goalForm.target < targetDateMin || goalForm.target > targetDateMax) return showToast('Target date must be within the current cycle range', 'error');
    if (goalForm.progress < 0 || goalForm.progress > 100) return showToast('Progress must be between 0 and 100', 'error');
    setSaving(true);
    try {
      await api.post('/api/performance/goals', goalForm);
      showToast('Goal created');
      setShowGoalModal(false);
      setGoalForm(EMPTY_GOAL);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (goal) => {
    setEditGoal(goal);
    setEditGoalForm({ status: goal.status, progress: goal.progress });
  };

  const saveEdit = async () => {
    if (editGoalForm.progress < 0 || editGoalForm.progress > 100) return showToast('Progress must be between 0 and 100', 'error');
    if (!['in_progress', 'achieved', 'missed'].includes(editGoalForm.status)) return showToast('Invalid status', 'error');
    setSaving(true);
    try {
      await api.put(`/api/performance/goals/${editGoal._id}`, editGoalForm);
      showToast('Goal updated');
      setEditGoal(null);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveReview = async () => {
    if (!reviewForm.userId || !reviewForm.cycle) return showToast('Employee and cycle required', 'error');
    if (!reviewForm.projectId) return showToast('Project is required', 'error');
    if (!reviewForm.selfScore || !reviewForm.peerScore || !reviewForm.managerScore) return showToast('All scores (Self, Peer, Manager) are required', 'error');
    setSaving(true);
    try {
      await api.post('/api/performance/reviews', {
        ...reviewForm,
        selfScore: +reviewForm.selfScore,
        peerScore: +reviewForm.peerScore,
        managerScore: +reviewForm.managerScore,
      });
      showToast('Review submitted');
      setShowReviewModal(false);
      setReviewForm(EMPTY_REVIEW);
      setReviewProjects([]);
      setReviewTasks([]);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReviewEmployeeChange = async (userId) => {
    setReviewForm(p => ({ ...p, userId, projectId: '', taskId: '' }));
    setReviewTasks([]);
    if (!userId) { setReviewProjects([]); return; }
    try {
      const projects = await api.get('/api/projects');
      const filtered = Array.isArray(projects)
        ? projects.filter(p => p.team?.some(m => (m._id || m)?.toString() === userId))
        : [];
      setReviewProjects(filtered);
    } catch { setReviewProjects([]); }
  };

  const handleReviewProjectChange = async (projectId) => {
    setReviewForm(p => ({ ...p, projectId, taskId: '' }));
    if (!projectId || !reviewForm.userId) { setReviewTasks([]); return; }
    try {
      const data = await api.get(`/api/tasks?projectId=${projectId}`);
      const tasks = Array.isArray(data)
        ? data.filter(t => (t.assignedTo?._id || t.assignedTo)?.toString() === reviewForm.userId)
        : [];
      setReviewTasks(tasks);
    } catch { setReviewTasks([]); }
  };

  const selectEmployee = async (emp) => {
    setSelectedEmployee(emp);
    setLoadingEmployeeGoals(true);
    try {
      const g = await api.get(`/api/performance/goals?userId=${emp.userId || emp._id}`);
      setEmployeeGoals(Array.isArray(g?.goals) ? g.goals : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoadingEmployeeGoals(false);
    }
  };

  const myGoals = goals.filter(g => g.userId?._id === user?.id || g.userId === user?.id);

  const assignableEmployees = (() => {
    if (!user) return [];
    if (['super_admin', 'admin_full'].includes(user.role)) return employees;
    if (user.role === 'team_lead') return employees.filter(e => e.teamLeadId?.toString() === user.id || e.userId?.toString() === user.id);
    if (user.role === 'team_admin') return employees.filter(e => e.teamAdminId?.toString() === user.id || e.userId?.toString() === user.id);
    return [];
  })();

  const showAssigneeSelector = ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user?.role);
  const cycleRange = getCycleDateRange(payrollStartDay, payrollEndDay);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minTargetDate = tomorrow.toISOString().split('T')[0];
  const targetDateMin = minTargetDate < cycleRange.min ? cycleRange.min : minTargetDate;
  const targetDateMax = cycleRange.max;

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const filteredEmployees = employees.filter(e => {
    const matchDept = !departmentFilter || e.department === departmentFilter;
    const matchSearch = !searchQuery || e.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchDept && matchSearch;
  });
  const filteredReviews = reviews.filter(r => {
    const matchSearch = !searchQuery || r.userId?.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchDept = !departmentFilter || r.userId?.department === departmentFilter;
    return matchSearch && matchDept;
  });

  return (
    <AppShell title="Performance">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Performance Management</h4><p>Goals, KPIs, reviews, and appraisals</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline-primary" onClick={() => { setGoalForm(p => ({ ...p, cycle: getCurrentCycle(payrollStartDay) })); setShowGoalModal(true); }}><i className="bi bi-plus-lg me-2" />Set Goal</button>
          {isAdmin && <button className="btn btn-primary" onClick={() => { setReviewForm({ ...EMPTY_REVIEW, cycle: getCurrentCycle(payrollStartDay) }); setReviewProjects([]); setReviewTasks([]); setShowReviewModal(true); }}><i className="bi bi-plus-lg me-2" />Add Review</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'overview', label: 'My Goals' },
          { key: 'employee-goals', label: 'Employee Goals' },
          ...(isAdmin ? [{ key: 'reviews', label: 'Team Reviews' }, { key: 'analytics', label: 'Analytics' }] : [{ key: 'reviews', label: 'My Reviews' }]),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      {['employee-goals', 'reviews', 'analytics'].includes(tab) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <select className="form-select" style={{ width: 200 }} value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: 8, color: '#94a3b8', fontSize: 13 }} />
            <input className="form-control" style={{ paddingLeft: 30 }} placeholder="Search employees..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'overview' && (
            <div className="row g-3">
              {myGoals.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-graph-up-arrow" /><h6>No goals set yet</h6><p>Click "Set Goal" to add your first goal.</p></div></div>}
              {myGoals.map(goal => (
                <div key={goal._id} className="col-md-6">
                  <div className="card p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{goal.title}</div>
                        {goal.kpi && <div style={{ fontSize: 12, color: '#64748b' }}>KPI: {goal.kpi}</div>}
                        {goal.target && <div style={{ fontSize: 12, color: '#94a3b8' }}>Target: {goal.target}</div>}
                      </div>
                      <span className="badge" style={{ background: goal.status === 'achieved' ? '#dcfce7' : '#dbeafe', color: goal.status === 'achieved' ? '#16a34a' : '#2563eb' }}>
                        {goal.status === 'achieved' ? 'Achieved' : goal.status === 'missed' ? 'Missed' : 'In Progress'}
                      </span>
                      <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 8 }} onClick={() => openEdit(goal)}><i className="bi bi-pencil me-1" />Edit</button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                      <span>Progress</span><span style={{ fontWeight: 700, color: '#1e293b' }}>{goal.progress}%</span>
                    </div>
                    <div className="progress"><div className="progress-bar" style={{ width: `${goal.progress}%`, background: goal.progress === 100 ? '#10b981' : '#3b82f6' }} /></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'employee-goals' && (
            <div>
              {!selectedEmployee ? (
                <div className="row g-3">
                  {filteredEmployees.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-people" /><h6>No employees found</h6></div></div>}
                  {filteredEmployees.map(emp => (
                    <div key={emp._id} className="col-md-6">
                      <div className="card p-3" style={{ cursor: 'pointer' }} onClick={() => selectEmployee(emp)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                            {emp.name?.charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.department}{emp.designation ? ` — ${emp.designation}` : ''}</div>
                          </div>
                          <i className="bi bi-chevron-right ms-auto" style={{ color: '#94a3b8' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => { setSelectedEmployee(null); setEmployeeGoals([]); }}>
                      <i className="bi bi-arrow-left me-1" />Back
                    </button>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Goals — {selectedEmployee.name}</span>
                  </div>
                  {loadingEmployeeGoals ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
                  ) : employeeGoals.length === 0 ? (
                    <div className="empty-state"><i className="bi bi-graph-up-arrow" /><h6>No goals set</h6><p>This employee has no goals yet.</p></div>
                  ) : (
                    <div className="row g-3">
                      {employeeGoals.map(goal => (
                        <div key={goal._id} className="col-md-6">
                          <div className="card p-3">
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{goal.title}</div>
                            {goal.kpi && <div style={{ fontSize: 12, color: '#64748b' }}>KPI: {goal.kpi}</div>}
                            {goal.target && <div style={{ fontSize: 12, color: '#94a3b8' }}>Target: {goal.target}</div>}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginTop: 8, marginBottom: 6 }}>
                              <span>Progress</span><span style={{ fontWeight: 700, color: '#1e293b' }}>{goal.progress}%</span>
                            </div>
                            <div className="progress"><div className="progress-bar" style={{ width: `${goal.progress}%`, background: goal.progress === 100 ? '#10b981' : '#3b82f6' }} /></div>
                            <div style={{ marginTop: 6 }}>
                              <span className="badge" style={{ background: goal.status === 'achieved' ? '#dcfce7' : '#dbeafe', color: goal.status === 'achieved' ? '#16a34a' : '#2563eb' }}>
                                {goal.status === 'achieved' ? 'Achieved' : goal.status === 'missed' ? 'Missed' : 'In Progress'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'reviews' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Employee</th><th>Cycle</th><th>Project</th><th>Task</th><th>Self</th><th>Peer</th><th>Manager</th><th>Overall</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {filteredReviews.length === 0 ? (
                      <tr><td colSpan={10}><div className="empty-state"><i className="bi bi-graph-up-arrow" /><h6>No reviews yet</h6></div></td></tr>
                    ) : filteredReviews.map(r => (
                      <tr key={r._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{r.userId?.avatar}</div>
                            <div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{r.userId?.department}</div></div>
                          </div>
                        </td>
                        <td style={{ fontSize: 13 }}>{r.cycle}</td>
                        <td style={{ fontSize: 12 }}>{r.projectId?.name || '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.taskId?.title || '—'}</td>
                        <td>{r.selfScore ? <StarRating value={r.selfScore} /> : '—'}</td>
                        <td>{r.peerScore ? <StarRating value={r.peerScore} /> : '—'}</td>
                        <td>{r.managerScore ? <StarRating value={r.managerScore} /> : '—'}</td>
                        <td>{r.overall ? <><div style={{ fontWeight: 800, fontSize: 16, color: RATING_COLOR(r.overall) }}>{r.overall}</div><div style={{ fontSize: 10, color: '#94a3b8' }}>{RATING_LABEL(r.overall)}</div></> : '—'}</td>
                        <td><span className="badge" style={{ background: STATUS_STYLE[r.status]?.bg, color: STATUS_STYLE[r.status]?.color }}>{STATUS_STYLE[r.status]?.label}</span></td>
                        <td><button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setShowFeedback(r)}><i className="bi bi-eye me-1" />View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'analytics' && isAdmin && (
            <div className="row g-3">
              {[
                { label: 'Excellent (4.5+)', count: filteredReviews.filter(r => r.overall >= 4.5).length, color: '#10b981' },
                { label: 'Good (3.5–4.4)', count: filteredReviews.filter(r => r.overall >= 3.5 && r.overall < 4.5).length, color: '#3b82f6' },
                { label: 'Average (2.5–3.4)', count: filteredReviews.filter(r => r.overall >= 2.5 && r.overall < 3.5).length, color: '#f59e0b' },
                { label: 'Needs Improvement', count: filteredReviews.filter(r => r.overall < 2.5).length, color: '#ef4444' },
              ].map((s, i) => (
                <div key={i} className="col-6 col-xl-3">
                  <div className="stat-card" style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 36, fontWeight: 800, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.label}</div>
                  </div>
                </div>
              ))}
              <div className="col-12">
                <div className="card p-3">
                  <div className="section-title mb-3">Team Performance Overview</div>
                  <div className="table-responsive">
                    <table className="table mb-0">
                      <thead><tr><th>Employee</th><th>Project</th><th>Task</th><th>Overall Rating</th><th>Rating</th><th>Status</th></tr></thead>
                      <tbody>
                        {filteredReviews.filter(r => r.overall).sort((a, b) => b.overall - a.overall).map(r => (
                          <tr key={r._id}>
                            <td style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</td>
                            <td style={{ fontSize: 12 }}>{r.projectId?.name || '—'}</td>
                            <td style={{ fontSize: 12 }}>{r.taskId?.title || '—'}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className="progress" style={{ flex: 1, height: 8 }}><div className="progress-bar" style={{ width: `${(r.overall / 5) * 100}%`, background: RATING_COLOR(r.overall) }} /></div>
                                <span style={{ fontSize: 13, fontWeight: 700, color: RATING_COLOR(r.overall), minWidth: 30 }}>{r.overall}</span>
                              </div>
                            </td>
                            <td style={{ fontSize: 12, color: RATING_COLOR(r.overall), fontWeight: 600 }}>{RATING_LABEL(r.overall)}</td>
                            <td><span className="badge" style={{ background: STATUS_STYLE[r.status]?.bg, color: STATUS_STYLE[r.status]?.color }}>{STATUS_STYLE[r.status]?.label}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showFeedback && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content p-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <h5 style={{ margin: 0 }}>360° Review — {showFeedback.userId?.name}</h5>
                <button className="btn-close" onClick={() => setShowFeedback(null)} />
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16, display: 'flex', gap: 16 }}>
                <span>Cycle: <strong>{showFeedback.cycle}</strong></span>
                {showFeedback.projectId?.name && <span>Project: <strong>{showFeedback.projectId.name}</strong></span>}
                {showFeedback.taskId?.title && <span>Task: <strong>{showFeedback.taskId.title}</strong></span>}
              </div>
              {[['Self Review', showFeedback.selfScore, showFeedback.selfComment],
                ['Peer Review', showFeedback.peerScore, showFeedback.peerComment],
                ['Manager Review', showFeedback.managerScore, showFeedback.managerComment]].map(([label, score, comment]) => score ? (
                <div key={label} style={{ marginBottom: 16, padding: 14, background: '#f8fafc', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{label}</span>
                    <StarRating value={score} />
                  </div>
                  {comment && <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{comment}</p>}
                </div>
              ) : null)}
              {showFeedback.overall && (
                <div style={{ background: `${RATING_COLOR(showFeedback.overall)}15`, borderRadius: 10, padding: 14, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Overall Rating</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: RATING_COLOR(showFeedback.overall) }}>{showFeedback.overall}</div>
                  <div style={{ fontSize: 13, color: RATING_COLOR(showFeedback.overall), fontWeight: 600 }}>{RATING_LABEL(showFeedback.overall)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editGoal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Edit Goal — {editGoal.title}</h5><button className="btn-close" onClick={() => setEditGoal(null)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label>
                    <select className="form-select" value={editGoalForm.status} onChange={e => setEditGoalForm(p => ({ ...p, status: e.target.value }))}>
                      <option value="in_progress">In Progress</option>
                      <option value="achieved">Achieved</option>
                      <option value="missed">Missed</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Progress %</label>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <input type="range" min="0" max="100" className="form-range" style={{ flex: 1 }} value={editGoalForm.progress} onChange={e => setEditGoalForm(p => ({ ...p, progress: +e.target.value }))} />
                      <span style={{ fontWeight: 700, fontSize: 14, minWidth: 36 }}>{editGoalForm.progress}%</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setEditGoal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Update Goal'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showGoalModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Set Goal</h5><button className="btn-close" onClick={() => { setShowGoalModal(false); setGoalForm(EMPTY_GOAL); }} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Goal Title *</label><input className="form-control" maxLength={30} value={goalForm.title} onChange={e => setGoalForm(p => ({ ...p, title: e.target.value.replace(/[^a-zA-Z0-9]/g, '') }))} /></div>
                  {showAssigneeSelector && <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Assign To</label><select className="form-select" value={goalForm.userId} onChange={e => setGoalForm(p => ({ ...p, userId: e.target.value }))}><option value="">Myself</option>{assignableEmployees.filter(e => e.userId?.toString() !== user?.id).map(e => <option key={e._id} value={e.userId}>{e.name}</option>)}</select></div>}
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Target Date *</label><input type="date" className="form-control" min={targetDateMin} max={targetDateMax} value={goalForm.target} onChange={e => setGoalForm(p => ({ ...p, target: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Cycle</label><input className="form-control" value={goalForm.cycle} disabled style={{ background: '#f1f5f9', cursor: 'not-allowed' }} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Progress %</label><input type="number" min="0" max="100" className="form-control" value={goalForm.progress} onChange={e => setGoalForm(p => ({ ...p, progress: +e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => { setShowGoalModal(false); setGoalForm(EMPTY_GOAL); }}>Cancel</button>
                <button className="btn btn-primary" onClick={saveGoal} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save Goal'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Review</h5><button className="btn-close" onClick={() => { setShowReviewModal(false); setReviewForm(EMPTY_REVIEW); setReviewProjects([]); setReviewTasks([]); }} /></div>
              <div className="modal-body">
                <div className="row g-3">
                   <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employee *</label><select className="form-select" value={reviewForm.userId} onChange={e => handleReviewEmployeeChange(e.target.value)}><option value="">Select</option>{assignableEmployees.filter(e => e.userId?.toString() !== user?.id).map(e => <option key={e._id} value={e.userId}>{e.name}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Cycle</label><input className="form-control" value={reviewForm.cycle} disabled style={{ background: '#f1f5f9', cursor: 'not-allowed' }} /></div>
                  {reviewForm.userId && reviewProjects.length > 0 && <>
                    <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Project *</label><select className="form-select" value={reviewForm.projectId} onChange={e => handleReviewProjectChange(e.target.value)}><option value="">Select</option>{reviewProjects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select></div>
                    {reviewForm.projectId && <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Task</label><select className="form-select" value={reviewForm.taskId} onChange={e => setReviewForm(p => ({ ...p, taskId: e.target.value }))}><option value="">Select</option>{reviewTasks.map(t => <option key={t._id} value={t._id}>{t.title}</option>)}</select></div>}
                  </>}
                  {[['Self Score *', 'selfScore'], ['Peer Score *', 'peerScore'], ['Manager Score *', 'managerScore']].map(([label, key]) => (
                    <div key={key} className="col-4"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label><select className="form-select" value={reviewForm[key]} onChange={e => setReviewForm(p => ({ ...p, [key]: e.target.value }))}><option value="">Select</option>{[0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                  ))}
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Manager Comment</label><textarea className="form-control" rows={2} value={reviewForm.managerComment} onChange={e => setReviewForm(p => ({ ...p, managerComment: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label><select className="form-select" value={reviewForm.status} onChange={e => setReviewForm(p => ({ ...p, status: e.target.value }))}>{['pending', 'in_review', 'completed', 'improvement_plan'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => { setShowReviewModal(false); setReviewForm(EMPTY_REVIEW); setReviewProjects([]); setReviewTasks([]); }}>Cancel</button>
                <button className="btn btn-primary" onClick={saveReview} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Submit Review'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
