'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import { MANAGER_ROLES } from '@/lib/constants';
import Pagination from '@/components/Pagination';

const STATUS_STYLE = {
  pending:  { bg: '#fef3c7', color: '#d97706' },
  approved: { bg: '#dcfce7', color: '#16a34a' },
  rejected: { bg: '#fee2e2', color: '#dc2626' },
};

export default function RegularizationHistoryPage() {
  const { user } = useAuth();
  const { formatDate, formatTime, formatDateTime } = useSettings();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [employees, setEmployees]       = useState([]);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [roleFilter, setRoleFilter]     = useState('');
  const [searchQuery, setSearchQuery]   = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const pageSize = 10;
  const canReview = MANAGER_ROLES.includes(user?.role);

  useEffect(() => {
    setLoading(true);
    api.get('/api/attendance/regularize?scope=history')
      .then(r => setRequests(Array.isArray(r) ? r : []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get('/api/employees')
      .then(r => setEmployees(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, []);

  const hasActiveFilters = statusFilter || employeeFilter || roleFilter || searchQuery || dateFrom || dateTo;

  const filtered = requests.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (employeeFilter && r.userId?._id?.toString() !== employeeFilter) return false;
    if (roleFilter && r.userId?.role !== roleFilter) return false;
    if (searchQuery && !r.userId?.name?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    return true;
  });

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <AppShell title="Regularization History">
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .skeleton { background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; }
      `}</style>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: canReview ? 10 : 0 }}>
          <h5 style={{ margin: 0, fontWeight: 700 }}>Regularization History</h5>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-select form-select-sm"
              style={{ width: 160 }}
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            {hasActiveFilters && (
              <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                setStatusFilter(''); setEmployeeFilter(''); setRoleFilter('');
                setSearchQuery(''); setDateFrom(''); setDateTo(''); setPage(1);
              }}>
                <i className="bi bi-x-circle me-1" />Clear
              </button>
            )}
          </div>
        </div>
        {canReview && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <select
              className="form-select form-select-sm"
              style={{ width: 180 }}
              value={employeeFilter}
              onChange={e => { setEmployeeFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Employees</option>
              {employees
                .filter(e => e.role !== 'super_admin')
                .map(e => (
                  <option key={e.userId?._id || e.userId} value={e.userId?._id || e.userId}>
                    {e.name}{e.department ? ` (${e.department})` : ''}
                  </option>
                ))}
            </select>
            <select
              className="form-select form-select-sm"
              style={{ width: 140 }}
              value={roleFilter}
              onChange={e => { setRoleFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Roles</option>
              <option value="intern">Intern</option>
              <option value="employee">Employee</option>
              <option value="team_admin">Team Admin</option>
              <option value="team_lead">Team Lead</option>
              <option value="recruiter">Recruiter</option>
              <option value="admin_full">Admin</option>
            </select>
            <input
              type="date"
              className="form-control form-control-sm"
              style={{ width: 155 }}
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              title="From date"
            />
            <input
              type="date"
              className="form-control form-control-sm"
              style={{ width: 155 }}
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              title="To date"
            />
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="Search employee..."
              style={{ width: 180 }}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            />
          </div>
        )}
      </div>

      {/* Stat Cards */}
      {!loading && (
        <div className="row g-3 mb-4">
          {[
            { label: 'Total Requests', value: requests.length, icon: 'bi-clock-history', color: '#3b82f6' },
            { label: 'Pending', value: requests.filter(r => r.status === 'pending').length, icon: 'bi-hourglass-split', color: '#d97706' },
            { label: 'Approved', value: requests.filter(r => r.status === 'approved').length, icon: 'bi-check-circle-fill', color: '#16a34a' },
            { label: 'Rejected', value: requests.filter(r => r.status === 'rejected').length, icon: 'bi-x-circle-fill', color: '#dc2626' },
          ].map(s => (
            <div key={s.label} className="col-6 col-xl-3">
              <div className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{s.value}</div>
                  </div>
                  <div className="stat-icon" style={{ background: s.color + '15' }}>
                    <i className={`bi ${s.icon}`} style={{ color: s.color }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Skeleton Loading */}
      {loading ? (
        <>
          <div className="row g-3 mb-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="col-6 col-xl-3">
                <div className="stat-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ width: '60%', height: 14, marginBottom: 8 }} />
                      <div className="skeleton" style={{ width: '40%', height: 24 }} />
                    </div>
                    <div className="skeleton" style={{ width: 44, height: 44, borderRadius: 12 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr>
                    {canReview && <th>Employee</th>}
                    <th>Date</th><th>Req. In</th><th>Req. Out</th><th>Req. Break</th><th>Req. Lunch</th><th>Reason</th><th>Status</th><th>Reviewed By</th><th>Reviewed At</th>
                  </tr>
                </thead>
                <tbody>
                  {[1,2,3,4,5].map(i => (
                    <tr key={i}>
                      {canReview && <td><div className="skeleton" style={{ width: 120, height: 16 }} /></td>}
                      <td><div className="skeleton" style={{ width: 80, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 50, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 50, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 70, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 70, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 120, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 60, height: 20, borderRadius: 10 }} /></td>
                      <td><div className="skeleton" style={{ width: 80, height: 16 }} /></td>
                      <td><div className="skeleton" style={{ width: 100, height: 16 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <i className="bi bi-clock-history" />
            <h6>No regularization history found</h6>
            {hasActiveFilters && <p>Try adjusting your filters to see more results.</p>}
          </div>
        </div>
      ) : (
        <>
          <div className="card d-none d-md-block">
            <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr>
                    {canReview && <th>Employee</th>}
                    <th>Date</th>
                    <th>Req. In</th>
                    <th>Req. Out</th>
                    <th>Req. Break</th>
                    <th>Req. Lunch</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Reviewed By</th>
                    <th>Reviewed At</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(r => (
                    <tr key={r._id} onClick={() => setSelectedRequest(r)} style={{ cursor: 'pointer' }}>
                      {canReview && (
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{r.userId?.avatar}</div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{r.userId?.name}</span>
                          </div>
                        </td>
                      )}
                      <td style={{ fontSize: 13 }}>{formatDate(r.date)}</td>
                      <td style={{ fontSize: 13 }}>{formatTime(r.requestedIn) || '—'}</td>
                      <td style={{ fontSize: 13 }}>{r.requestedOutNotYet ? 'Not yet' : (formatTime(r.requestedOut) || '—')}</td>
                      <td style={{ fontSize: 13 }}>
                        {r.requestedBreakStart || r.requestedBreakEnd
                          ? `${formatTime(r.requestedBreakStart) || '—'} → ${formatTime(r.requestedBreakEnd) || '—'}`
                          : '—'}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {r.requestedLunchStart || r.requestedLunchEnd
                          ? `${formatTime(r.requestedLunchStart) || '—'} → ${formatTime(r.requestedLunchEnd) || '—'}`
                          : '—'}
                      </td>
                      <td style={{ fontSize: 12, color: '#64748b', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                      <td>
                        <span className="badge" style={{ background: STATUS_STYLE[r.status]?.bg, color: STATUS_STYLE[r.status]?.color, fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <i className={`bi ${r.status === 'pending' ? 'bi-clock' : r.status === 'approved' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} />
                          {r.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 13 }}>{r.reviewedBy?.name || '—'}</td>
                      <td style={{ fontSize: 13 }}>{r.reviewedAt ? formatDateTime(r.reviewedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="d-md-none">
            {paginated.map(r => (
              <div key={r._id} className="card p-3 mb-2" onClick={() => setSelectedRequest(r)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    {canReview && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{r.userId?.name}</div>}
                    <div style={{ fontSize: 13, color: '#64748b' }}>{formatDate(r.date)}</div>
                  </div>
                  <span className="badge" style={{ background: STATUS_STYLE[r.status]?.bg, color: STATUS_STYLE[r.status]?.color, fontWeight: 600, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <i className={`bi ${r.status === 'pending' ? 'bi-clock' : r.status === 'approved' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} />
                    {r.status}
                  </span>
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. In</div><div style={{ fontSize: 13, fontWeight: 600 }}>{formatTime(r.requestedIn) || '—'}</div></div>
                  <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. Out</div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.requestedOutNotYet ? 'Not yet' : (formatTime(r.requestedOut) || '—')}</div></div>
                  <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. Break</div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.requestedBreakStart || r.requestedBreakEnd ? `${formatTime(r.requestedBreakStart) || '—'} → ${formatTime(r.requestedBreakEnd) || '—'}` : '—'}</div></div>
                  <div className="col-6"><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Req. Lunch</div><div style={{ fontSize: 13, fontWeight: 600 }}>{r.requestedLunchStart || r.requestedLunchEnd ? `${formatTime(r.requestedLunchStart) || '—'} → ${formatTime(r.requestedLunchEnd) || '—'}` : '—'}</div></div>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{r.reason}</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                  {r.reviewedBy?.name ? <>Reviewed by <strong>{r.reviewedBy.name}</strong></> : 'Not reviewed yet'}
                  {r.reviewedAt && <> &middot; {formatDateTime(r.reviewedAt)}</>}
                </div>
              </div>
            ))}
          </div>

          <Pagination
            currentPage={page}
            totalPages={Math.ceil(filtered.length / pageSize)}
            onPageChange={setPage}
            totalItems={filtered.length}
            pageSize={pageSize}
          />
        </>
      )}

      {/* Detail Modal */}
      {selectedRequest && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setSelectedRequest(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-file-text me-2" />
                  Regularization Request Details
                </h5>
                <button className="btn-close" onClick={() => setSelectedRequest(null)} />
              </div>
              <div className="modal-body">
                {canReview && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                      {selectedRequest.userId?.avatar}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{selectedRequest.userId?.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{selectedRequest.userId?.department}{selectedRequest.userId?.role ? ` · ${selectedRequest.userId.role}` : ''}</div>
                    </div>
                  </div>
                )}
                <div className="row g-3">
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{formatDate(selectedRequest.date)}</div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</label>
                    <div style={{ marginTop: 2 }}>
                      <span className="badge" style={{ background: STATUS_STYLE[selectedRequest.status]?.bg, color: STATUS_STYLE[selectedRequest.status]?.color, fontWeight: 600, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <i className={`bi ${selectedRequest.status === 'pending' ? 'bi-clock' : selectedRequest.status === 'approved' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} />
                        {selectedRequest.status}
                      </span>
                    </div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Requested Clock In</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{formatTime(selectedRequest.requestedIn) || '—'}</div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Requested Clock Out</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{selectedRequest.requestedOutNotYet ? 'Not yet' : (formatTime(selectedRequest.requestedOut) || '—')}</div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Break</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {selectedRequest.requestedBreakStart || selectedRequest.requestedBreakEnd
                        ? `${formatTime(selectedRequest.requestedBreakStart) || '—'} → ${formatTime(selectedRequest.requestedBreakEnd) || '—'}`
                        : '—'}
                    </div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Lunch</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {selectedRequest.requestedLunchStart || selectedRequest.requestedLunchEnd
                        ? `${formatTime(selectedRequest.requestedLunchStart) || '—'} → ${formatTime(selectedRequest.requestedLunchEnd) || '—'}`
                        : '—'}
                    </div>
                  </div>
                  <div className="col-12">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reason</label>
                    <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, background: '#f8fafc', padding: 12, borderRadius: 8, marginTop: 4 }}>{selectedRequest.reason}</div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Submitted At</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{formatDateTime(selectedRequest.createdAt)}</div>
                  </div>
                  <div className="col-6">
                    <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reviewed By</label>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{selectedRequest.reviewedBy?.name || '—'}</div>
                  </div>
                  {selectedRequest.reviewedAt && (
                    <div className="col-6">
                      <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reviewed At</label>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{formatDateTime(selectedRequest.reviewedAt)}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelectedRequest(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
