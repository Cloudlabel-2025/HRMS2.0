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

const EMPTY_GOAL = { title: '', kpi: '', target: '', progress: 0, cycle: '', userId: '' };
const EMPTY_REVIEW = { userId: '', cycle: '', selfScore: '', selfComment: '', peerScore: '', peerComment: '', managerScore: '', managerComment: '', status: 'pending' };

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
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL);
  const [reviewForm, setReviewForm] = useState(EMPTY_REVIEW);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [g, r, e] = await Promise.all([
        api.get('/api/performance/goals'),
        api.get('/api/performance/reviews'),
        isAdmin ? api.get('/api/employees') : Promise.resolve([]),
      ]);
      setGoals(Array.isArray(g?.goals) ? g.goals : []);
      setReviews(Array.isArray(r?.reviews) ? r.reviews : []);
      setEmployees(Array.isArray(e) ? e : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const saveGoal = async () => {
    if (!goalForm.title) return showToast('Goal title required', 'error');
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

  const saveReview = async () => {
    if (!reviewForm.userId || !reviewForm.cycle) return showToast('Employee and cycle required', 'error');
    setSaving(true);
    try {
      await api.post('/api/performance/reviews', {
        ...reviewForm,
        selfScore: +reviewForm.selfScore || undefined,
        peerScore: +reviewForm.peerScore || undefined,
        managerScore: +reviewForm.managerScore || undefined,
      });
      showToast('Review submitted');
      setShowReviewModal(false);
      setReviewForm(EMPTY_REVIEW);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
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

  return (
    <AppShell title="Performance">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Performance Management</h4><p>Goals, KPIs, reviews, and appraisals</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline-primary" onClick={() => setShowGoalModal(true)}><i className="bi bi-plus-lg me-2" />Set Goal</button>
          {isAdmin && <button className="btn btn-primary" onClick={() => setShowReviewModal(true)}><i className="bi bi-plus-lg me-2" />Add Review</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { key: 'overview', label: 'My Goals' },
          ...(isAdmin ? [{ key: 'reviews', label: 'Team Reviews' }, { key: 'analytics', label: 'Analytics' }] : [{ key: 'reviews', label: 'My Reviews' }]),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

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

          {tab === 'reviews' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Employee</th><th>Cycle</th><th>Self</th><th>Peer</th><th>Manager</th><th>Overall</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {reviews.length === 0 ? (
                      <tr><td colSpan={8}><div className="empty-state"><i className="bi bi-graph-up-arrow" /><h6>No reviews yet</h6></div></td></tr>
                    ) : reviews.map(r => (
                      <tr key={r._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{r.userId?.avatar}</div>
                            <div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{r.userId?.department}</div></div>
                          </div>
                        </td>
                        <td style={{ fontSize: 13 }}>{r.cycle}</td>
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
                { label: 'Excellent (4.5+)', count: reviews.filter(r => r.overall >= 4.5).length, color: '#10b981' },
                { label: 'Good (3.5–4.4)', count: reviews.filter(r => r.overall >= 3.5 && r.overall < 4.5).length, color: '#3b82f6' },
                { label: 'Average (2.5–3.4)', count: reviews.filter(r => r.overall >= 2.5 && r.overall < 3.5).length, color: '#f59e0b' },
                { label: 'Needs Improvement', count: reviews.filter(r => r.overall < 2.5).length, color: '#ef4444' },
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
                      <thead><tr><th>Employee</th><th>Overall Rating</th><th>Rating</th><th>Status</th></tr></thead>
                      <tbody>
                        {reviews.filter(r => r.overall).sort((a, b) => b.overall - a.overall).map(r => (
                          <tr key={r._id}>
                            <td style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</td>
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

      {showGoalModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Set Goal</h5><button className="btn-close" onClick={() => setShowGoalModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Goal Title *</label><input className="form-control" value={goalForm.title} onChange={e => setGoalForm(p => ({ ...p, title: e.target.value }))} /></div>
                  {showAssigneeSelector && <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Assign To</label><select className="form-select" value={goalForm.userId} onChange={e => setGoalForm(p => ({ ...p, userId: e.target.value }))}><option value="">Myself</option>{assignableEmployees.filter(e => e.userId?.toString() !== user?.id).map(e => <option key={e._id} value={e.userId}>{e.name}</option>)}</select></div>}
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>KPI</label><input className="form-control" value={goalForm.kpi} onChange={e => setGoalForm(p => ({ ...p, kpi: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Target Date</label><input className="form-control" value={goalForm.target} onChange={e => setGoalForm(p => ({ ...p, target: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Cycle</label><input className="form-control" placeholder="e.g. Q3 2025" value={goalForm.cycle} onChange={e => setGoalForm(p => ({ ...p, cycle: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Progress %</label><input type="number" min="0" max="100" className="form-control" value={goalForm.progress} onChange={e => setGoalForm(p => ({ ...p, progress: +e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowGoalModal(false)}>Cancel</button>
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
              <div className="modal-header"><h5 className="modal-title">Add Review</h5><button className="btn-close" onClick={() => setShowReviewModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employee *</label><select className="form-select" value={reviewForm.userId} onChange={e => setReviewForm(p => ({ ...p, userId: e.target.value }))}><option value="">Select</option>{assignableEmployees.filter(e => e.userId?.toString() !== user?.id).map(e => <option key={e._id} value={e.userId}>{e.name}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Cycle *</label><input className="form-control" placeholder="e.g. Q2 2025" value={reviewForm.cycle} onChange={e => setReviewForm(p => ({ ...p, cycle: e.target.value }))} /></div>
                  {[['Self Score (1-5)', 'selfScore'], ['Peer Score (1-5)', 'peerScore'], ['Manager Score (1-5)', 'managerScore']].map(([label, key]) => (
                    <div key={key} className="col-4"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label><input type="number" min="1" max="5" step="0.1" className="form-control" value={reviewForm[key]} onChange={e => setReviewForm(p => ({ ...p, [key]: e.target.value }))} /></div>
                  ))}
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Manager Comment</label><textarea className="form-control" rows={2} value={reviewForm.managerComment} onChange={e => setReviewForm(p => ({ ...p, managerComment: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label><select className="form-select" value={reviewForm.status} onChange={e => setReviewForm(p => ({ ...p, status: e.target.value }))}>{['pending', 'in_review', 'completed', 'improvement_plan'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowReviewModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveReview} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Submit Review'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
