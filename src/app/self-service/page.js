'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';

const EMPTY_FORM = {
  requestType: 'profile_update',
  reason: '',
  preferredName: '',
  personalPhone: '',
  secondaryPhone: '',
  addressHistory: [{ addressType: 'current', line1: '', line2: '', city: '', state: '', country: 'India', postalCode: '', landmark: '', isCurrent: true }],
  emergencyContacts: [{ name: '', relation: '', phone: '', email: '', isPrimary: true }],
  noticePeriodDays: 30,
  lastWorkingDate: '',
  settlementStatus: 'pending',
  exitInterviewComplete: false,
};

export default function SelfServicePage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [identity, setIdentity] = useState(null);
  const [profile, setProfile] = useState(null);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const currentRequestTypeLabel = useMemo(() => ({
    profile_update: 'Profile Update',
    address_update: 'Address Update',
    emergency_contact_update: 'Emergency Contact Update',
    resignation: 'Resignation',
  }), []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/self-service/me');
      setIdentity(res.identity || null);
      setProfile(res.profile || null);
      setRequests(Array.isArray(res.requests) ? res.requests : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  const submit = async () => {
    if (!form.reason || form.reason.length < 10) return showToast('Reason must be at least 10 characters', 'error');

    const payload = { requestType: form.requestType, reason: form.reason, payload: {} };
    if (form.requestType === 'profile_update') {
      payload.payload.preferredName = form.preferredName;
      payload.payload.personalPhone = form.personalPhone;
      payload.payload.secondaryPhone = form.secondaryPhone;
    }
    if (form.requestType === 'address_update') {
      payload.payload.addressHistory = form.addressHistory;
    }
    if (form.requestType === 'emergency_contact_update') {
      payload.payload.emergencyContacts = form.emergencyContacts;
    }
    if (form.requestType === 'resignation') {
      payload.payload.noticePeriodDays = Number(form.noticePeriodDays || 0);
      payload.payload.lastWorkingDate = form.lastWorkingDate;
      payload.payload.settlementStatus = form.settlementStatus;
      payload.payload.exitInterviewComplete = !!form.exitInterviewComplete;
    }

    setSaving(true);
    try {
      await api.post('/api/self-service/requests', payload);
      showToast('Request submitted');
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateAddressField = (index, key, value) => {
    setForm(prev => {
      const next = [...prev.addressHistory];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, addressHistory: next };
    });
  };

  const updateContactField = (index, key, value) => {
    setForm(prev => {
      const next = [...prev.emergencyContacts];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, emergencyContacts: next };
    });
  };

  return (
    <AppShell title="My Profile">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}>{toast.msg}</div></div>}

      <div className="page-header">
        <div>
          <h4>Self-Service Profile</h4>
          <p>Update safe personal details or submit a resignation request for HR review.</p>
        </div>
        <button className="btn btn-outline-primary" onClick={load} disabled={loading}>Refresh</button>
      </div>

      <div className="row g-4">
        <div className="col-xl-4">
          <div className="card p-3 mb-3">
            <div className="fw-bold mb-3">Current Snapshot</div>
            {loading ? (
              <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-primary" /></div>
            ) : identity ? (
              <>
                <div className="fw-semibold fs-5">{identity.legalName}</div>
                <div className="text-secondary small mb-3">{identity.primaryEmail}</div>

                <div className="small mb-1"><strong>Phone:</strong> {identity.personalPhone || '—'}</div>
                <div className="small mb-1"><strong>Secondary Phone:</strong> {identity.secondaryPhone || '—'}</div>
                <div className="small mb-1"><strong>Status:</strong> {profile?.employmentStatus || '—'}</div>
                <div className="small mb-1"><strong>Department:</strong> {profile?.department || '—'}</div>
                <div className="small mb-1"><strong>Designation:</strong> {profile?.designation || '—'}</div>
                <div className="small mb-3"><strong>Hire Date:</strong> {formatDate(profile?.hireDate)}</div>

                {identity.addressHistory?.length > 0 && (
                  <>
                    <div className="fw-semibold small mb-2" style={{ color: '#1e293b' }}>Address</div>
                    {identity.addressHistory.map((addr, i) => (
                      <div key={i} className="border rounded p-2 mb-2" style={{ fontSize: 12, background: '#f8fafc' }}>
                        <div className="text-capitalize" style={{ fontWeight: 600, color: '#3b82f6', marginBottom: 4 }}>{addr.addressType}</div>
                        <div>{addr.line1}{addr.line2 ? ', ' + addr.line2 : ''}</div>
                        <div>{[addr.city, addr.state, addr.postalCode, addr.country].filter(Boolean).join(', ')}</div>
                        {addr.landmark && <div style={{ color: '#64748b' }}>Near: {addr.landmark}</div>}
                      </div>
                    ))}
                  </>
                )}

                {identity.emergencyContacts?.length > 0 && (
                  <>
                    <div className="fw-semibold small mb-2" style={{ color: '#1e293b' }}>Emergency Contacts</div>
                    {identity.emergencyContacts.map((c, i) => (
                      <div key={i} className="border rounded p-2 mb-2" style={{ fontSize: 12, background: '#f8fafc' }}>
                        <div style={{ fontWeight: 600 }}>{c.name} <span style={{ color: '#64748b', fontWeight: 400 }}>({c.relation})</span></div>
                        <div>{c.phone}{c.email ? ' · ' + c.email : ''}</div>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : (
              <div className="text-muted small">No identity data found.</div>
            )}
          </div>

          <div className="card p-3">
            <div className="fw-bold mb-3">Request History</div>
            <div style={{ maxHeight: 500, overflow: 'auto' }}>
              {requests.map(req => (
                <div key={req._id} className="border rounded p-2 mb-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="fw-semibold small">{currentRequestTypeLabel[req.requestType] || req.requestType}</div>
                    <span className="badge bg-light text-dark">{req.status}</span>
                  </div>
                  <div className="small text-secondary">{formatDate(req.createdAt)}</div>
                  <div className="small mt-1">{req.reason}</div>
                </div>
              ))}
              {requests.length === 0 && <div className="text-muted small">No requests yet.</div>}
            </div>
          </div>
        </div>

        <div className="col-xl-8">
          <div className="card p-3 mb-3">
            <div className="fw-bold mb-3">New Request</div>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Request Type</label>
                <select className="form-select" value={form.requestType} onChange={e => setForm(prev => ({ ...prev, requestType: e.target.value }))}>
                  <option value="profile_update">Profile Update</option>
                  <option value="address_update">Address Update</option>
                  <option value="emergency_contact_update">Emergency Contact Update</option>
                  <option value="resignation">Resignation</option>
                </select>
              </div>
              <div className="col-md-8">
                <label className="form-label">Reason</label>
                <input className="form-control" value={form.reason} onChange={e => setForm(prev => ({ ...prev, reason: e.target.value }))} placeholder="Explain why you are submitting this request" />
              </div>

              {form.requestType === 'profile_update' && (
                <>
                  <div className="col-md-4"><label className="form-label">Preferred Name</label><input className="form-control" value={form.preferredName} onChange={e => setForm(prev => ({ ...prev, preferredName: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label">Personal Phone</label><input className="form-control" value={form.personalPhone} onChange={e => setForm(prev => ({ ...prev, personalPhone: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label">Secondary Phone</label><input className="form-control" value={form.secondaryPhone} onChange={e => setForm(prev => ({ ...prev, secondaryPhone: e.target.value }))} /></div>
                </>
              )}

              {form.requestType === 'address_update' && (
                <div className="col-12">
                  <div className="border rounded p-3">
                    <div className="fw-semibold mb-2">Address</div>
                    {form.addressHistory.map((address, index) => (
                      <div key={index} className="row g-2 mb-2">
                        <div className="col-md-6"><label className="form-label">Line 1</label><input className="form-control" value={address.line1} onChange={e => updateAddressField(index, 'line1', e.target.value)} /></div>
                        <div className="col-md-6"><label className="form-label">Line 2</label><input className="form-control" value={address.line2} onChange={e => updateAddressField(index, 'line2', e.target.value)} /></div>
                        <div className="col-md-4"><label className="form-label">City</label><input className="form-control" value={address.city} onChange={e => updateAddressField(index, 'city', e.target.value)} /></div>
                        <div className="col-md-4"><label className="form-label">State</label><input className="form-control" value={address.state} onChange={e => updateAddressField(index, 'state', e.target.value)} /></div>
                        <div className="col-md-4"><label className="form-label">Postal Code</label><input className="form-control" value={address.postalCode} onChange={e => updateAddressField(index, 'postalCode', e.target.value)} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.requestType === 'emergency_contact_update' && (
                <div className="col-12">
                  <div className="border rounded p-3">
                    <div className="fw-semibold mb-2">Emergency Contact</div>
                    {form.emergencyContacts.map((contact, index) => (
                      <div key={index} className="row g-2 mb-2">
                        <div className="col-md-4"><label className="form-label">Name</label><input className="form-control" value={contact.name} onChange={e => updateContactField(index, 'name', e.target.value)} /></div>
                        <div className="col-md-4"><label className="form-label">Relation</label><input className="form-control" value={contact.relation} onChange={e => updateContactField(index, 'relation', e.target.value)} /></div>
                        <div className="col-md-4"><label className="form-label">Phone</label><input className="form-control" value={contact.phone} onChange={e => updateContactField(index, 'phone', e.target.value)} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.requestType === 'resignation' && (
                <>
                  <div className="col-md-4"><label className="form-label">Notice Period Days</label><input className="form-control" type="number" min="0" value={form.noticePeriodDays} onChange={e => setForm(prev => ({ ...prev, noticePeriodDays: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label">Last Working Date</label><input className="form-control" type="date" value={form.lastWorkingDate} onChange={e => setForm(prev => ({ ...prev, lastWorkingDate: e.target.value }))} /></div>
                  <div className="col-md-4"><label className="form-label">Settlement Status</label><select className="form-select" value={form.settlementStatus} onChange={e => setForm(prev => ({ ...prev, settlementStatus: e.target.value }))}><option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="settled">Settled</option></select></div>
                  <div className="col-12"><div className="form-check"><input className="form-check-input" type="checkbox" checked={form.exitInterviewComplete} onChange={e => setForm(prev => ({ ...prev, exitInterviewComplete: e.target.checked }))} id="exitInterviewComplete" /><label className="form-check-label" htmlFor="exitInterviewComplete">Exit interview complete</label></div></div>
                </>
              )}
            </div>

            <div className="mt-4 d-flex gap-2">
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</button>
              <button className="btn btn-outline-secondary" onClick={() => setForm(EMPTY_FORM)}>Reset</button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}