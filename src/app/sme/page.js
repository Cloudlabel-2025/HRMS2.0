'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const EMPTY_SME = {
  name: '', email: '', password: '', phone: '', dob: '', pan: '',
  expertise: '', departments: '',
  bankName: '', accountNumber: '', ifscCode: '', accountHolder: '',
  rateAmount: '', rateType: 'hourly', contractStart: '', contractEnd: '',
  status: 'active',
};

export default function SMEPage() {
  const { user } = useAuth();
  const [smes, setSmes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [expertiseOptions, setExpertiseOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_SME);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [expertiseInput, setExpertiseInput] = useState('');
  const [deptInput, setDeptInput] = useState('');

  // Monitoring tab
  const [activeTab, setActiveTab] = useState('all');
  const [smeLeaves, setSmeLeaves] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [selectedMonSme, setSelectedMonSme] = useState(null);
  const [expandedMonDate, setExpandedMonDate] = useState(null);

  // Work Progress tab
  const [selectedWpSme, setSelectedWpSme] = useState(null);
  const [expandedWpDate, setExpandedWpDate] = useState(null);

  // Leave Requests tab
  const [leaveStatusFilter, setLeaveStatusFilter] = useState('all');
  const [leaveSearchTerm, setLeaveSearchTerm] = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
  const [leaveFromDate, setLeaveFromDate] = useState('');
  const [leaveToDate, setLeaveToDate] = useState('');

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  if (user && user.role !== 'super_admin') return (
    <AppShell title="SME Portal">
      <div className="empty-state"><i className="bi bi-person-gear" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>SME Portal is only accessible to Super Admin and Management Admin.</p></div>
    </AppShell>
  );

  const load = async () => {
    setLoading(true);
    try {
      const [data, depts, exp] = await Promise.all([
        api.get('/api/sme'),
        api.get('/api/settings?type=departments'),
        api.get('/api/settings?type=sme_expertise'),
      ]);
      setSmes(Array.isArray(data?.smes) ? data.smes : []);
      setDepartments(Array.isArray(depts) ? depts : []);
      setExpertiseOptions(Array.isArray(exp) ? exp : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if ((activeTab !== 'monitoring' && activeTab !== 'work' && activeTab !== 'leave-requests') || user?.role !== 'super_admin') return;
    setMonitoringLoading(true);
    const promises = [api.get('/api/tasks')];
    if (activeTab === 'monitoring' || activeTab === 'leave-requests') promises.push(api.get('/api/leave?scope=all&smeOnly=true'));
    Promise.all(promises).then(([tasksData, leavesData]) => {
      setAllTasks(Array.isArray(tasksData) ? tasksData : []);
      if (leavesData) setSmeLeaves(Array.isArray(leavesData) ? leavesData : []);
    }).catch(e => showToast(e.message, 'error'))
      .finally(() => setMonitoringLoading(false));
  }, [activeTab, user]);

  const actionLeave = async (leaveId, action) => {
    try {
      await api.put(`/api/leave/${leaveId}`, { action });
      showToast(`Leave ${action} successfully`);
      const res = await api.get('/api/leave?scope=all&smeOnly=true');
      setSmeLeaves(Array.isArray(res) ? res : []);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleSubmit = async () => {
    if (!form.name || !form.email) return showToast('Name and email are required', 'error');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        email: form.email,
        password: form.password || undefined,
        phone: form.phone,
        pan: form.pan,
        dob: form.dob || undefined,
        expertise: form.expertise ? form.expertise.split(',').map(s => s.trim()).filter(Boolean) : [],
        departments: form.departments ? form.departments.split(',').map(s => s.trim()).filter(Boolean) : [],
        accountDetails: {
          bankName: form.bankName,
          accountNumber: form.accountNumber,
          ifscCode: form.ifscCode,
          accountHolder: form.accountHolder || form.name,
        },
        rate: {
          amount: parseFloat(form.rateAmount) || 0,
          type: form.rateType,
        },
        contractStart: form.contractStart || undefined,
        contractEnd: form.contractEnd || undefined,
        status: form.status || 'active',
      };

      if (form._id) {
        await api.put('/api/sme', { id: form._id, ...payload });
        showToast('SME updated successfully');
      } else {
        const result = await api.post('/api/sme', payload);
        setCredentials(result.credentials);
        showToast('SME added successfully');
      }

      setShowModal(false);
      setForm(EMPTY_SME);
      setExpertiseInput('');
      setDeptInput('');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (sme) => {
    setForm({
      _id: sme._id,
      name: sme.name || '',
      email: sme.email || '',
      password: '',
      phone: sme.phone || '',
      dob: sme.dob ? sme.dob.split('T')[0] : '',
      pan: sme.pan || '',
      expertise: Array.isArray(sme.expertise) ? sme.expertise.join(', ') : '',
      departments: Array.isArray(sme.departments) ? sme.departments.join(', ') : '',
      bankName: sme.accountDetails?.bankName || '',
      accountNumber: sme.accountDetails?.accountNumber || '',
      ifscCode: sme.accountDetails?.ifscCode || '',
      accountHolder: sme.accountDetails?.accountHolder || '',
      rateAmount: sme.rate?.amount?.toString() || '',
      rateType: sme.rate?.type || 'hourly',
      contractStart: sme.contractStart ? sme.contractStart.split('T')[0] : '',
      contractEnd: sme.contractEnd ? sme.contractEnd.split('T')[0] : '',
      status: sme.status || 'active',
    });
    setCredentials(null);
    setExpertiseInput('');
    setDeptInput('');
    setShowModal(true);
  };

  const openAdd = () => {
    setForm(EMPTY_SME);
    setCredentials(null);
    setExpertiseInput('');
    setDeptInput('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm(EMPTY_SME);
    setExpertiseInput('');
    setDeptInput('');
    setCredentials(null);
  };

  const toggleExpertise = (skill) => {
    const current = form.expertise ? form.expertise.split(',').map(s => s.trim()).filter(Boolean) : [];
    const updated = current.includes(skill)
      ? current.filter(s => s !== skill)
      : [...current, skill];
    setForm(p => ({ ...p, expertise: updated.join(', ') }));
  };

  const toggleDepartment = (dept) => {
    const current = form.departments ? form.departments.split(',').map(s => s.trim()).filter(Boolean) : [];
    const updated = current.includes(dept)
      ? current.filter(d => d !== dept)
      : [...current, dept];
    setForm(p => ({ ...p, departments: updated.join(', ') }));
  };

  return (
    <AppShell title="SME Portal">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
        <div>
          <h4><i className="bi bi-person-gear me-2" />Subject Matter Experts</h4>
          <p>Manage freelance Subject Matter Experts contracted for limited engagements</p>
        </div>
        {activeTab === 'all' && (
          <button className="btn btn-primary" onClick={openAdd}>
            <i className="bi bi-plus-lg me-2" />Add SME
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid #e2e8f0' }}>
        <button onClick={() => { setActiveTab('all'); setSelectedMonSme(null); setSelectedWpSme(null); }} style={{
          padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontWeight: activeTab === 'all' ? 700 : 500, fontSize: 13,
          color: activeTab === 'all' ? '#0891b2' : '#64748b',
          borderBottom: activeTab === 'all' ? '2px solid #0891b2' : '2px solid transparent',
          marginBottom: -2, transition: 'all 0.15s',
        }}>
          <i className="bi bi-people me-2" />All SMEs
        </button>
        <button onClick={() => { setActiveTab('monitoring'); setSelectedWpSme(null); }} style={{
          padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontWeight: activeTab === 'monitoring' ? 700 : 500, fontSize: 13,
          color: activeTab === 'monitoring' ? '#0891b2' : '#64748b',
          borderBottom: activeTab === 'monitoring' ? '2px solid #0891b2' : '2px solid transparent',
          marginBottom: -2, transition: 'all 0.15s',
        }}>
          <i className="bi bi-graph-up me-2" />Monitoring
        </button>
        <button onClick={() => { setActiveTab('work'); setSelectedMonSme(null); }} style={{
          padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontWeight: activeTab === 'work' ? 700 : 500, fontSize: 13,
          color: activeTab === 'work' ? '#0891b2' : '#64748b',
          borderBottom: activeTab === 'work' ? '2px solid #0891b2' : '2px solid transparent',
          marginBottom: -2, transition: 'all 0.15s',
        }}>
          <i className="bi bi-list-task me-2" />Work Progress
        </button>
        <button onClick={() => { setActiveTab('leave-requests'); setSelectedMonSme(null); setSelectedWpSme(null); }} style={{
          padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer',
          fontWeight: activeTab === 'leave-requests' ? 700 : 500, fontSize: 13,
          color: activeTab === 'leave-requests' ? '#0891b2' : '#64748b',
          borderBottom: activeTab === 'leave-requests' ? '2px solid #0891b2' : '2px solid transparent',
          marginBottom: -2, transition: 'all 0.15s',
        }}>
          <i className="bi bi-calendar-check me-2" />Leave Requests
        </button>
      </div>

      {/* ── All SMEs Tab ── */}
      {activeTab === 'all' && (
        loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
          <div className="card p-0" style={{ overflow: 'hidden' }}>
            {smes.length === 0 ? (
              <div className="empty-state" style={{ padding: 60 }}>
                <i className="bi bi-person-gear" style={{ fontSize: 40, color: '#94a3b8' }} />
                <h6 style={{ marginTop: 12 }}>No Subject Matter Experts yet</h6>
                <p style={{ fontSize: 13, color: '#94a3b8' }}>Click "Add SME" to onboard a freelance expert</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table" style={{ margin: 0, fontSize: 13 }}>
                  <thead style={{ background: '#f8fafc' }}>
                    <tr>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Name</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Email</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Expertise</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Rate</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Contract</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {smes.map(sme => (
                      <tr key={sme._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '12px 16px' }}>
                          <Link href={`/sme/${sme._id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{sme.name[0]}</div>
                            <div>
                              <div style={{ fontWeight: 600, color: '#0f172a' }}>{sme.name}</div>
                              {sme.dob && <div style={{ fontSize: 11, color: '#94a3b8' }}>DOB: {new Date(sme.dob).toLocaleDateString()}</div>}
                            </div>
                          </Link>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#64748b' }}>{sme.email}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {(sme.expertise || []).slice(0, 2).map((exp, i) => (
                              <span key={i} className="badge" style={{ background: '#0891b220', color: '#0891b2', fontSize: 10, fontWeight: 600, borderRadius: 6 }}>{exp}</span>
                            ))}
                            {(sme.expertise || []).length > 2 && (
                              <span style={{ fontSize: 10, color: '#94a3b8' }}>+{sme.expertise.length - 2} more</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {sme.rate?.amount > 0 ? (
                            <span style={{ fontWeight: 600 }}>₹{sme.rate.amount}/{sme.rate.type === 'hourly' ? 'hr' : sme.rate.type === 'daily' ? 'day' : 'fixed'}</span>
                          ) : <span style={{ color: '#94a3b8' }}>—</span>}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 12 }}>
                          {sme.contractStart ? (
                            <div>
                              <div>{new Date(sme.contractStart).toLocaleDateString()}</div>
                              {sme.contractEnd && <div style={{ color: '#94a3b8' }}>→ {new Date(sme.contractEnd).toLocaleDateString()}</div>}
                            </div>
                          ) : <span style={{ color: '#94a3b8' }}>Open</span>}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span className={`badge ${sme.status === 'active' ? 'status-approved' : 'status-pending'}`} style={{ fontSize: 11 }}>{sme.status}</span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 12 }} onClick={() => openEdit(sme)}>
                            <i className="bi bi-pencil me-1" />Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}

      {/* ── Monitoring Tab ── */}
      {activeTab === 'monitoring' && (
        monitoringLoading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
          <div style={{ display: 'flex', gap: 20, minHeight: 'calc(100vh - 260px)' }}>
            {/* Left Sidebar ─ SME list */}
            <div className="card p-0" style={{ width: 260, flexShrink: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                <h6 style={{ fontSize: 12, fontWeight: 700, margin: 0 }}><i className="bi bi-people me-2" />SMEs ({smes.length})</h6>
              </div>
              <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
                {smes.filter(s => s.userId).length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No SMEs with linked accounts</div>
                ) : (
                  smes.filter(s => s.userId).map(sme => {
                    const smeTasks = allTasks.filter(t => t.assignedTo?._id === sme.userId);
                    const completed = smeTasks.filter(t => t.status === 'Completed').length;
                    const isSelected = selectedMonSme?._id === sme._id;
                    return (
                      <div key={sme._id} onClick={() => { setSelectedMonSme(sme); setExpandedMonDate(null); }}
                        style={{
                          padding: '10px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 10,
                          background: isSelected ? '#f0f9ff' : 'transparent',
                          borderLeft: isSelected ? '3px solid #0891b2' : '3px solid transparent',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8,
                          background: sme.status === 'active' ? 'linear-gradient(135deg,#0891b2,#06b6d4)' : '#cbd5e1',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0,
                        }}>{sme.name[0]}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sme.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            {smeTasks.length > 0 ? `${smeTasks.length} tasks • ${completed} done` : 'No tasks'}
                          </div>
                        </div>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: sme.status === 'active' ? '#059669' : '#94a3b8',
                        }} />
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Panel ─ Selected SME Work Progress */}
            <div style={{ flex: 1 }}>
              {!selectedMonSme ? (
                <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0', padding: 60, textAlign: 'center' }}>
                  <i className="bi bi-person-gear" style={{ fontSize: 40, color: '#e2e8f0' }} />
                  <h6 style={{ marginTop: 12, color: '#94a3b8', fontWeight: 600 }}>Select an SME from the left panel</h6>
                  <p style={{ fontSize: 13, color: '#cbd5e1' }}>View current work progress and task details</p>
                </div>
              ) : (() => {
                const sme = selectedMonSme;
                const smeTasks = allTasks.filter(t => t.assignedTo?._id === sme.userId);
                const todoTasks = smeTasks.filter(t => t.status === 'To Do' || t.status === 'Pending' || t.status === 'Not Started');
                const inProgressTasks = smeTasks.filter(t => t.status === 'In Progress');
                const completedTasks = smeTasks.filter(t => t.status === 'Completed');
                const blockedTasks = smeTasks.filter(t => t.status === 'Blocked');
                const grouped = {};
                smeTasks.forEach(t => { const d = t.due || t.createdAt?.split('T')[0] || 'No date'; if (!grouped[d]) grouped[d] = []; grouped[d].push(t); });
                const dates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
                return (
                  <>
                    {/* SME Header */}
                    <div className="card mb-3" style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}>
                      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>{sme.name[0]}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <h6 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#0f172a' }}>{sme.name}</h6>
                            <span className={`badge ${sme.status === 'active' ? 'status-approved' : 'status-pending'}`} style={{ fontSize: 10 }}>{sme.status}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{sme.email} {sme.userId && `• ${smeTasks.length} task${smeTasks.length !== 1 ? 's' : ''} assigned`}</div>
                        </div>
                      </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="row g-2 mb-3">
                      <div className="col-3">
                        <div className="card" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
                          <div style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Total</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{smeTasks.length}</div>
                          </div>
                        </div>
                      </div>
                      <div className="col-3">
                        <div className="card" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
                          <div style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>To Do</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#64748b' }}>{todoTasks.length}</div>
                          </div>
                        </div>
                      </div>
                      <div className="col-3">
                        <div className="card" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
                          <div style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>In Progress</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#d97706' }}>{inProgressTasks.length}</div>
                          </div>
                        </div>
                      </div>
                      <div className="col-3">
                        <div className="card" style={{ borderRadius: 10, border: '1px solid #e2e8f0' }}>
                          <div style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Completed</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: '#059669' }}>{completedTasks.length}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Blocked alert */}
                    {blockedTasks.length > 0 && (
                      <div style={{ padding: '10px 16px', background: '#dc262610', border: '1px solid #dc262630', borderRadius: 8, marginBottom: 12, fontSize: 13, color: '#dc2626', fontWeight: 500 }}>
                        <i className="bi bi-exclamation-triangle me-2" />{blockedTasks.length} task{blockedTasks.length > 1 ? 's' : ''} blocked
                      </div>
                    )}

                    {/* Leave Requests for this SME */}
                    {smeLeaves.filter(lv => lv.userId?._id === sme.userId).length > 0 && (
                      <div className="card mb-3" style={{ borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                          <h6 style={{ fontSize: 12, fontWeight: 700, margin: 0 }}><i className="bi bi-calendar-check me-2" />Pending Leaves</h6>
                        </div>
                        {smeLeaves.filter(lv => lv.userId?._id === sme.userId).map(lv => (
                          <div key={lv._id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: 12 }}>
                              <span className="badge" style={{ background: '#0891b220', color: '#0891b2', fontSize: 10, fontWeight: 600, borderRadius: 6, marginRight: 6 }}>{lv.type}</span>
                              {lv.from} → {lv.to} ({lv.days}d)
                              {lv.reason && <span style={{ color: '#94a3b8', marginLeft: 6 }}>"{lv.reason}"</span>}
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span className={`badge ${lv.status === 'pending' ? 'status-pending' : lv.status === 'approved' ? 'status-approved' : 'status-rejected'}`} style={{ fontSize: 10 }}>{lv.status}</span>
                              {lv.status === 'pending' && (
                                <>
                                  <button className="btn btn-sm" style={{ fontSize: 10, background: '#05966910', color: '#059669', border: '1px solid #05966930', borderRadius: 6, padding: '2px 8px' }} onClick={() => actionLeave(lv._id, 'approved')}><i className="bi bi-check-lg" /></button>
                                  <button className="btn btn-sm" style={{ fontSize: 10, background: '#dc262610', color: '#dc2626', border: '1px solid #dc262630', borderRadius: 6, padding: '2px 8px' }} onClick={() => actionLeave(lv._id, 'rejected')}><i className="bi bi-x-lg" /></button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tasks grouped by date */}
                    {dates.length === 0 ? (
                      <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0', padding: 40, textAlign: 'center' }}>
                        <i className="bi bi-list-task" style={{ fontSize: 32, color: '#e2e8f0' }} />
                        <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>No tasks assigned</p>
                      </div>
                    ) : (
                      <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                        {dates.map(date => {
                          const tasks = grouped[date];
                          const done = tasks.filter(t => t.status === 'Completed').length;
                          const isExpanded = expandedMonDate === date;
                          return (
                            <div key={date}>
                              <div onClick={() => setExpandedMonDate(isExpanded ? null : date)}
                                style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <i className={`bi ${isExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ color: '#94a3b8', fontSize: 14 }} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                                    {date === 'No date' ? 'Unscheduled' : new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                                  </div>
                                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{tasks.length} task{tasks.length > 1 ? 's' : ''} • {done} completed</div>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: done === tasks.length ? '#059669' : '#d97706' }}>
                                  {tasks.length > 0 ? Math.round(done / tasks.length * 100) + '%' : '0%'}
                                </div>
                              </div>
                              {isExpanded && (
                                <div style={{ padding: '0 20px 16px 52px' }}>
                                  <table className="table mb-0" style={{ fontSize: 13 }}>
                                    <thead>
                                      <tr>
                                        <th style={{ fontWeight: 600, padding: '8px 8px' }}>Task</th>
                                        <th style={{ fontWeight: 600, padding: '8px 8px' }}>Project</th>
                                        <th style={{ fontWeight: 600, padding: '8px 8px' }}>Priority</th>
                                        <th style={{ fontWeight: 600, padding: '8px 8px' }}>Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tasks.map(t => (
                                        <tr key={t._id}>
                                          <td style={{ padding: '8px 8px' }}>
                                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{t.title}</div>
                                            {t.description && <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 200 }}>{t.description}</div>}
                                          </td>
                                          <td style={{ padding: '8px 8px', color: '#64748b' }}>{t.projectId?.name || '—'}</td>
                                          <td style={{ padding: '8px 8px' }}>
                                            <span className={`badge ${t.priority === 'high' ? 'status-rejected' : t.priority === 'medium' ? 'status-pending' : 'status-approved'}`}
                                              style={{ fontSize: 10, fontWeight: 600 }}>
                                              {t.priority}
                                            </span>
                                          </td>
                                          <td style={{ padding: '8px 8px' }}>
                                            <span className="badge" style={{
                                              background: t.status === 'Completed' ? '#dcfce7' : t.status === 'In Progress' ? '#fef3c7' : t.status === 'Blocked' ? '#fee2e2' : '#f1f5f9',
                                              color: t.status === 'Completed' ? '#16a34a' : t.status === 'In Progress' ? '#d97706' : t.status === 'Blocked' ? '#dc2626' : '#64748b',
                                              fontSize: 10, fontWeight: 600,
                                            }}>{t.status}</span>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )
      )}

      {/* ── Work Progress Tab ── */}
      {activeTab === 'work' && (
        monitoringLoading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
          !selectedWpSme ? (
            /* ── Level 1: SME List ── */
            <div className="card p-0" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <h6 style={{ fontSize: 13, fontWeight: 700, margin: 0 }}><i className="bi bi-people me-2" />Select an SME to view work progress</h6>
              </div>
              {smes.filter(s => s.userId).length === 0 ? (
                <div className="empty-state" style={{ padding: 60 }}>
                  <i className="bi bi-person-gear" style={{ fontSize: 40, color: '#94a3b8' }} />
                  <h6 style={{ marginTop: 12 }}>No SMEs with linked user accounts</h6>
                </div>
              ) : (
                <div>
                  {smes.filter(s => s.userId).map(sme => {
                    const smeTasks = allTasks.filter(t => t.assignedTo?._id === sme.userId);
                    const completed = smeTasks.filter(t => t.status === 'Completed').length;
                    return (
                      <div key={sme._id} onClick={() => { setSelectedWpSme(sme); setExpandedWpDate(null); }}
                        style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{sme.name[0]}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{sme.name}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>
                            {smeTasks.length > 0
                              ? `${smeTasks.length} task${smeTasks.length > 1 ? 's' : ''} • ${completed} completed`
                              : 'No tasks assigned'}
                          </div>
                        </div>
                        {smeTasks.length > 0 && (
                          <div style={{ fontSize: 12, fontWeight: 600, color: completed === smeTasks.length ? '#059669' : '#d97706' }}>
                            {Math.round(completed / smeTasks.length * 100)}%
                          </div>
                        )}
                        <i className="bi bi-chevron-right" style={{ color: '#cbd5e1', fontSize: 14 }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Level 2: Date View for selected SME ── */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => { setSelectedWpSme(null); setExpandedWpDate(null); }} style={{ borderRadius: 8, fontSize: 12 }}>
                  <i className="bi bi-arrow-left me-1" />Back
                </button>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{selectedWpSme.name[0]}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{selectedWpSme.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{selectedWpSme.email}</div>
                </div>
              </div>

              {(() => {
                const sme = selectedWpSme;
                const smeTasks = allTasks.filter(t => t.assignedTo?._id === sme.userId);
                const grouped = {};
                smeTasks.forEach(t => { const d = t.due || t.createdAt?.split('T')[0] || 'No date'; if (!grouped[d]) grouped[d] = []; grouped[d].push(t); });
                const dates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));
                return dates.length === 0 ? (
                  <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}>
                    <div className="empty-state" style={{ padding: 60 }}>
                      <i className="bi bi-list-task" style={{ fontSize: 40, color: '#94a3b8' }} />
                      <h6 style={{ marginTop: 12 }}>No tasks assigned to this SME</h6>
                    </div>
                  </div>
                ) : (
                  <div className="card p-0" style={{ overflow: 'hidden' }}>
                    {dates.map(date => {
                      const tasks = grouped[date];
                      const done = tasks.filter(t => t.status === 'Completed').length;
                      const isExpanded = expandedWpDate === date;
                      return (
                        <div key={date}>
                          <div onClick={() => setExpandedWpDate(isExpanded ? null : date)}
                            style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            <i className={`bi ${isExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} style={{ color: '#94a3b8', fontSize: 14 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                                {date === 'No date' ? 'Unscheduled' : new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                              </div>
                              <div style={{ fontSize: 12, color: '#94a3b8' }}>{tasks.length} task{tasks.length > 1 ? 's' : ''} • {done} completed</div>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: done === tasks.length ? '#059669' : '#d97706' }}>
                              {tasks.length > 0 ? Math.round(done / tasks.length * 100) + '%' : '0%'}
                            </div>
                          </div>
                          {isExpanded && (
                            <div style={{ padding: '0 20px 16px 52px' }}>
                              <table className="table mb-0" style={{ fontSize: 13 }}>
                                <thead>
                                  <tr>
                                    <th style={{ fontWeight: 600, padding: '8px 8px' }}>Task</th>
                                    <th style={{ fontWeight: 600, padding: '8px 8px' }}>Project</th>
                                    <th style={{ fontWeight: 600, padding: '8px 8px' }}>Priority</th>
                                    <th style={{ fontWeight: 600, padding: '8px 8px' }}>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tasks.map(t => (
                                    <tr key={t._id}>
                                      <td style={{ padding: '8px 8px' }}>
                                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{t.title}</div>
                                        {t.description && <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 200 }}>{t.description}</div>}
                                      </td>
                                      <td style={{ padding: '8px 8px', color: '#64748b' }}>{t.projectId?.name || '—'}</td>
                                      <td style={{ padding: '8px 8px' }}>
                                        <span className={`badge ${t.priority === 'high' ? 'status-rejected' : t.priority === 'medium' ? 'status-pending' : 'status-approved'}`}
                                          style={{ fontSize: 10, fontWeight: 600 }}>
                                          {t.priority}
                                        </span>
                                      </td>
                                      <td style={{ padding: '8px 8px' }}>
                                        <span className="badge" style={{
                                          background: t.status === 'Completed' ? '#dcfce7' : t.status === 'In Progress' ? '#fef3c7' : t.status === 'Blocked' ? '#fee2e2' : '#f1f5f9',
                                          color: t.status === 'Completed' ? '#16a34a' : t.status === 'In Progress' ? '#d97706' : t.status === 'Blocked' ? '#dc2626' : '#64748b',
                                          fontSize: 10, fontWeight: 600,
                                        }}>{t.status}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )
        )
      )}

      {/* ── Leave Requests Tab ── */}
      {activeTab === 'leave-requests' && (
        monitoringLoading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
          <div className="card" style={{ borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {/* Filter Bar */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
              <div className="row g-2 align-items-end">
                <div className="col-12">
                  <h6 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 12px 0' }}><i className="bi bi-funnel me-2" />Filters</h6>
                </div>
                <div className="col-md-3">
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Search by SME Name</label>
                  <input type="text" className="form-control form-control-sm" placeholder="Search..." value={leaveSearchTerm} onChange={e => setLeaveSearchTerm(e.target.value)} style={{ fontSize: 13 }} />
                </div>
                <div className="col-md-2">
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Leave Type</label>
                  <select className="form-select form-select-sm" value={leaveTypeFilter} onChange={e => setLeaveTypeFilter(e.target.value)} style={{ fontSize: 13 }}>
                    <option value="all">All Types</option>
                    <option value="Sick">Sick</option>
                    <option value="Casual">Casual</option>
                    <option value="Annual">Annual</option>
                    <option value="Personal">Personal</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>From Date</label>
                  <input type="date" className="form-control form-control-sm" value={leaveFromDate} onChange={e => setLeaveFromDate(e.target.value)} style={{ fontSize: 13 }} />
                </div>
                <div className="col-md-2">
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>To Date</label>
                  <input type="date" className="form-control form-control-sm" value={leaveToDate} onChange={e => setLeaveToDate(e.target.value)} style={{ fontSize: 13 }} />
                </div>
                <div className="col-md-3 d-flex gap-2">
                  <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 12, borderRadius: 8 }} onClick={() => { setLeaveSearchTerm(''); setLeaveTypeFilter('all'); setLeaveFromDate(''); setLeaveToDate(''); setLeaveStatusFilter('all'); }}>
                    <i className="bi bi-x-circle me-1" />Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Status filter tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', background: '#fff', paddingLeft: 20 }}>
              {['all', 'pending', 'approved', 'rejected', 'held'].map(st => (
                <button key={st} onClick={() => setLeaveStatusFilter(st)} style={{
                  padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                  fontWeight: leaveStatusFilter === st ? 700 : 500, fontSize: 13,
                  color: leaveStatusFilter === st ? (
                    st === 'pending' ? '#d97706' : st === 'approved' ? '#059669' : st === 'rejected' ? '#dc2626' : st === 'held' ? '#0891b2' : '#0f172a'
                  ) : '#64748b',
                  borderBottom: leaveStatusFilter === st ? `2px solid ${
                    st === 'pending' ? '#d97706' : st === 'approved' ? '#059669' : st === 'rejected' ? '#dc2626' : st === 'held' ? '#0891b2' : '#0f172a'
                  }` : '2px solid transparent',
                  marginBottom: -1, textTransform: 'capitalize', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {st === 'all' ? <i className="bi bi-list-ul" /> : st === 'pending' ? <i className="bi bi-clock" /> : st === 'approved' ? <i className="bi bi-check-circle" /> : st === 'rejected' ? <i className="bi bi-x-circle" /> : <i className="bi bi-pause-circle" />}
                  {st === 'all' ? 'All' : st}
                  <span style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 10,
                    background: leaveStatusFilter === st ? (
                      st === 'pending' ? '#d9770620' : st === 'approved' ? '#05966920' : st === 'rejected' ? '#dc262620' : st === 'held' ? '#0891b220' : '#e2e8f0'
                    ) : '#f1f5f9',
                    color: leaveStatusFilter === st ? (
                      st === 'pending' ? '#d97706' : st === 'approved' ? '#059669' : st === 'rejected' ? '#dc2626' : st === 'held' ? '#0891b2' : '#64748b'
                    ) : '#94a3b8',
                  }}>
                    {st === 'all' ? smeLeaves.length : smeLeaves.filter(l => l.status === st).length}
                  </span>
                </button>
              ))}
            </div>

            {/* Leave Requests table */}
            <div className="table-responsive">
              {(() => {
                let filtered = [...smeLeaves];

                if (leaveStatusFilter !== 'all') filtered = filtered.filter(l => l.status === leaveStatusFilter);

                if (leaveSearchTerm) {
                  const term = leaveSearchTerm.toLowerCase();
                  filtered = filtered.filter(l => (l.userId?.name || '').toLowerCase().includes(term));
                }

                if (leaveTypeFilter !== 'all') filtered = filtered.filter(l => l.type === leaveTypeFilter);

                if (leaveFromDate) filtered = filtered.filter(l => l.from >= leaveFromDate);
                if (leaveToDate) filtered = filtered.filter(l => l.to <= leaveToDate);

                if (filtered.length === 0) {
                  return (
                    <div className="empty-state" style={{ padding: 60 }}>
                      <i className="bi bi-calendar-check" style={{ fontSize: 40, color: '#e2e8f0' }} />
                      <h6 style={{ marginTop: 12, color: '#94a3b8', fontWeight: 600 }}>No matching leave requests</h6>
                      <p style={{ fontSize: 13, color: '#cbd5e1' }}>Try adjusting the filters above</p>
                    </div>
                  );
                }

                return (
                  <table className="table" style={{ margin: 0, fontSize: 13 }}>
                    <thead style={{ background: '#f8fafc' }}>
                      <tr>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>SME</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Type</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>From</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>To</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Days</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Reason</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '12px 16px', fontWeight: 600 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(lv => (
                        <tr key={lv._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{(lv.userId?.name || 'S')[0]}</div>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>{lv.userId?.name || 'Unknown'}</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span className="badge" style={{ background: '#0891b220', color: '#0891b2', fontSize: 10, fontWeight: 600, borderRadius: 6 }}>{lv.type}</span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#64748b' }}>{lv.from}</td>
                          <td style={{ padding: '12px 16px', color: '#64748b' }}>{lv.to}</td>
                          <td style={{ padding: '12px 16px', fontWeight: 600 }}>{lv.days}d</td>
                          <td style={{ padding: '12px 16px', color: '#64748b', maxWidth: 200 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lv.reason || '—'}</div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span className={`badge ${
                              lv.status === 'pending' ? 'status-pending' :
                              lv.status === 'approved' ? 'status-approved' :
                              lv.status === 'rejected' ? 'status-rejected' :
                              'status-hold'
                            }`} style={{ fontSize: 10, textTransform: 'capitalize' }}>
                              {lv.status === 'pending' ? <i className="bi bi-clock me-1" /> :
                               lv.status === 'approved' ? <i className="bi bi-check-circle me-1" /> :
                               lv.status === 'rejected' ? <i className="bi bi-x-circle me-1" /> :
                               <i className="bi bi-pause-circle me-1" />}
                              {lv.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            {lv.status === 'pending' ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm" style={{ fontSize: 10, background: '#05966910', color: '#059669', border: '1px solid #05966930', borderRadius: 6, padding: '3px 10px' }} onClick={() => actionLeave(lv._id, 'approved')}>
                                  <i className="bi bi-check-lg me-1" />Approve
                                </button>
                                <button className="btn btn-sm" style={{ fontSize: 10, background: '#dc262610', color: '#dc2626', border: '1px solid #dc262630', borderRadius: 6, padding: '3px 10px' }} onClick={() => actionLeave(lv._id, 'rejected')}>
                                  <i className="bi bi-x-lg me-1" />Reject
                                </button>
                              </div>
                            ) : lv.status === 'held' ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm" style={{ fontSize: 10, background: '#05966910', color: '#059669', border: '1px solid #05966930', borderRadius: 6, padding: '3px 10px' }} onClick={() => actionLeave(lv._id, 'approved')}>
                                  <i className="bi bi-check-lg me-1" />Approve
                                </button>
                                <button className="btn btn-sm" style={{ fontSize: 10, background: '#dc262610', color: '#dc2626', border: '1px solid #dc262630', borderRadius: 6, padding: '3px 10px' }} onClick={() => actionLeave(lv._id, 'rejected')}>
                                  <i className="bi bi-x-lg me-1" />Reject
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        )
      )}

      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: 16 }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', padding: '20px 24px' }}>
                <h5 className="modal-title" style={{ fontWeight: 700 }}>
                  <i className="bi bi-person-gear me-2" />{form._id ? 'Edit' : 'Add'} Subject Matter Expert
                </h5>
                <button className="btn-close" onClick={closeModal} />
              </div>
              <div className="modal-body" style={{ padding: '24px', maxHeight: '70vh', overflowY: 'auto' }}>
                <div className="row g-3">
                  <div className="col-12"><h6 style={{ fontSize: 12, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 1 }}>Personal Information</h6></div>

                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Full Name *</label>
                    <input className="form-control" placeholder="Enter full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Email Address *</label>
                    <input type="email" className="form-control" placeholder="sme@company.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  {!form._id && (
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Password</label>
                      <input type="text" className="form-control" placeholder="Leave blank to auto-generate" style={{ background: '#fff9c4' }} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Auto-generated if left empty</div>
                    </div>
                  )}
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Date of Birth</label>
                    <input type="date" className="form-control" value={form.dob} onChange={e => setForm(p => ({ ...p, dob: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Phone</label>
                    <input type="tel" className="form-control" placeholder="10-digit phone" maxLength={10} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>PAN Number</label>
                    <input className="form-control" placeholder="e.g. ABCDE1234F" style={{ textTransform: 'uppercase' }} value={form.pan} onChange={e => setForm(p => ({ ...p, pan: e.target.value.toUpperCase() }))} />
                  </div>

                  {/* ── Expertise ── */}
                  <div className="col-12" style={{ marginTop: 16 }}><h6 style={{ fontSize: 12, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 1 }}>Expertise</h6></div>

                  <div className="col-12">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {expertiseOptions.map(opt => {
                        const skill = typeof opt === 'string' ? opt : opt.name || '';
                        if (!skill) return null;
                        const selected = (form.expertise || '').split(',').map(s => s.trim()).filter(Boolean).includes(skill);
                        return (
                          <button key={skill} type="button" onClick={() => toggleExpertise(skill)}
                            style={{
                              padding: '6px 14px', borderRadius: 8, border: selected ? '2px solid #0891b2' : '1px solid #e2e8f0',
                              background: selected ? '#0891b210' : '#fff', color: selected ? '#0891b2' : '#64748b',
                              fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
                            }}>
                            {selected && <i className="bi bi-check-circle-fill me-1" style={{ fontSize: 10 }} />}{skill}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, minHeight: 40, alignItems: 'center', background: '#fff' }}>
                      {(form.expertise || '').split(',').map(s => s.trim()).filter(Boolean).map((item, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#0891b210', color: '#0891b2', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                          {item}
                          <button type="button" onClick={() => { const curr = form.expertise.split(',').map(x => x.trim()).filter(Boolean); curr.splice(i, 1); setForm(p => ({ ...p, expertise: curr.join(', ') })); }} style={{ background: 'none', border: 'none', padding: 0, color: '#0891b2', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                      <input type="text" placeholder="Type and press Enter" value={expertiseInput} onChange={e => setExpertiseInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const val = expertiseInput.trim(); if (val) { const curr = form.expertise.split(',').map(x => x.trim()).filter(Boolean); if (!curr.includes(val)) { curr.push(val); setForm(p => ({ ...p, expertise: curr.join(', ') })); } } setExpertiseInput(''); } }} style={{ border: 'none', outline: 'none', flex: 1, minWidth: 100, fontSize: 13 }} />
                    </div>
                  </div>

                  {/* ── Departments ── */}
                  <div className="col-12" style={{ marginTop: 16 }}><h6 style={{ fontSize: 12, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 1 }}>Departments</h6></div>

                  <div className="col-12">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {departments.map(dept => {
                        const deptName = typeof dept === 'string' ? dept : dept.name || dept.value || '';
                        if (!deptName) return null;
                        const selected = (form.departments || '').split(',').map(s => s.trim()).filter(Boolean).includes(deptName);
                        return (
                          <button key={deptName} type="button" onClick={() => toggleDepartment(deptName)}
                            style={{
                              padding: '6px 14px', borderRadius: 8, border: selected ? '2px solid #0891b2' : '1px solid #e2e8f0',
                              background: selected ? '#0891b210' : '#fff', color: selected ? '#0891b2' : '#64748b',
                              fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
                            }}>
                            {selected && <i className="bi bi-check-circle-fill me-1" style={{ fontSize: 10 }} />}{deptName}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, minHeight: 40, alignItems: 'center', background: '#fff' }}>
                      {(form.departments || '').split(',').map(s => s.trim()).filter(Boolean).map((item, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#0891b210', color: '#0891b2', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                          {item}
                          <button type="button" onClick={() => { const curr = form.departments.split(',').map(x => x.trim()).filter(Boolean); curr.splice(i, 1); setForm(p => ({ ...p, departments: curr.join(', ') })); }} style={{ background: 'none', border: 'none', padding: 0, color: '#0891b2', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                      <input type="text" placeholder="Type and press Enter" value={deptInput} onChange={e => setDeptInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const val = deptInput.trim(); if (val) { const curr = form.departments.split(',').map(x => x.trim()).filter(Boolean); if (!curr.includes(val)) { curr.push(val); setForm(p => ({ ...p, departments: curr.join(', ') })); } } setDeptInput(''); } }} style={{ border: 'none', outline: 'none', flex: 1, minWidth: 100, fontSize: 13 }} />
                    </div>
                  </div>

                  <div className="col-12" style={{ marginTop: 16 }}><h6 style={{ fontSize: 12, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 1 }}>Account Details</h6></div>

                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Bank Name</label>
                    <input className="form-control" placeholder="e.g. Chase Bank" value={form.bankName} onChange={e => setForm(p => ({ ...p, bankName: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Account Holder Name</label>
                    <input className="form-control" placeholder="Name on account" value={form.accountHolder} onChange={e => setForm(p => ({ ...p, accountHolder: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Account Number</label>
                    <input className="form-control" placeholder="Account number" value={form.accountNumber} onChange={e => setForm(p => ({ ...p, accountNumber: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>IFSC / Routing Code</label>
                    <input className="form-control" placeholder="IFSC or routing number" value={form.ifscCode} onChange={e => setForm(p => ({ ...p, ifscCode: e.target.value }))} />
                  </div>

                  <div className="col-12" style={{ marginTop: 16 }}><h6 style={{ fontSize: 12, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 1 }}>Contract & Rate</h6></div>

                  <div className="col-md-4">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Rate Amount</label>
                    <div className="input-group">
                      <span className="input-group-text">₹</span>
                      <input type="number" min="0" className="form-control" placeholder="0" value={form.rateAmount} onChange={e => setForm(p => ({ ...p, rateAmount: e.target.value }))} />
                    </div>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Rate Type</label>
                    <select className="form-select" value={form.rateType} onChange={e => setForm(p => ({ ...p, rateType: e.target.value }))}>
                      <option value="hourly">Per Hour</option>
                      <option value="daily">Per Day</option>
                      <option value="fixed">Fixed</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label>
                    <select className="form-select" value={form.status || 'active'}
                      onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Contract Start Date</label>
                    <input type="date" className="form-control" value={form.contractStart} onChange={e => setForm(p => ({ ...p, contractStart: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Contract End Date</label>
                    <input type="date" className="form-control" value={form.contractEnd} onChange={e => setForm(p => ({ ...p, contractEnd: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
                <button className="btn btn-outline-secondary" onClick={closeModal}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={saving} style={{ background: '#0891b2', borderColor: '#0891b2' }}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : <><i className="bi bi-check-lg me-2" />{form._id ? 'Update' : 'Add'} SME</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {credentials && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: 16, border: '2px solid #0891b2' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', background: '#0891b2', color: '#fff', borderRadius: '14px 14px 0 0' }}>
                <h6 className="modal-title" style={{ fontWeight: 700 }}><i className="bi bi-key me-2" />Credentials Generated</h6>
                <button className="btn-close btn-close-white" onClick={() => setCredentials(null)} />
              </div>
              <div className="modal-body" style={{ padding: 24 }}>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Share these credentials with the SME. They can log in after the first password change.</p>
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Email</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{credentials.email}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Password</div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{credentials.password}</div>
                  </div>
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9', justifyContent: 'center' }}>
                <button className="btn btn-primary" style={{ background: '#0891b2', borderColor: '#0891b2', minWidth: 120 }} onClick={() => setCredentials(null)}>
                  <i className="bi bi-check-lg me-2" />Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
