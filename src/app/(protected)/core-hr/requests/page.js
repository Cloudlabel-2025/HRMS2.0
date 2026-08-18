'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import Pagination from '@/components/Pagination';
import DateInput from '@/components/DateInput';

const TYPE_LABELS = {
  profile_update:            'Profile Update',
  address_update:            'Address Update',
  emergency_contact_update:  'Emergency Contact Update',
  resignation:               'Resignation',
  permission:                'Permission Request',
};

const STATUS_STYLE = {
  pending:   { bg: '#fef3c7', color: '#d97706' },
  approved:  { bg: '#dcfce7', color: '#16a34a' },
  rejected:  { bg: '#fee2e2', color: '#dc2626' },
  cancelled: { bg: '#f1f5f9', color: '#64748b' },
};

function PayloadView({ requestType, payload, formatTime }) {
  if (!payload) return <p className="text-muted small">No payload data.</p>;

  if (requestType === 'profile_update') {
    return (
      <div className="row g-2">
        {[['Preferred Name', payload.preferredName], ['Personal Phone', payload.personalPhone], ['Secondary Phone', payload.secondaryPhone]].map(([label, val]) => (
          <div key={label} className="col-md-4">
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{val || '—'}</div>
          </div>
        ))}
      </div>
    );
  }

  if (requestType === 'address_update') {
    return (
      <div>
        {(payload.addressHistory || []).map((addr, i) => (
          <div key={i} className="border rounded p-3 mb-2" style={{ fontSize: 13 }}>
            <div className="row g-2">
              {[['Type', addr.addressType], ['Line 1', addr.line1], ['Line 2', addr.line2], ['City', addr.city], ['State', addr.state], ['Postal Code', addr.postalCode], ['Country', addr.country], ['Landmark', addr.landmark]].map(([label, val]) => (
                val ? (
                  <div key={label} className="col-md-4">
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
                    <div style={{ fontWeight: 600 }}>{val}</div>
                  </div>
                ) : null
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (requestType === 'emergency_contact_update') {
    return (
      <div>
        {(payload.emergencyContacts || []).map((c, i) => (
          <div key={i} className="border rounded p-3 mb-2" style={{ fontSize: 13 }}>
            <div className="row g-2">
              {[['Name', c.name], ['Relation', c.relation], ['Phone', c.phone], ['Email', c.email]].map(([label, val]) => (
                val ? (
                  <div key={label} className="col-md-3">
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
                    <div style={{ fontWeight: 600 }}>{val}</div>
                  </div>
                ) : null
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (requestType === 'resignation') {
    return (
      <div className="row g-2">
        {[
          ['Notice Period Days', payload.noticePeriodDays],
          ['Last Working Date', payload.lastWorkingDate],
        ].map(([label, val]) => (
          <div key={label} className="col-md-6">
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{val ?? '—'}</div>
          </div>
        ))}
      </div>
    );
  }

  if (requestType === 'permission') {
    return (
      <div>
        <div className="row g-2">
          {[
            ['Permission Date', payload.date],
            ['Start Time', formatTime(payload.startTime) || null],
            ['End Time', formatTime(payload.endTime) || null],
            ['Duration', `${payload.duration} mins`],
            ['Requests this cycle', `${payload.permissionCountInCycle || 1}`],
          ].map(([label, val]) => (
            <div key={label} className="col-md-2">
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{val ?? '—'}</div>
            </div>
          ))}
        </div>
        {payload.isThirdOrMore && (
          <div className="alert alert-warning py-2 px-3 mt-3 mb-0" style={{ fontSize: 13, borderLeft: '4px solid #f59e0b', color: '#854d0e', backgroundColor: '#fef9c3', borderColor: '#fef08a' }}>
            <strong>⚠️ Warning:</strong> This is the employee's <strong>{payload.permissionCountInCycle}th</strong> permission request in this payroll cycle ({payload.cycleRange?.fromDate} to {payload.cycleRange?.toDate}).
          </div>
        )}
      </div>
    );
  }

  return <pre style={{ fontSize: 12 }}>{JSON.stringify(payload, null, 2)}</pre>;
}

export default function CoreHrRequestsPage() {
  const { user } = useAuth();
  const { formatDate, formatTime } = useSettings();
  const [requests, setRequests] = useState([]);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [selected, setSelected] = useState(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewNoticeDays, setReviewNoticeDays] = useState(0);
  const [reviewLastWorkingDate, setReviewLastWorkingDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async (status = filterStatus) => {
    setLoading(true);
    try {
      const res = await api.get(`/api/core/self-service-requests?status=${status}`);
      setRequests(Array.isArray(res.requests) ? res.requests : []);
      setSelected(null);
      setReviewNote('');
      setReviewNoticeDays(0);
      setReviewLastWorkingDate('');
      setPage(1);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const review = async (action) => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.put('/api/core/self-service-requests', {
        id: selected._id,
        action,
        reviewNote: reviewNote.trim() || (action === 'approved' ? 'Approved by HR' : 'Rejected by HR'),
        ...(selected.requestType === 'resignation' && action === 'approved' ? {
          noticePeriodDays: Number(reviewNoticeDays || 0),
          lastWorkingDate: reviewLastWorkingDate,
        } : {}),
      });
      showToast(`Request ${action}`);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleFilter = (status) => {
    setFilterStatus(status);
    setPage(1);
    load(status);
  };

  return (
    <AppShell title="HR Requests">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}>{toast.msg}</div></div>}

      <div className="page-header">
        <div>
          <h4>Employee Self-Service Requests</h4>
          <p>Review and act on pending profile, address, emergency contact, and resignation requests.</p>
        </div>
        <button className="btn btn-outline-primary" onClick={() => load()} disabled={loading}>Refresh</button>
      </div>

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => handleFilter(s)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize',
              background: filterStatus === s ? '#fff' : 'transparent',
              color: filterStatus === s ? '#1e293b' : '#64748b',
              boxShadow: filterStatus === s ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {s}
          </button>
        ))}
      </div>

      <div className="row g-3">
        {/* Request list */}
        <div className={selected ? 'col-lg-5' : 'col-12'}>
          <div className="card">
            {loading ? (
              <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
            ) : requests.length === 0 ? (
              <div className="empty-state py-5">
                <i className="bi bi-inbox" />
                <h6>No {filterStatus} requests</h6>
              </div>
            ) : (
              <>
                <div className="list-group list-group-flush">
                  {requests.slice((page - 1) * pageSize, page * pageSize).map(req => (
                  <button key={req._id} type="button"
                    onClick={() => { setSelected(req); setReviewNote(''); setReviewNoticeDays(req.payload?.noticePeriodDays || 0); setReviewLastWorkingDate(String(req.payload?.lastWorkingDate || '').slice(0, 10)); }}
                    className="list-group-item list-group-item-action"
                    style={{ background: selected?._id === req._id ? '#f0f9ff' : '', borderLeft: selected?._id === req._id ? '3px solid #3b82f6' : '3px solid transparent' }}>
                    <div className="d-flex justify-content-between align-items-start">
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{req.identityId?.legalName || 'Unknown'}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{req.identityId?.primaryEmail}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{TYPE_LABELS[req.requestType] || req.requestType}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span className="badge" style={{ background: STATUS_STYLE[req.status]?.bg, color: STATUS_STYLE[req.status]?.color, fontSize: 11 }}>
                          {req.status}
                        </span>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{formatDate(req.createdAt)}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {req.reason}
                    </div>
                  </button>
                ))}
              </div>
              {requests.length > 0 && (
                <div className="p-3 border-top">
                  <Pagination
                    currentPage={page}
                    totalPages={Math.ceil(requests.length / pageSize)}
                    onPageChange={setPage}
                    totalItems={requests.length}
                    pageSize={pageSize}
                  />
                </div>
              )}
            </>
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="col-lg-7">
            <div className="card p-4">
              <div className="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.identityId?.legalName}</div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{selected.identityId?.primaryEmail}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                    {selected.profileId?.department} · {selected.profileId?.designation} · {selected.profileId?.employmentStatus}
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="badge" style={{ background: STATUS_STYLE[selected.status]?.bg, color: STATUS_STYLE[selected.status]?.color }}>
                    {selected.status}
                  </span>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelected(null)}>
                    <i className="bi bi-x-lg" />
                  </button>
                </div>
              </div>

              <div className="mb-3">
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>REQUEST TYPE</div>
                <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: 13 }}>
                  {TYPE_LABELS[selected.requestType] || selected.requestType}
                </span>
              </div>

              <div className="mb-3">
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>REASON</div>
                <p style={{ fontSize: 13, margin: 0 }}>{selected.reason}</p>
              </div>

              <div className="mb-3">
                <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>REQUESTED CHANGES</div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: 12 }}>
                  <PayloadView requestType={selected.requestType} payload={selected.payload} formatTime={formatTime} />
                </div>
              </div>

              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
                Submitted on {formatDate(selected.createdAt)}
                {selected.reviewedAt && ` · Reviewed on ${formatDate(selected.reviewedAt)}`}
                {selected.reviewNote && ` · Note: ${selected.reviewNote}`}
              </div>

              {selected.status === 'pending' && (
                <>
                  {selected.requestType === 'resignation' && (
                    <div className="row g-3 mb-3">
                      <div className="col-md-6">
                        <label className="form-label" style={{fontSize:13,fontWeight:600}}>Confirmed Notice Days</label>
                        <input type="number" min="0" max="365" className="form-control" value={reviewNoticeDays} onChange={e => setReviewNoticeDays(e.target.value)} />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{fontSize:13,fontWeight:600}}>Confirmed Last Working Date</label>
                        <DateInput className="form-control" value={reviewLastWorkingDate} min={new Date().toISOString().slice(0, 10)} onChange={e => setReviewLastWorkingDate(e.target.value)} />
                      </div>
                      <div className="col-12"><div className="alert alert-info py-2 mb-0" style={{fontSize:12}}>Approval starts notice period and keeps login active until HR finalizes the exit.</div></div>
                    </div>
                  )}
                  <div className="mb-3">
                    <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Review Note <span style={{ color: '#94a3b8', fontWeight: 400 }}>(optional)</span></label>
                    <textarea
                      className="form-control"
                      rows={2}
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                      placeholder="Add a note for the employee..."
                    />
                  </div>
                  <div className="d-flex gap-2">
                    <button className="btn btn-success" onClick={() => review('approved')} disabled={saving || (selected.requestType === 'resignation' && !reviewLastWorkingDate)}>
                      <i className="bi bi-check-circle me-2" />{saving ? 'Processing...' : 'Approve'}
                    </button>
                    <button className="btn btn-outline-danger" onClick={() => review('rejected')} disabled={saving}>
                      <i className="bi bi-x-circle me-2" />Reject
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
