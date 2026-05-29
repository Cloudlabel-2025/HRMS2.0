'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
const STAGE_COLORS = { Applied: '#64748b', Screening: '#3b82f6', Interview: '#f59e0b', Offer: '#8b5cf6', Hired: '#10b981', Rejected: '#ef4444' };
const DEPTS = ['Engineering', 'HR', 'Finance', 'Design', 'Marketing', 'Operations', 'Sales'];
const EMPTY_JOB = { title: '', department: 'Engineering', type: 'Full-time', status: 'active' };
const EMPTY_APP = { name: '', email: '', jobId: '', score: '' };

export default function RecruitmentPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showJobModal, setShowJobModal] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);
  const [jobForm, setJobForm] = useState(EMPTY_JOB);
  const [appForm, setAppForm] = useState(EMPTY_APP);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full', 'recruiter'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [j, a] = await Promise.all([
        api.get('/api/recruitment/jobs'),
        api.get('/api/recruitment/applicants'),
      ]);
      setJobs(Array.isArray(j) ? j : []);
      setApplicants(Array.isArray(a) ? a : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const saveJob = async () => {
    if (!jobForm.title) return showToast('Job title required', 'error');
    setSaving(true);
    try {
      await api.post('/api/recruitment/jobs', jobForm);
      showToast('Job posted');
      setShowJobModal(false);
      setJobForm(EMPTY_JOB);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveApplicant = async () => {
    if (!appForm.name || !appForm.email || !appForm.jobId) return showToast('Name, email and job required', 'error');
    setSaving(true);
    try {
      await api.post('/api/recruitment/applicants', { ...appForm, score: +appForm.score || 0 });
      showToast('Applicant added');
      setShowAppModal(false);
      setAppForm(EMPTY_APP);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const moveStage = async (id, stage) => {
    try {
      await api.put('/api/recruitment/applicants', { id, stage });
      setApplicants(prev => prev.map(a => a._id === id ? { ...a, stage } : a));
      showToast(`Moved to ${stage}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <AppShell title="Recruitment">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Recruitment</h4><p>{jobs.filter(j => j.status === 'active').length} open positions · {applicants.length} total applicants</p></div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline-primary" onClick={() => setShowAppModal(true)}><i className="bi bi-person-plus me-2" />Add Applicant</button>
            <button className="btn btn-primary" onClick={() => setShowJobModal(true)}><i className="bi bi-plus-lg me-2" />Post Job</button>
          </div>
        )}
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Open Positions', value: jobs.filter(j => j.status === 'active').length, color: '#3b82f6', icon: 'bi-briefcase' },
          { label: 'Total Applicants', value: applicants.length, color: '#8b5cf6', icon: 'bi-people' },
          { label: 'In Interview', value: applicants.filter(a => a.stage === 'Interview').length, color: '#f59e0b', icon: 'bi-chat-dots' },
          { label: 'Offers / Hired', value: applicants.filter(a => ['Offer', 'Hired'].includes(a.stage)).length, color: '#10b981', icon: 'bi-envelope-check' },
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

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['jobs', 'pipeline', 'applicants'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'jobs' ? 'Job Postings' : t === 'pipeline' ? 'Pipeline' : 'All Applicants'}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'jobs' && (
            <div className="row g-3">
              {jobs.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-briefcase" /><h6>No job postings yet</h6></div></div>}
              {jobs.map(job => (
                <div key={job._id} className="col-md-6">
                  <div className="card p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div><div style={{ fontWeight: 700, fontSize: 15 }}>{job.title}</div><div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{job.department} · {job.type}</div></div>
                      <span className={`badge ${job.status === 'active' ? 'status-approved' : 'status-rejected'}`}>{job.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                      <span><i className="bi bi-calendar3 me-1" />Posted {new Date(job.createdAt).toLocaleDateString()}</span>
                      <span><i className="bi bi-people me-1" />{applicants.filter(a => a.jobId === job._id || a.jobId?._id === job._id).length} applicants</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'pipeline' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {STAGES.map(stage => {
                const stageApps = applicants.filter(a => a.stage === stage);
                return (
                  <div key={stage} className="kanban-col">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[stage] }} />
                        <span style={{ fontWeight: 700, fontSize: 12 }}>{stage}</span>
                      </div>
                      <span style={{ background: '#e2e8f0', color: '#64748b', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{stageApps.length}</span>
                    </div>
                    {stageApps.map(app => (
                      <div key={app._id} className="kanban-card">
                        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{app.name}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>{app.email}</div>
                        {app.score > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: app.score >= 80 ? '#10b981' : app.score >= 65 ? '#f59e0b' : '#ef4444', marginBottom: 8 }}>Score: {app.score}</div>}
                        {isAdmin && (
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {STAGES.filter(s => s !== stage).slice(0, 2).map(s => (
                              <button key={s} onClick={() => moveStage(app._id, s)}
                                style={{ fontSize: 9, padding: '2px 5px', borderRadius: 4, border: `1px solid ${STAGE_COLORS[s]}40`, background: STAGE_COLORS[s] + '10', color: STAGE_COLORS[s], cursor: 'pointer' }}>
                                → {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'applicants' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Applicant</th><th>Job</th><th>Applied</th><th>Stage</th><th>Score</th>{isAdmin && <th>Move Stage</th>}</tr></thead>
                  <tbody>
                    {applicants.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-people" /><h6>No applicants yet</h6></div></td></tr>
                    ) : applicants.map(app => {
                      const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
                      return (
                        <tr key={app._id}>
                          <td><div style={{ fontSize: 13, fontWeight: 600 }}>{app.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{app.email}</div></td>
                          <td style={{ fontSize: 13 }}>{job?.title || '—'}</td>
                          <td style={{ fontSize: 12, color: '#64748b' }}>{new Date(app.createdAt).toLocaleDateString()}</td>
                          <td><span className="badge" style={{ background: STAGE_COLORS[app.stage] + '20', color: STAGE_COLORS[app.stage] }}>{app.stage}</span></td>
                          <td><span style={{ fontWeight: 700, color: app.score >= 80 ? '#10b981' : app.score >= 65 ? '#f59e0b' : '#ef4444' }}>{app.score || '—'}</span></td>
                          {isAdmin && (
                            <td>
                              <select className="form-select form-select-sm" style={{ fontSize: 11, width: 120 }} value={app.stage} onChange={e => moveStage(app._id, e.target.value)}>
                                {STAGES.map(s => <option key={s}>{s}</option>)}
                              </select>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showJobModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Post Job</h5><button className="btn-close" onClick={() => setShowJobModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job Title *</label><input className="form-control" value={jobForm.title} onChange={e => setJobForm(p => ({ ...p, title: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Department</label><select className="form-select" value={jobForm.department} onChange={e => setJobForm(p => ({ ...p, department: e.target.value }))}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Type</label><select className="form-select" value={jobForm.type} onChange={e => setJobForm(p => ({ ...p, type: e.target.value }))}>{['Full-time', 'Part-time', 'Contract', 'Intern'].map(t => <option key={t}>{t}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowJobModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveJob} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Posting...</> : 'Post Job'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAppModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Applicant</h5><button className="btn-close" onClick={() => setShowAppModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Name *</label><input className="form-control" value={appForm.name} onChange={e => setAppForm(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Email *</label><input type="email" className="form-control" value={appForm.email} onChange={e => setAppForm(p => ({ ...p, email: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Job *</label><select className="form-select" value={appForm.jobId} onChange={e => setAppForm(p => ({ ...p, jobId: e.target.value }))}><option value="">Select job</option>{jobs.map(j => <option key={j._id} value={j._id}>{j.title}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Score (0-100)</label><input type="number" className="form-control" value={appForm.score} onChange={e => setAppForm(p => ({ ...p, score: e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowAppModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveApplicant} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Add Applicant'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
