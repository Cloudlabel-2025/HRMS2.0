'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import DateInput from '@/components/DateInput';

const EMPTY_FORM = {
  requestType: 'profile_update',
  reason: '',
  preferredName: '',
  personalPhone: '',
  secondaryPhone: '',
  addressHistory: [{ addressType: 'current', line1: '', line2: '', line3: '', city: '', state: '', country: 'India', postalCode: '', landmark: '', isCurrent: true }],
  emergencyContacts: [{ name: '', relation: '', phone: '', email: '', isPrimary: true }],
  noticePeriodDays: 30,
  lastWorkingDate: '',
  settlementStatus: 'pending',
  exitInterviewComplete: false,
};

export default function SelfServicePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { formatDate } = useSettings();
  const [identity, setIdentity] = useState(null);
  const [profile, setProfile] = useState(null);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [formErrors, setFormErrors] = useState({});

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const clearError = (field) => {
    setFormErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = () => {
    const errs = {};
    if (!form.reason || form.reason.length < 10) errs.reason = 'Reason must be at least 10 characters';
    else if (!/^[a-zA-Z0-9 ]+$/.test(form.reason)) errs.reason = 'Reason can only contain letters and numbers';
    if (form.requestType === 'profile_update') {
      if (!form.personalPhone) errs.personalPhone = 'Personal phone is required';
      else if (!/^\d{10}$/.test(form.personalPhone)) errs.personalPhone = 'Personal phone must be exactly 10 digits';
      if (form.preferredName && !/^[A-Z][a-zA-Z]*$/.test(form.preferredName)) errs.preferredName = 'Preferred name must start with a capital letter and contain only alphabets';
      else if (form.preferredName && form.preferredName.length > 25) errs.preferredName = 'Preferred name must be 25 characters or less';
      if (form.secondaryPhone && !/^\d{10}$/.test(form.secondaryPhone)) errs.secondaryPhone = 'Secondary phone must be exactly 10 digits';
    }
    if (form.requestType === 'address_update') {
      form.addressHistory.forEach((addr, i) => {
        if (!addr.line1) errs[`address.${i}.line1`] = 'Address line 1 is required';
        else if (addr.line1.length > 25) errs[`address.${i}.line1`] = 'Line 1 must be 25 characters or less';
        if (addr.line2 && addr.line2.length > 25) errs[`address.${i}.line2`] = 'Line 2 must be 25 characters or less';
        if (addr.line3 && addr.line3.length > 25) errs[`address.${i}.line3`] = 'Line 3 must be 25 characters or less';
        if (!addr.city) errs[`address.${i}.city`] = 'City is required';
        else if (!/^[a-zA-Z ]+$/.test(addr.city)) errs[`address.${i}.city`] = 'City can only contain alphabets';
        else if (addr.city.length > 25) errs[`address.${i}.city`] = 'City must be 25 characters or less';
        if (!addr.state) errs[`address.${i}.state`] = 'State is required';
        else if (!/^[a-zA-Z ]+$/.test(addr.state)) errs[`address.${i}.state`] = 'State can only contain alphabets';
        else if (addr.state.length > 25) errs[`address.${i}.state`] = 'State must be 25 characters or less';
        if (!addr.postalCode) errs[`address.${i}.postalCode`] = 'Postal code is required';
        else if (!/^\d{6}$/.test(addr.postalCode)) errs[`address.${i}.postalCode`] = 'Postal code must be exactly 6 digits';
      });
    }
    if (form.requestType === 'emergency_contact_update') {
      form.emergencyContacts.forEach((c, i) => {
        if (!c.name) errs[`contact.${i}.name`] = 'Contact name is required';
        else if (!/^[A-Z][a-zA-Z ]*$/.test(c.name)) errs[`contact.${i}.name`] = 'Name must start with a capital letter and contain only alphabets';
        else if (c.name.length > 25) errs[`contact.${i}.name`] = 'Name must be 25 characters or less';
        if (!c.relation) errs[`contact.${i}.relation`] = 'Relation is required';
        else if (!/^[a-zA-Z ]+$/.test(c.relation)) errs[`contact.${i}.relation`] = 'Relation can only contain alphabets';
        else if (c.relation.length > 25) errs[`contact.${i}.relation`] = 'Relation must be 25 characters or less';
        if (!c.phone) errs[`contact.${i}.phone`] = 'Phone is required';
        else if (!/^\d{10}$/.test(c.phone)) errs[`contact.${i}.phone`] = 'Phone must be exactly 10 digits';
      });
    }
    if (form.requestType === 'resignation') {
      if (form.noticePeriodDays && !/^\d{1,3}$/.test(form.noticePeriodDays)) errs.noticePeriodDays = 'Notice period must be 0-999';
      if (!form.lastWorkingDate) errs.lastWorkingDate = 'Last working date is required';
      else {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const lastDate = new Date(form.lastWorkingDate);
        if (lastDate < today) errs.lastWorkingDate = 'Last working date cannot be in the past';
      }
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
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
      if (user?.role === 'sme') {
        const res = await api.get('/api/sme/me');
        if (res?.sme?._id) {
          router.replace(`/sme/${res.sme._id}`);
          return;
        }
      }
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
    if (!validate()) return;

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
                <select className="form-select" value={form.requestType} onChange={e => { setForm(prev => ({ ...prev, requestType: e.target.value, reason: '' })); setFormErrors({}); }}>
                  <option value="profile_update">Profile Update</option>
                  <option value="address_update">Address Update</option>
                  <option value="emergency_contact_update">Emergency Contact Update</option>
                  <option value="resignation">Resignation</option>
                </select>
              </div>
              <div className="col-md-8">
                <label className="form-label">Reason <span style={{color:'#ef4444'}}>*</span></label>
                <input className={`form-control${formErrors.reason ? ' is-invalid' : ''}`} value={form.reason} onChange={e => { const v = e.target.value.replace(/[^a-zA-Z0-9 ]/g, ''); setForm(prev => ({ ...prev, reason: v })); clearError('reason'); }} placeholder="Explain why you are submitting this request" />
                {formErrors.reason && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors.reason}</div>}
              </div>

              {form.requestType === 'profile_update' && (
                <>
                  <div className="col-md-4"><label className="form-label">Preferred Name</label><input className={`form-control${formErrors.preferredName ? ' is-invalid' : ''}`} value={form.preferredName} onChange={e => { let v = e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 25); if (v.length > 0) v = v.charAt(0).toUpperCase() + v.slice(1); setForm(prev => ({ ...prev, preferredName: v })); clearError('preferredName'); }} />{formErrors.preferredName && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors.preferredName}</div>}</div>
                  <div className="col-md-4"><label className="form-label">Personal Phone <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors.personalPhone ? ' is-invalid' : ''}`} value={form.personalPhone} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setForm(prev => ({ ...prev, personalPhone: v })); clearError('personalPhone'); }} />{formErrors.personalPhone && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors.personalPhone}</div>}</div>
                  <div className="col-md-4"><label className="form-label">Secondary Phone</label><input className={`form-control${formErrors.secondaryPhone ? ' is-invalid' : ''}`} value={form.secondaryPhone} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setForm(prev => ({ ...prev, secondaryPhone: v })); clearError('secondaryPhone'); }} />{formErrors.secondaryPhone && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors.secondaryPhone}</div>}</div>
                </>
              )}

              {form.requestType === 'address_update' && (
                <div className="col-12">
                  <div className="border rounded p-3">
                    <div className="fw-semibold mb-2">Address</div>
                    {form.addressHistory.map((address, index) => (
                      <div key={index} className="row g-2 mb-2">
                        <div className="col-md-6"><label className="form-label">Line 1 <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`address.${index}.line1`] ? ' is-invalid' : ''}`} value={address.line1} onChange={e => { updateAddressField(index, 'line1', e.target.value.slice(0, 25)); clearError(`address.${index}.line1`); }} />{formErrors[`address.${index}.line1`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`address.${index}.line1`]}</div>}</div>
                        <div className="col-md-6"><label className="form-label">Line 2</label><input className={`form-control${formErrors[`address.${index}.line2`] ? ' is-invalid' : ''}`} value={address.line2} onChange={e => { updateAddressField(index, 'line2', e.target.value.slice(0, 25)); clearError(`address.${index}.line2`); }} />{formErrors[`address.${index}.line2`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`address.${index}.line2`]}</div>}</div>
                        <div className="col-md-6"><label className="form-label">Line 3</label><input className={`form-control${formErrors[`address.${index}.line3`] ? ' is-invalid' : ''}`} value={address.line3 ?? ''} onChange={e => { updateAddressField(index, 'line3', e.target.value.slice(0, 25)); clearError(`address.${index}.line3`); }} />{formErrors[`address.${index}.line3`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`address.${index}.line3`]}</div>}</div>
                        <div className="col-md-4"><label className="form-label">City <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`address.${index}.city`] ? ' is-invalid' : ''}`} value={address.city} onChange={e => { const v = e.target.value.replace(/[^a-zA-Z ]/g, '').slice(0, 25); updateAddressField(index, 'city', v); clearError(`address.${index}.city`); }} />{formErrors[`address.${index}.city`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`address.${index}.city`]}</div>}</div>
                        <div className="col-md-4"><label className="form-label">State <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`address.${index}.state`] ? ' is-invalid' : ''}`} value={address.state} onChange={e => { const v = e.target.value.replace(/[^a-zA-Z ]/g, '').slice(0, 25); updateAddressField(index, 'state', v); clearError(`address.${index}.state`); }} />{formErrors[`address.${index}.state`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`address.${index}.state`]}</div>}</div>
                        <div className="col-md-4"><label className="form-label">Postal Code <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`address.${index}.postalCode`] ? ' is-invalid' : ''}`} value={address.postalCode} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); updateAddressField(index, 'postalCode', v); clearError(`address.${index}.postalCode`); }} />{formErrors[`address.${index}.postalCode`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`address.${index}.postalCode`]}</div>}</div>
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
                        <div className="col-md-4"><label className="form-label">Name <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`contact.${index}.name`] ? ' is-invalid' : ''}`} value={contact.name} onChange={e => { let v = e.target.value.replace(/[^a-zA-Z ]/g, '').slice(0, 25); if (v.length > 0) v = v.charAt(0).toUpperCase() + v.slice(1); updateContactField(index, 'name', v); clearError(`contact.${index}.name`); }} />{formErrors[`contact.${index}.name`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`contact.${index}.name`]}</div>}</div>
                        <div className="col-md-4"><label className="form-label">Relation <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`contact.${index}.relation`] ? ' is-invalid' : ''}`} value={contact.relation} onChange={e => { const v = e.target.value.replace(/[^a-zA-Z ]/g, '').slice(0, 25); updateContactField(index, 'relation', v); clearError(`contact.${index}.relation`); }} />{formErrors[`contact.${index}.relation`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`contact.${index}.relation`]}</div>}</div>
                        <div className="col-md-4"><label className="form-label">Phone <span style={{color:'#ef4444'}}>*</span></label><input className={`form-control${formErrors[`contact.${index}.phone`] ? ' is-invalid' : ''}`} value={contact.phone} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); updateContactField(index, 'phone', v); clearError(`contact.${index}.phone`); }} />{formErrors[`contact.${index}.phone`] && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors[`contact.${index}.phone`]}</div>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.requestType === 'resignation' && (
                <>
                  <div className="col-md-4"><label className="form-label">Notice Period Days</label><input className={`form-control${formErrors.noticePeriodDays ? ' is-invalid' : ''}`} type="text" inputMode="numeric" value={form.noticePeriodDays} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 3); setForm(prev => ({ ...prev, noticePeriodDays: v })); clearError('noticePeriodDays'); }} />{formErrors.noticePeriodDays && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors.noticePeriodDays}</div>}</div>
                  <div className="col-md-4"><label className="form-label">Last Working Date <span style={{color:'#ef4444'}}>*</span></label><DateInput className={`form-control${formErrors.lastWorkingDate ? ' is-invalid' : ''}`} value={form.lastWorkingDate} min={new Date().toISOString().split('T')[0]} onChange={e => { setForm(prev => ({ ...prev, lastWorkingDate: e.target.value })); clearError('lastWorkingDate'); }} />{formErrors.lastWorkingDate && <div className="invalid-feedback d-block" style={{fontSize:12}}>{formErrors.lastWorkingDate}</div>}</div>
                  <div className="col-md-4"><label className="form-label">Settlement Status</label><select className="form-select" value={form.settlementStatus} onChange={e => setForm(prev => ({ ...prev, settlementStatus: e.target.value }))}><option value="pending">Pending</option><option value="in_progress">In Progress</option><option value="settled">Settled</option></select></div>
                  <div className="col-12"><div className="form-check"><input className="form-check-input" type="checkbox" checked={form.exitInterviewComplete} onChange={e => setForm(prev => ({ ...prev, exitInterviewComplete: e.target.checked }))} id="exitInterviewComplete" /><label className="form-check-label" htmlFor="exitInterviewComplete">Exit interview complete</label></div></div>
                </>
              )}
            </div>

            <div className="mt-4 d-flex gap-2">
              <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</button>
              <button className="btn btn-outline-secondary" onClick={() => { setForm(EMPTY_FORM); setFormErrors({}); }}>Reset</button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}