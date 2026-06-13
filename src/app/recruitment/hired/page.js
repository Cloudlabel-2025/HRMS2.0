'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

export default function HiredRecruitmentPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [applicants, setApplicants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmAddModal, setConfirmAddModal] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    Promise.all([
      api.get('/api/recruitment/jobs'),
      api.get('/api/recruitment/applicants'),
    ])
      .then(([j, a]) => {
        setJobs(Array.isArray(j) ? j : []);
        setApplicants(Array.isArray(a) ? a.filter(x => x.stage === 'Hired') : []);
      })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  const registerApplicant = (app) => {
    const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
    sessionStorage.setItem('hrms_hire_prefill', JSON.stringify({
      sourceApplicantId: app._id,
      name: app.name,
      email: app.email,
      phone: app.phone || '',
      department: job?.department || '',
      designation: job?.title || '',
      skills: (app.skills || []).join(', '),
    }));
    router.push('/employees');
  };

  const confirmAddToOrganization = () => {
    if (!confirmAddModal) return;
    registerApplicant(confirmAddModal);
    setConfirmAddModal(null);
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    const reason = rejectReason.trim();
    if (!reason) return showToast('Rejection reason is required', 'error');
    setSaving(true);
    try {
      const updated = await api.put('/api/recruitment/applicants', { id: rejectModal._id, stage: 'Rejected', rejectionReason: reason });
      setApplicants(prev => prev.filter(a => a._id !== updated._id));
      showToast('Candidate rejected');
      setRejectModal(null);
      setRejectReason('');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const pendingCount = applicants.filter(app => !app.onboardedAt).length;

  return (
    <AppShell title="Hired Candidates">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}
      <div className="page-header">
        <div>
          <h4>Hired Candidates</h4>
          <p>Candidates marked hired and their organization onboarding status.</p>
        </div>
        <div style={{ marginLeft: 'auto', color: '#64748b', fontSize: 13, fontWeight: 600 }}>
          {pendingCount} pending
        </div>
        <button className="btn btn-outline-secondary" onClick={() => router.push('/recruitment')}>
          <i className="bi bi-arrow-left" />Recruitment
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
        ) : applicants.length === 0 ? (
          <div className="empty-state"><i className="bi bi-person-check" /><h6>No hired candidates found</h6></div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead><tr><th>Candidate</th><th>Role</th><th>Referral</th><th>Experience</th><th>Action</th></tr></thead>
              <tbody>
                {applicants.map(app => {
                  const job = jobs.find(j => j._id === app.jobId || j._id === app.jobId?._id);
                  return (
                    <tr key={app._id}>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{app.name}</div>
                        <div style={{ color: '#94a3b8', fontSize: 11 }}>{app.email}</div>
                        {app.phone && <div style={{ color: '#94a3b8', fontSize: 11 }}>{app.phone}</div>}
                        {app.previousRejection?.matchedBy && <span className="badge mt-1" style={{ background: '#fee2e2', color: '#dc2626' }}>Prior rejection</span>}
                      </td>
                      <td style={{ fontSize: 13 }}>{job?.title || '-'}</td>
                      <td style={{ fontSize: 12 }}>{app.referralName || '-'}{app.referralFromOffice && <span className="badge ms-2" style={{ background: '#eff6ff', color: '#2563eb' }}>Office</span>}</td>
                      <td style={{ fontSize: 12 }}>{app.isFresher ? 'Fresher' : `${app.experienceYears || 0} yr(s)`}</td>
                      <td>
                        {app.onboardedAt ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
                            <i className="bi bi-check-circle-fill" style={{ color: '#16a34a', fontSize: 14 }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>Added to Organization</span>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-sm btn-primary" onClick={() => setConfirmAddModal(app)}><i className="bi bi-person-plus me-1" />Add to Organization</button>
                            <button className="btn btn-sm btn-outline-danger" onClick={() => { setRejectModal(app); setRejectReason(''); }}><i className="bi bi-x-circle me-1" />Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejectModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Reject Hired Candidate</h5>
                <button className="btn-close" onClick={() => setRejectModal(null)} />
              </div>
              <div className="modal-body">
                <p style={{ color: '#64748b', fontSize: 13 }}>Reject <strong>{rejectModal.name}</strong> and keep the reason for future email or phone matches.</p>
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason *</label>
                <textarea className="form-control" rows={4} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Why is this hired candidate being rejected?" />
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setRejectModal(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={confirmReject} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Rejecting...</> : 'Confirm Reject'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmAddModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add to Organization</h5>
                <button className="btn-close" onClick={() => setConfirmAddModal(null)} />
              </div>
              <div className="modal-body">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12, border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 8, marginBottom: 16 }}>
                  <i className="bi bi-info-circle" style={{ color: '#2563eb', fontSize: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#1e40af', marginBottom: 4 }}>Add this candidate to the organization?</div>
                    <div style={{ fontSize: 12, color: '#1e3a8a' }}>This will open the employee creation form with candidate details prefilled.</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{confirmAddModal.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{confirmAddModal.email}</div>
                {confirmAddModal.phone && <div style={{ fontSize: 12, color: '#64748b' }}>{confirmAddModal.phone}</div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setConfirmAddModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmAddToOrganization}><i className="bi bi-check-lg me-2" />Confirm Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
