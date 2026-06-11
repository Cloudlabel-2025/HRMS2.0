'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const TABS = [
  { key: 'overview',    label: 'Overview',      icon: 'bi-person-lines-fill' },
  { key: 'personal',   label: 'Personal Info',  icon: 'bi-card-personal' },
  { key: 'attendance', label: 'Attendance',     icon: 'bi-clock-history' },
  { key: 'assets',     label: 'Assets & Docs',  icon: 'bi-box-seam' },
  { key: 'payroll',    label: 'Payroll',        icon: 'bi-cash-stack' },
];

function InfoRow({ icon, label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 14 }} />
      </div>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1e293b', marginTop: 2, textTransform: 'capitalize' }}>{value}</div>
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children }) {
  return (
    <div className="card" style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 15 }} />
        </div>
        <span style={{ fontWeight: 750, fontSize: 14.5, color: '#1e293b' }}>{title}</span>
      </div>
      <div style={{ padding: '4px 18px 14px' }}>{children}</div>
    </div>
  );
}

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { formatDate } = useSettings();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [toast, setToast] = useState({ msg: '', type: 'success' });
  const [idForm, setIdForm] = useState({ panNumber: '', aadhaarNumber: '' });
  const [idSaving, setIdSaving] = useState(false);
  const [showIdForm, setShowIdForm] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: 'success' }), 3000);
  };

  useEffect(() => {
    if (id) {
      api.get(`/api/employees/${id}/details`)
        .then(res => { setData(res); })
        .catch(e => { showToast(e.message, 'error'); setTimeout(() => router.push('/employees'), 2000); })
        .finally(() => setLoading(false));
    }
  }, [id, router]);

  if (loading) return (
    <AppShell title="Loading...">
      <div style={{ textAlign: 'center', padding: 100 }}><div className="spinner-border text-primary" /></div>
    </AppShell>
  );

  if (!data) return (
    <AppShell title="Not Found">
      <div className="alert alert-danger m-4">Employee not found.</div>
    </AppShell>
  );

  const emp = data.employee;
  const identity = data.identity;
  const profile = data.profile;
  const canEdit = ['super_admin', 'admin_full'].includes(user?.role);

  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const AADHAAR_RE = /^[0-9]{12}$/;

  const saveIdentifiers = async () => {
    if (!data?.identity?._id) return showToast('No identity record found', 'error');
    if (!idForm.panNumber && !idForm.aadhaarNumber) return showToast('Enter PAN or Aadhaar to save', 'error');
    const pan = idForm.panNumber.toUpperCase().trim();
    const aadhaar = idForm.aadhaarNumber.replace(/\D/g, '');
    if (pan && !PAN_RE.test(pan)) return showToast('Invalid PAN — must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)', 'error');
    if (aadhaar && !AADHAAR_RE.test(aadhaar)) return showToast('Invalid Aadhaar — must be exactly 12 digits', 'error');
    setIdSaving(true);
    try {
      const payload = { identifiers: {} };
      if (pan) payload.identifiers.panNumber = pan;
      if (aadhaar) payload.identifiers.aadhaarNumber = aadhaar;
      await api.put(`/api/core/identities/${data.identity._id}`, payload);
      showToast('Identifiers saved securely');
      setIdForm({ panNumber: '', aadhaarNumber: '' });
      setShowIdForm(false);
      // Refresh data
      const res = await api.get(`/api/employees/${id}/details`);
      setData(res);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setIdSaving(false);
    }
  };
  const visibleTabs = TABS.filter(t => {
    if (t.key === 'payroll' && !['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role) && (!data.payslips?.length)) return false;
    return true;
  });

  const statusColor = emp.status === 'active' ? '#10b981' : emp.status === 'inactive' ? '#ef4444' : '#64748b';
  const statusBg = emp.status === 'active' ? '#dcfce7' : emp.status === 'inactive' ? '#fee2e2' : '#f1f5f9';

  return (
    <AppShell title="Employee Profile">
      {toast.msg && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      {/* Hero Banner */}
      <div className="card mb-4" style={{ borderRadius: 16, overflow: 'hidden', border: 'none' }}>
        <div style={{ height: 110, background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#3b82f6'} 0%, #1e293b 100%)` }} />
        <div style={{ padding: '0 28px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginTop: -48 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
              <div style={{ width: 96, height: 96, borderRadius: 20, background: '#fff', padding: 4, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', flexShrink: 0 }}>
                <div style={{ width: '100%', height: '100%', borderRadius: 16, background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#3b82f6'}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: '#fff' }}>
                  {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
              </div>
              <div style={{ paddingBottom: 4 }}>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: 22, color: '#0f172a' }}>{emp.name}</h3>
                <div style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
                  <span style={{ fontWeight: 600, color: '#334155' }}>{emp.designation || 'No Designation'}</span>
                  {emp.department && <> &bull; {emp.department}</>}
                </div>
                {profile?.employeeNumber && (
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                    <i className="bi bi-tag me-1" />{profile.employeeNumber}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
              <span className="badge" style={{ background: statusBg, color: statusColor, fontSize: 12, padding: '6px 14px' }}>
                <i className="bi bi-circle-fill me-2" style={{ fontSize: 7 }} />
                {emp.status.toUpperCase()}
              </span>
              <span className="badge" style={{ background: (ROLE_COLORS[emp.role] || '#64748b') + '20', color: ROLE_COLORS[emp.role] || '#64748b', fontSize: 12, padding: '6px 14px' }}>
                {ROLE_LABELS[emp.role] || emp.role}
              </span>
              {canEdit && (
                <button className="btn btn-outline-primary" style={{ fontSize: 13, padding: '6px 16px' }} onClick={() => router.push(`/employees?edit=${emp._id}`)}>
                  <i className="bi bi-pencil me-1" />Edit
                </button>
              )}
            </div>
          </div>

          {/* Quick info strip */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
            {[
              { icon: 'bi-envelope', val: emp.email },
              { icon: 'bi-telephone', val: emp.phone },
              { icon: 'bi-calendar2', val: emp.joinDate ? `Joined ${formatDate(emp.joinDate)}` : null },
              { icon: 'bi-clock', val: emp.shift },
              { icon: 'bi-geo-alt', val: profile?.workLocation },
            ].filter(i => i.val).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#475569' }}>
                <i className={`bi ${item.icon}`} style={{ color: '#3b82f6', fontSize: 14 }} />
                <span style={{ fontWeight: 500 }}>{item.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7,
            background: tab === t.key ? '#fff' : 'transparent',
            color: tab === t.key ? '#1e293b' : '#64748b',
            boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}>
            <i className={`bi ${t.icon}`} style={{ fontSize: 14 }} />{t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <div className="row g-3">
          <div className="col-lg-8">
            <div className="card" style={{ borderRadius: 12 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Professional Summary</span>
              </div>
              <div style={{ padding: 20 }}>
                <div className="row g-3 mb-4">
                  {[
                    ['Department', emp.department, 'bi-building'],
                    ['Shift', emp.shift, 'bi-clock'],
                    ['Status', profile?.employmentStatus?.replace(/_/g, ' ') || emp.status, 'bi-activity'],
                    ['Leave Balance', `${emp.leaveBalance || 0} days`, 'bi-calendar-check'],
                  ].map(([label, val, icon]) => (
                    <div key={label} className="col-sm-6">
                      <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <i className={`bi ${icon}`} style={{ color: '#3b82f6', fontSize: 14 }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b', textTransform: 'capitalize' }}>{val || '—'}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }}>Skills & Competencies</div>
                {emp.skills?.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {emp.skills.map((s, i) => (
                      <span key={i} className="badge" style={{ background: '#eff6ff', color: '#2563eb', fontSize: 12.5, padding: '6px 12px', fontWeight: 600 }}>{s}</span>
                    ))}
                  </div>
                ) : <span style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No skills listed.</span>}
              </div>
            </div>
          </div>

          <div className="col-lg-4">
            <div className="card" style={{ borderRadius: 12 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Reporting Chain</span>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', paddingLeft: 8 }}>
                  <div style={{ position: 'absolute', left: 27, top: 24, bottom: 24, width: 2, background: '#e2e8f0' }} />
                  {[
                    { person: emp.teamAdminId, role: 'Team Admin', color: '#3b82f6' },
                    { person: emp.teamLeadId, role: 'Team Lead', color: '#10b981' },
                    { person: { name: emp.name, avatar: emp.avatar }, role: 'Employee', color: '#64748b' },
                  ].filter(r => r.person).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1, background: '#fff' }}>
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${r.color}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                        {r.person.name?.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1e293b' }}>{r.person.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>{r.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PERSONAL INFO TAB */}
      {tab === 'personal' && (
        <div className="row g-3">
          <div className="col-lg-6">
            <SectionCard title="Identity Details" icon="bi-person-vcard">
              {identity ? (
                <>
                  <InfoRow icon="bi-person" label="Legal Name" value={identity.legalName} />
                  <InfoRow icon="bi-person-badge" label="Preferred Name" value={identity.preferredName} />
                  <InfoRow icon="bi-envelope" label="Primary Email" value={identity.primaryEmail} />
                  <InfoRow icon="bi-telephone" label="Personal Phone" value={identity.personalPhone} />
                  <InfoRow icon="bi-telephone-plus" label="Secondary Phone" value={identity.secondaryPhone} />
                  <InfoRow icon="bi-gender-ambiguous" label="Gender" value={identity.gender?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-heart" label="Marital Status" value={identity.maritalStatus?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-flag" label="Nationality" value={identity.nationality} />
                  <InfoRow icon="bi-droplet" label="Blood Group" value={identity.bloodGroup} />

                  {/* PAN / Aadhaar — admin only */}
                  {canEdit && (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <i className="bi bi-shield-lock" style={{ color: '#94a3b8', fontSize: 13 }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Sensitive Identifiers</span>
                        </div>
                        <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setShowIdForm(p => !p)}>
                          <i className={`bi ${showIdForm ? 'bi-x-lg' : 'bi-pencil'} me-1`} style={{ fontSize: 10 }} />{showIdForm ? 'Cancel' : 'Update'}
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {[['PAN', identity.identifiers?.pan?.maskedValue], ['Aadhaar', identity.identifiers?.aadhaar?.maskedValue]].map(([label, val]) => (
                          <div key={label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
                            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
                            {val ? (
                              <div style={{ fontSize: 13.5, fontWeight: 700, fontFamily: 'monospace', letterSpacing: 1.5, color: '#1e293b' }}>{val}</div>
                            ) : (
                              <div style={{ fontSize: 12, color: '#cbd5e1', fontStyle: 'italic' }}>Not entered</div>
                            )}
                          </div>
                        ))}
                      </div>
                      {showIdForm && (
                        <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 14 }}>
                          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="bi bi-lock-fill" style={{ fontSize: 11 }} /> Values are stored encrypted. Only masked values are shown after saving.
                          </div>
                          <div className="row g-2">
                            <div className="col-6">
                              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>PAN Number</label>
                              <input className="form-control" style={{ fontSize: 13, fontFamily: 'monospace', letterSpacing: 1 }} placeholder="ABCDE1234F" maxLength={10} value={idForm.panNumber} onChange={e => setIdForm(p => ({ ...p, panNumber: e.target.value.toUpperCase() }))} />
                            </div>
                            <div className="col-6">
                              <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Aadhaar Number</label>
                              <input className="form-control" style={{ fontSize: 13, fontFamily: 'monospace', letterSpacing: 1 }} placeholder="123456789012" maxLength={12} value={idForm.aadhaarNumber} onChange={e => setIdForm(p => ({ ...p, aadhaarNumber: e.target.value.replace(/\D/g, '') }))} />
                            </div>
                            <div className="col-12">
                              <button className="btn btn-sm" style={{ background: '#f59e0b', color: '#fff', border: 'none', fontSize: 12 }} onClick={saveIdentifiers} disabled={idSaving}>
                                {idSaving ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />Saving...</> : <><i className="bi bi-shield-check me-1" />Save Securely</>}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-person-x" />
                  <p>No identity record found</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Employment Profile" icon="bi-briefcase">
              {profile ? (
                <>
                  <InfoRow icon="bi-tag" label="Employee Number" value={profile.employeeNumber} />
                  <InfoRow icon="bi-person-workspace" label="Employment Type" value={profile.employmentType?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-activity" label="Employment Status" value={profile.employmentStatus?.replace(/_/g, ' ')} />
                  <InfoRow icon="bi-building" label="Business Unit" value={profile.businessUnit} />
                  <InfoRow icon="bi-geo-alt" label="Work Location" value={profile.workLocation} />
                  <InfoRow icon="bi-calendar2-check" label="Hire Date" value={formatDate(profile.hireDate)} />
                  <InfoRow icon="bi-patch-check" label="Confirmation Date" value={formatDate(profile.confirmationDate)} />
                </>
              ) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-briefcase" />
                  <p>No employment profile found</p>
                </div>
              )}
            </SectionCard>
          </div>

          <div className="col-lg-6">
            <SectionCard title="Address" icon="bi-house">
              {identity?.addressHistory?.length > 0 ? identity.addressHistory.map((addr, i) => (
                <div key={i} style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 14, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', textTransform: 'capitalize', fontSize: 12 }}>
                      <i className="bi bi-geo-alt me-1" />{addr.addressType}
                    </span>
                    {addr.isCurrent && <span className="badge" style={{ background: '#dcfce7', color: '#16a34a', fontSize: 11 }}>Current</span>}
                  </div>
                  <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6 }}>
                    <div>{addr.line1}{addr.line2 ? ', ' + addr.line2 : ''}</div>
                    <div>{[addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')}</div>
                    <div style={{ color: '#64748b' }}>{addr.country}</div>
                    {addr.landmark && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}><i className="bi bi-pin me-1" />Near: {addr.landmark}</div>}
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-house" />
                  <p>No address on record</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Emergency Contacts" icon="bi-telephone-inbound">
              {identity?.emergencyContacts?.length > 0 ? identity.emergencyContacts.map((c, i) => (
                <div key={i} style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 14, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #ef4444, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {c.name?.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1e293b' }}>{c.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{c.relation}</div>
                    </div>
                    {c.isPrimary && <span className="badge ms-auto" style={{ background: '#fef3c7', color: '#d97706', fontSize: 11 }}>Primary</span>}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div><i className="bi bi-telephone me-2" style={{ color: '#3b82f6' }} />{c.phone}</div>
                    {c.email && <div><i className="bi bi-envelope me-2" style={{ color: '#3b82f6' }} />{c.email}</div>}
                  </div>
                </div>
              )) : (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <i className="bi bi-telephone-x" />
                  <p>No emergency contacts on record</p>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      )}

      {/* ATTENDANCE TAB */}
      {tab === 'attendance' && (
        <div className="row g-3">
          <div className="col-md-4">
            <div className="stat-card text-center" style={{ padding: 32 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Leave Balance</div>
              <div style={{ fontSize: 56, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{emp.leaveBalance || 0}</div>
              <div style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>days remaining</div>
            </div>
          </div>

          <div className="col-md-8">
            <div className="card" style={{ borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Recent Leave Requests</span>
              </div>
              {data.leaves?.length > 0 ? (
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.leaves.map(l => (
                        <tr key={l._id}>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>{l.type}</td>
                          <td style={{ fontSize: 13 }}>{l.from}</td>
                          <td style={{ fontSize: 13 }}>{l.to}</td>
                          <td><span className="badge" style={{ background: '#f1f5f9', color: '#1e293b' }}>{l.days}d</span></td>
                          <td><span className={`badge status-${l.status}`}>{l.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state"><i className="bi bi-calendar-x" /><p>No leave requests found</p></div>
              )}
            </div>
          </div>

          <div className="col-12">
            <div className="card" style={{ borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Attendance — Last 30 Days</span>
              </div>
              {data.attendance?.length > 0 ? (
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.attendance.map(a => (
                        <tr key={a._id}>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(a.date)}</td>
                          <td style={{ fontSize: 13 }}>{a.clockIn || '—'}</td>
                          <td style={{ fontSize: 13 }}>{a.clockOut || '—'}</td>
                          <td style={{ fontSize: 13 }}>{a.hoursWorked ? `${Math.floor(a.hoursWorked / 60)}h ${a.hoursWorked % 60}m` : '—'}</td>
                          <td>
                            <span className={`badge status-${a.status}`}>{a.status}</span>
                            {a.lateFlag && <span className="badge status-late ms-1">Late</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state"><i className="bi bi-clock-history" /><p>No attendance records found</p></div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ASSETS & DOCS TAB */}
      {tab === 'assets' && (
        <div className="row g-3">
          <div className="col-md-6">
            <div className="card" style={{ borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Assigned Assets</span>
              </div>
              <div style={{ padding: 16 }}>
                {data.assets?.length > 0 ? data.assets.map(a => (
                  <div key={a._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className={`bi bi-${a.category?.toLowerCase().includes('laptop') ? 'laptop' : a.category?.toLowerCase().includes('phone') ? 'phone' : 'device-hdd'}`} style={{ color: '#3b82f6', fontSize: 18 }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1e293b' }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>ID: {a.assetId} &bull; <span style={{ textTransform: 'capitalize', color: a.condition === 'good' ? '#16a34a' : a.condition === 'repair' ? '#dc2626' : '#d97706' }}>{a.condition}</span></div>
                    </div>
                    <span className="badge" style={{ background: '#f1f5f9', color: '#475569', textTransform: 'capitalize' }}>{a.status}</span>
                  </div>
                )) : <div className="empty-state"><i className="bi bi-box-seam" /><p>No assets assigned</p></div>}
              </div>
            </div>
          </div>

          <div className="col-md-6">
            <div className="card" style={{ borderRadius: 12 }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 750, fontSize: 14.5 }}>Documents</span>
              </div>
              <div style={{ padding: 16 }}>
                {data.documents?.length > 0 ? data.documents.map(d => (
                  <div key={d._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <i className="bi bi-file-earmark-text" style={{ color: '#64748b', fontSize: 18 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{formatDate(d.createdAt)} &bull; {d.fileSize || 'Unknown size'}</div>
                    </div>
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary" style={{ padding: '5px 10px', fontSize: 12 }}>
                      <i className="bi bi-download" />
                    </a>
                  </div>
                )) : <div className="empty-state"><i className="bi bi-file-earmark-x" /><p>No documents uploaded</p></div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PAYROLL TAB */}
      {tab === 'payroll' && (
        <div className="card" style={{ borderRadius: 12 }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontWeight: 750, fontSize: 14.5 }}>Payslip History</span>
          </div>
          {data.payslips?.length > 0 ? (
            <div className="table-responsive">
              <table className="table mb-0">
                <thead><tr><th>Month</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Status</th></tr></thead>
                <tbody>
                  {data.payslips.map(p => (
                    <tr key={p._id}>
                      <td style={{ fontSize: 13, fontWeight: 700 }}>{p.month}</td>
                      <td style={{ fontSize: 13 }}>₹{Number(p.grossPay || 0).toLocaleString('en-IN')}</td>
                      <td style={{ fontSize: 13, color: '#ef4444' }}>₹{Number(p.totalDeductions || 0).toLocaleString('en-IN')}</td>
                      <td style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>₹{Number(p.netPay || 0).toLocaleString('en-IN')}</td>
                      <td><span className={`badge ${p.status === 'finalized' ? 'status-approved' : 'status-pending'}`}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><i className="bi bi-cash-stack" /><p>No payslips available</p></div>
          )}
        </div>
      )}
    </AppShell>
  );
}
