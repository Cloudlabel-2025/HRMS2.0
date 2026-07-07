'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

function InfoRow({ icon, label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #3b82f615, #8b5cf608)', border: '1px solid #3b82f610', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 14 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 20 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
        <h6 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: '#0f172a' }}>{title}</h6>
      </div>
      <div style={{ padding: '12px 20px 8px' }}>
        {children}
      </div>
    </div>
  );
}

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave', 'Paternity Leave', 'Compensatory Leave', 'Loss of Pay'];

export default function SMEProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [sme, setSme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type: 'Casual Leave', from: '', to: '', reason: '' });
  const [leaveSaving, setLeaveSaving] = useState(false);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const applyLeave = async () => {
    if (!leaveForm.from || !leaveForm.to || !leaveForm.reason) return showToast('All fields are required', 'error');
    if (leaveForm.reason.length < 10) return showToast('Reason must be at least 10 characters', 'error');
    setLeaveSaving(true);
    try {
      await api.post('/api/leave', leaveForm);
      showToast('Leave request submitted successfully');
      setShowLeaveModal(false);
      setLeaveForm({ type: 'Casual Leave', from: '', to: '', reason: '' });
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLeaveSaving(false);
    }
  };

  const canRequestLeave = user?.role === 'sme' && sme?.userId === user?._id;

  useEffect(() => {
    if (!id) return;
    api.get(`/api/sme/${id}`)
      .then(res => setSme(res.sme))
      .catch(e => { showToast(e.message, 'error'); setTimeout(() => router.push('/sme'), 2000); })
      .finally(() => setLoading(false));
  }, [id, router]);

  if (user && user.role !== 'super_admin' && user.role !== 'sme') return (
    <AppShell title="SME Profile">
      <div className="empty-state"><i className="bi bi-person-gear" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>SME profiles are only accessible to Super Admin and Management Admin.</p></div>
    </AppShell>
  );

  if (loading) return (
    <AppShell title="SME Profile">
      <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  if (!sme) return (
    <AppShell title="SME Profile">
      <div className="empty-state"><i className="bi bi-person-gear" /><h6>SME not found</h6></div>
    </AppShell>
  );

  return (
    <AppShell title={sme.name}>
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button className="btn btn-outline-secondary btn-sm" onClick={() => router.push(user?.role === 'sme' ? '/self-service' : '/sme')} style={{ borderRadius: 8, fontSize: 12 }}>
          <i className="bi bi-arrow-left me-1" />Back
        </button>
        {canRequestLeave && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowLeaveModal(true)} style={{ borderRadius: 8, fontSize: 12, background: '#0891b2', borderColor: '#0891b2' }}>
            <i className="bi bi-send me-1" />Request Leave
          </button>
        )}
      </div>

      {/* Header */}
      <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ padding: '28px 28px', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 26, fontWeight: 700, flexShrink: 0 }}>
            {sme.name[0]}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h4 style={{ fontWeight: 700, margin: 0 }}>{sme.name}</h4>
              <span className={`badge ${sme.status === 'active' ? 'status-approved' : 'status-pending'}`} style={{ fontSize: 11 }}>{sme.status}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 13, color: '#64748b' }}>
              <span><i className="bi bi-envelope me-1" />{sme.email}</span>
              {sme.phone && <span><i className="bi bi-telephone me-1" />{sme.phone}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-md-6">
          <Section title="Personal Information">
            <InfoRow icon="bi-person" label="Full Name" value={sme.name} />
            <InfoRow icon="bi-envelope" label="Email" value={sme.email} />
            <InfoRow icon="bi-telephone" label="Phone" value={sme.phone} />
            <InfoRow icon="bi-cake" label="Date of Birth" value={sme.dob ? new Date(sme.dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
            <InfoRow icon="bi-credit-card-2-front" label="PAN Number" value={sme.pan} />
            <InfoRow icon="bi-stars" label="Expertise" value={Array.isArray(sme.expertise) && sme.expertise.length ? sme.expertise.join(', ') : null} />
            <InfoRow icon="bi-building" label="Departments" value={Array.isArray(sme.departments) && sme.departments.length ? sme.departments.join(', ') : null} />
          </Section>
        </div>
        <div className="col-md-6">
          <Section title="Account Details">
            <InfoRow icon="bi-bank" label="Bank Name" value={sme.accountDetails?.bankName} />
            <InfoRow icon="bi-person-badge" label="Account Holder" value={sme.accountDetails?.accountHolder} />
            <InfoRow icon="bi-credit-card" label="Account Number" value={sme.accountDetails?.accountNumber} />
            <InfoRow icon="bi-upc-scan" label="IFSC / Routing Code" value={sme.accountDetails?.ifscCode} />
          </Section>

          <Section title="Contract & Rate">
            <InfoRow icon="bi-cash-stack" label="Rate" value={sme.rate?.amount > 0 ? `₹${sme.rate.amount}/${sme.rate.type === 'hourly' ? 'hr' : sme.rate.type === 'daily' ? 'day' : sme.rate.type}` : null} />
            <InfoRow icon="bi-calendar-check" label="Contract Start" value={sme.contractStart ? new Date(sme.contractStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
            <InfoRow icon="bi-calendar-x" label="Contract End" value={sme.contractEnd ? new Date(sme.contractEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
            <InfoRow icon="bi-clock" label="Created" value={sme.createdAt ? new Date(sme.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
          </Section>
        </div>
      </div>
      {/* Leave Request Modal */}
      {showLeaveModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: 16 }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', padding: '20px 24px' }}>
                <h5 className="modal-title" style={{ fontWeight: 700 }}><i className="bi bi-send me-2" />Request Leave</h5>
                <button className="btn-close" onClick={() => setShowLeaveModal(false)} />
              </div>
              <div className="modal-body" style={{ padding: 24 }}>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Leave Type</label>
                    <select className="form-select" value={leaveForm.type} onChange={e => setLeaveForm(p => ({ ...p, type: e.target.value }))}>
                      {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>From Date *</label>
                    <input type="date" className="form-control" value={leaveForm.from} onChange={e => setLeaveForm(p => ({ ...p, from: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>To Date *</label>
                    <input type="date" className="form-control" value={leaveForm.to} onChange={e => setLeaveForm(p => ({ ...p, to: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Reason *</label>
                    <textarea className="form-control" rows={3} placeholder="Reason for leave (min 10 characters)" value={leaveForm.reason} onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
                <button className="btn btn-outline-secondary" onClick={() => setShowLeaveModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={applyLeave} disabled={leaveSaving} style={{ background: '#0891b2', borderColor: '#0891b2' }}>
                  {leaveSaving ? <><span className="spinner-border spinner-border-sm me-2" />Submitting...</> : <><i className="bi bi-send me-2" />Submit Request</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
