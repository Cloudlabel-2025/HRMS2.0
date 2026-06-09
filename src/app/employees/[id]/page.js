'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, ROLE_LABELS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { formatDate } = useSettings();
  
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState({ msg: '', type: 'success' });

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast({ msg: '', type: 'success' }), 3000); };

  useEffect(() => {
    if (id) {
      api.get(`/api/employees/${id}/details`)
        .then(res => setData(res))
        .catch(e => {
          showToast(e.message, 'error');
          setTimeout(() => router.push('/employees'), 2000);
        })
        .finally(() => setLoading(false));
    }
  }, [id, router]);

  if (loading) {
    return <AppShell title="Loading Profile..."><div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div></AppShell>;
  }
  
  if (!data) return <AppShell title="Profile Not Found"><div className="alert alert-danger m-4">Employee not found.</div></AppShell>;

  const emp = data.employee;
  
  // Check if current user can edit
  const canEdit = ['super_admin', 'admin_full'].includes(user?.role) || user?._id === emp.userId;

  return (
    <AppShell title="Employee Profile" breadcrumb={[{ label: 'Employees', href: '/employees' }, { label: emp.name }]}>
      {toast.msg && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      {/* Header Profile Card */}
      <div className="card mb-4 border-0 shadow-sm" style={{ overflow: 'hidden', borderRadius: 12 }}>
        <div style={{ height: 120, background: 'linear-gradient(135deg, #3b82f6 0%, #2dd4bf 100%)' }}></div>
        <div className="card-body position-relative pt-0 px-4 pb-4">
          <div className="d-flex flex-column flex-md-row justify-content-between align-items-end align-items-md-start mb-3" style={{ marginTop: -50 }}>
            <div className="d-flex align-items-end gap-3">
              <div style={{ width: 100, height: 100, borderRadius: '50%', backgroundColor: '#fff', padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {emp.avatar ? (
                  <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `url(${emp.avatar}) center/cover` }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'linear-gradient(135deg, #f8fafc, #e2e8f0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, color: '#475569' }}>
                    {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="pb-1">
                <h3 className="mb-0 fw-bold" style={{ color: '#0f172a' }}>{emp.name}</h3>
                <div className="text-secondary fw-medium mt-1">
                  <span className="text-dark">{emp.designation}</span> &bull; {emp.department}
                </div>
              </div>
            </div>
            <div className="mt-4 mt-md-0 d-flex align-items-center gap-3 pb-2">
              <span className={`badge bg-${emp.status === 'active' ? 'success' : emp.status === 'inactive' ? 'danger' : 'secondary'}-subtle text-${emp.status === 'active' ? 'success' : emp.status === 'inactive' ? 'danger' : 'secondary'} py-2 px-3 rounded-pill`} style={{ fontSize: 13 }}>
                <i className={`bi bi-circle-fill me-2 fs-7`} style={{ fontSize: '0.6em', verticalAlign: 'middle' }} />
                {emp.status.toUpperCase()}
              </span>
              {canEdit && (
                <button className="btn btn-outline-primary rounded-pill px-4 fw-medium" onClick={() => router.push(`/employees?edit=${emp._id}`)}>
                  <i className="bi bi-pencil-square me-2" />Edit Profile
                </button>
              )}
            </div>
          </div>
          
          <div className="d-flex flex-wrap gap-4 pt-3 border-top mt-2">
            <div className="d-flex align-items-center gap-2 text-secondary" style={{ fontSize: 14 }}>
              <i className="bi bi-envelope text-primary opacity-75" /> <span className="fw-medium text-dark">{emp.email}</span>
            </div>
            {emp.phone && (
              <div className="d-flex align-items-center gap-2 text-secondary" style={{ fontSize: 14 }}>
                <i className="bi bi-telephone text-primary opacity-75" /> <span className="fw-medium text-dark">{emp.phone}</span>
              </div>
            )}
            <div className="d-flex align-items-center gap-2 text-secondary" style={{ fontSize: 14 }}>
              <i className="bi bi-calendar-event text-primary opacity-75" /> <span>Joined <span className="fw-medium text-dark">{formatDate(emp.joinDate)}</span></span>
            </div>
            <div className="d-flex align-items-center gap-2 text-secondary" style={{ fontSize: 14 }}>
              <i className="bi bi-shield-check text-primary opacity-75" /> <span>Role: <span className="fw-medium text-dark">{ROLE_LABELS[emp.role] || emp.role}</span></span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs nav-tabs-custom mb-4 border-bottom-0 gap-2">
        {['overview', 'attendance', 'assets', 'payroll'].map(t => {
          if (t === 'payroll' && (!data.payslips || !data.payslips.length) && !['super_admin', 'admin_full', 'team_admin'].includes(user?.role)) return null;
          return (
            <li className="nav-item" key={t}>
              <button 
                className={`nav-link border-0 fw-medium ${tab === t ? 'active text-primary bg-primary-subtle rounded-pill' : 'text-secondary bg-transparent'}`}
                style={{ padding: '8px 24px', transition: 'all 0.2s', fontSize: 14 }}
                onClick={() => setTab(t)}
              >
                {t === 'assets' ? 'Assets & Docs' : t.charAt(0).toUpperCase() + t.slice(1).replace('-', ' & ')}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Tab Content: Overview */}
      {tab === 'overview' && (
        <div className="row g-4">
          <div className="col-md-8">
            <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 12 }}>
              <div className="card-header bg-white border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0 text-dark">Professional Summary</h5>
              </div>
              <div className="card-body">
                <div className="row g-4 mb-4">
                  <div className="col-sm-6">
                    <div className="text-secondary small fw-bold text-uppercase tracking-wider mb-1" style={{ letterSpacing: 0.5, fontSize: 11 }}>Department</div>
                    <div className="fw-semibold fs-5">{emp.department}</div>
                  </div>
                  <div className="col-sm-6">
                    <div className="text-secondary small fw-bold text-uppercase tracking-wider mb-1" style={{ letterSpacing: 0.5, fontSize: 11 }}>Shift Schedule</div>
                    <div className="fw-semibold fs-5">{emp.shift}</div>
                  </div>
                </div>
                
                <h6 className="fw-bold mb-3 mt-4 text-dark">Skills & Competencies</h6>
                {emp.skills?.length > 0 ? (
                  <div className="d-flex flex-wrap gap-2">
                    {emp.skills.map((s, i) => (
                      <span key={i} className="badge bg-light text-dark border px-3 py-2 rounded-pill fw-medium" style={{ fontSize: 13 }}>{s}</span>
                    ))}
                  </div>
                ) : <span className="text-muted fst-italic">No skills listed.</span>}
              </div>
            </div>
          </div>
          <div className="col-md-4">
            <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 12 }}>
              <div className="card-header bg-white border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0 text-dark">Reporting Chain</h5>
              </div>
              <div className="card-body pt-4">
                <div className="d-flex flex-column gap-4 position-relative px-2">
                  <div style={{ position: 'absolute', left: 32, top: 24, bottom: 24, width: 2, background: '#e2e8f0', zIndex: 0 }}></div>
                  
                  {emp.teamAdminId && (
                    <div className="d-flex align-items-center gap-3 position-relative bg-white" style={{ zIndex: 1 }}>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #60a5fa)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 18, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        {emp.teamAdminId.name.charAt(0)}
                      </div>
                      <div>
                        <div className="fw-bold text-dark">{emp.teamAdminId.name}</div>
                        <div className="text-secondary small fw-medium">Team Admin</div>
                      </div>
                    </div>
                  )}
                  {emp.teamLeadId && (
                    <div className="d-flex align-items-center gap-3 position-relative bg-white" style={{ zIndex: 1 }}>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #34d399)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 18, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        {emp.teamLeadId.name.charAt(0)}
                      </div>
                      <div>
                        <div className="fw-bold text-dark">{emp.teamLeadId.name}</div>
                        <div className="text-secondary small fw-medium">Team Lead</div>
                      </div>
                    </div>
                  )}
                  <div className="d-flex align-items-center gap-3 position-relative bg-white" style={{ zIndex: 1 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #64748b, #94a3b8)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 18, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                      {emp.name.charAt(0)}
                    </div>
                    <div>
                      <div className="fw-bold text-dark">{emp.name}</div>
                      <div className="text-secondary small fw-medium">Employee</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Attendance & Leave */}
      {tab === 'attendance' && (
        <div className="row g-4">
          <div className="col-md-4">
            <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 12 }}>
              <div className="card-body text-center p-5 d-flex flex-column justify-content-center">
                <div className="mb-4 text-secondary fw-bold text-uppercase tracking-wider" style={{ letterSpacing: 1, fontSize: 12 }}>Available Leave Balance</div>
                <div style={{ fontSize: 64, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                  {emp.leaveBalance || 0} <span style={{ fontSize: 20, color: '#64748b', fontWeight: 600 }}>Days</span>
                </div>
                <div className="mt-4 text-secondary small">Annual allocation remaining for this year.</div>
              </div>
            </div>
          </div>
          <div className="col-md-8">
            <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 12 }}>
              <div className="card-header bg-white border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0 text-dark">Recent Leave Requests</h5>
              </div>
              <div className="card-body">
                {data.leaves?.length > 0 ? (
                  <div className="table-responsive">
                    <table className="table table-borderless align-middle">
                      <thead className="table-light text-secondary" style={{ fontSize: 13 }}>
                        <tr>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Date Range</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Type</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Days</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontSize: 14 }}>
                        {data.leaves.map(l => (
                          <tr key={l._id} className="border-bottom">
                            <td className="py-3 text-dark">{formatDate(l.startDate)} - {formatDate(l.endDate)}</td>
                            <td className="fw-medium text-dark">{l.type}</td>
                            <td className="text-dark fw-medium">{l.days}</td>
                            <td>
                              <span className={`badge bg-${l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'warning'}-subtle text-${l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'warning'} rounded-pill px-3 py-1`} style={{ fontWeight: 600 }}>
                                {l.status.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-5">
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#cbd5e1' }}>
                      <i className="bi bi-calendar-x fs-3" />
                    </div>
                    <div className="text-muted fw-medium">No recent leave requests found.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="col-12">
            <div className="card shadow-sm border-0" style={{ borderRadius: 12 }}>
              <div className="card-header bg-white border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0 text-dark">Recent Attendance <span className="fw-normal text-secondary fs-6">(Last 30 Days)</span></h5>
              </div>
              <div className="card-body">
                {data.attendance?.length > 0 ? (
                  <div className="table-responsive">
                    <table className="table table-hover align-middle">
                      <thead className="table-light text-secondary" style={{ fontSize: 13 }}>
                        <tr>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Date</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Check In</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Check Out</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Hours Logged</th>
                          <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontSize: 14 }}>
                        {data.attendance.map(a => (
                          <tr key={a._id}>
                            <td className="fw-medium text-dark py-3">{formatDate(a.date)}</td>
                            <td>{a.checkIn ? new Date(a.checkIn).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--'}</td>
                            <td>{a.checkOut ? new Date(a.checkOut).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--'}</td>
                            <td className="font-monospace fw-medium">{a.checkIn && a.checkOut ? (Math.abs(new Date(a.checkOut) - new Date(a.checkIn)) / 3600000).toFixed(1) + 'h' : '--'}</td>
                            <td>
                              <span className={`badge bg-${a.status === 'present' ? 'success' : a.status === 'absent' ? 'danger' : 'warning'}-subtle text-${a.status === 'present' ? 'success' : a.status === 'absent' ? 'danger' : 'warning'} rounded-pill px-3 py-1`} style={{ fontWeight: 600 }}>
                                {a.status.toUpperCase()}
                              </span>
                              {a.late && <span className="badge bg-danger ms-2 rounded-pill px-2">Late</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-5">
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#cbd5e1' }}>
                      <i className="bi bi-clock-history fs-3" />
                    </div>
                    <div className="text-muted fw-medium">No recent attendance records found.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Assets & Docs */}
      {tab === 'assets' && (
        <div className="row g-4">
          <div className="col-md-6">
            <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 12 }}>
              <div className="card-header bg-white border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0 text-dark">Assigned Equipment</h5>
              </div>
              <div className="card-body">
                {data.assets?.length > 0 ? (
                  <div className="d-flex flex-column gap-3 mt-2">
                    {data.assets.map(a => (
                      <div key={a._id} className="d-flex align-items-center p-3 border rounded bg-white shadow-sm" style={{ borderColor: '#f1f5f9' }}>
                        <div style={{ width: 56, height: 56, borderRadius: 12, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: '#3b82f6', marginRight: 16 }}>
                          <i className={`bi bi-${a.category?.toLowerCase().includes('laptop') ? 'laptop' : a.category?.toLowerCase().includes('phone') ? 'phone' : 'device-hdd'}`} />
                        </div>
                        <div className="flex-grow-1">
                          <h6 className="fw-bold mb-1 text-dark">{a.name}</h6>
                          <div className="text-secondary small d-flex gap-4 mt-1">
                            <span>ID: <span className="font-monospace text-dark fw-medium">{a.assetId}</span></span>
                            <span>Condition: <span className={`fw-medium text-capitalize ${a.condition === 'good' ? 'text-success' : a.condition === 'repair' ? 'text-danger' : 'text-warning'}`}>{a.condition}</span></span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-5 border rounded border-dashed bg-light mt-3" style={{ borderColor: '#cbd5e1' }}>
                     <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#cbd5e1', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                      <i className="bi bi-pc-display fs-4" />
                    </div>
                    <div className="text-muted fw-medium">No equipment assigned.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="col-md-6">
            <div className="card shadow-sm border-0 h-100" style={{ borderRadius: 12 }}>
              <div className="card-header bg-white border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0 text-dark">Employee Documents</h5>
              </div>
              <div className="card-body">
                {data.documents?.length > 0 ? (
                  <div className="list-group list-group-flush mt-2">
                    {data.documents.map(d => (
                      <div key={d._id} className="list-group-item d-flex justify-content-between align-items-center py-3 px-2 border-bottom">
                        <div className="d-flex align-items-center gap-3">
                          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', border: '1px solid #e2e8f0' }}>
                            <i className="bi bi-file-earmark-text-fill fs-5" />
                          </div>
                          <div>
                            <div className="fw-bold text-dark">{d.name}</div>
                            <div className="text-secondary small mt-1">Uploaded {formatDate(d.createdAt)} &bull; {d.fileSize || 'Unknown size'}</div>
                          </div>
                        </div>
                        <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-light border rounded-circle shadow-sm" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <i className="bi bi-download text-primary" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-5 border rounded border-dashed bg-light mt-3" style={{ borderColor: '#cbd5e1' }}>
                    <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#cbd5e1', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                      <i className="bi bi-file-earmark-x fs-4" />
                    </div>
                    <div className="text-muted fw-medium">No documents uploaded.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Payroll */}
      {tab === 'payroll' && (
        <div className="card shadow-sm border-0" style={{ borderRadius: 12 }}>
          <div className="card-header bg-white border-0 pt-4 pb-0">
            <h5 className="fw-bold mb-0 text-dark">Payslips History</h5>
          </div>
          <div className="card-body">
            {data.payslips?.length > 0 ? (
              <div className="table-responsive mt-2">
                <table className="table table-hover align-middle">
                  <thead className="table-light text-secondary" style={{ fontSize: 13 }}>
                    <tr>
                      <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Month/Year</th>
                      <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Gross Pay</th>
                      <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Deductions</th>
                      <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Net Pay</th>
                      <th className="fw-medium text-uppercase" style={{ letterSpacing: 0.5 }}>Status</th>
                      <th className="fw-medium text-uppercase text-end" style={{ letterSpacing: 0.5 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontSize: 14 }}>
                    {data.payslips.map(p => (
                      <tr key={p._id}>
                        <td className="fw-bold text-dark py-3">{p.month} {p.year}</td>
                        <td className="font-monospace fw-medium">₹{p.grossPay?.toLocaleString() || 0}</td>
                        <td className="font-monospace fw-medium text-danger">₹{p.totalDeductions?.toLocaleString() || 0}</td>
                        <td className="font-monospace fw-bold text-success fs-6">₹{p.netPay?.toLocaleString() || 0}</td>
                        <td>
                          <span className={`badge bg-${p.status === 'paid' ? 'success' : 'warning'}-subtle text-${p.status === 'paid' ? 'success' : 'warning'} rounded-pill px-3 py-1`} style={{ fontWeight: 600 }}>
                            {p.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-outline-primary rounded-pill px-3 fw-medium">
                            <i className="bi bi-download me-1" /> PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-5">
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#cbd5e1' }}>
                  <i className="bi bi-cash-stack fs-3" />
                </div>
                <div className="text-muted fw-medium">No payslips available for this employee.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
