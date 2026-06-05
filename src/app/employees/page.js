'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth, ROLE_COLORS, ROLE_LABELS } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const SHIFTS = ['Morning (9AM-6PM)', 'Evening (2PM-11PM)', 'Night (10PM-7AM)', 'Flexible'];
const EMPTY_FORM = { name: '', email: '', phone: '', department: '', designation: '', role: 'employee', shift: 'Morning (9AM-6PM)', status: 'active', joinDate: '', skills: '' };

export default function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [tab, setTab]               = useState('directory');
  const [showModal, setShowModal]   = useState(false);
  const [editEmp, setEditEmp]       = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [toast, setToast]           = useState({ msg: '', type: 'success' });

  const [tempPasswordModal, setTempPasswordModal] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [showNewDept, setShowNewDept] = useState(false);

  const [fromRecruitment, setFromRecruitment] = useState(false);

  useEffect(() => {
    const prefill = sessionStorage.getItem('hrms_hire_prefill');
    if (prefill) {
      try {
        const data = JSON.parse(prefill);
        sessionStorage.removeItem('hrms_hire_prefill');
        setForm(p => ({ ...p, ...data }));
        setShowModal(true);
      } catch {}
    }
  }, []);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast({ msg: '', type: 'success' }), 3000); };

  const loadDepartments = () => {
    api.get('/api/settings?type=departments')
      .then(data => setDepartments(data.map(d => d.name)))
      .catch(() => {});
  };

  const loadDesignations = () => {
    api.get('/api/settings?type=designations')
      .then(data => setDesignations(data))
      .catch(() => {});
  };

  const load = () => {
    setLoading(true);
    api.get('/api/employees')
      .then(setEmployees)
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); loadDepartments(); loadDesignations(); }, []);

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    return (
      (!q || e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q)) &&
      (!filterDept   || e.department === filterDept) &&
      (!filterRole   || e.role === filterRole) &&
      (!filterStatus || e.status === filterStatus)
    );
  });

  const openAdd  = () => { setEditEmp(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (emp) => { setEditEmp(emp); setForm({ ...emp, skills: (emp.skills || []).join(', ') }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name || !form.email) return showToast('Name and email are required', 'error');
    if (!form.department) return showToast('Department is required', 'error');
    setSaving(true);
    try {
      const payload = { ...form, skills: form.skills.split(',').map(s => s.trim()).filter(Boolean) };
      if (editEmp) {
        await api.put(`/api/employees/${editEmp._id}`, payload);
        showToast('Employee updated');
        setShowModal(false);
      } else {
        const res = await api.post('/api/employees', payload);
        showToast('Employee added');
        setShowModal(false);
        if (res.tempPassword) {
          setTempPasswordModal({ email: res.employee.email, password: res.tempPassword });
        }
      }
      load();
      loadDepartments();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (emp) => {
    try {
      await api.put(`/api/employees/${emp._id}`, { status: emp.status === 'active' ? 'inactive' : 'active' });
      showToast('Status updated');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const canManage = user?.role === 'super_admin' || user?.role === 'admin_full';
  const canAdd = user?.role === 'super_admin' || user?.role === 'recruiter';
  const allDepts = [...new Set([...departments, ...employees.map(e => e.department).filter(Boolean)])];
  const deptGroups = allDepts.map(d => ({ dept: d, members: employees.filter(e => e.department === d && e.status === 'active') })).filter(g => g.members.length > 0);

  return (
    <AppShell title="Employees">
      {toast.msg && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h4>Employee Management</h4>
          <p>{employees.filter(e => e.status === 'active').length} active · {employees.filter(e => e.status === 'inactive').length} inactive</p>
        </div>
        {canAdd && (
          <button className="btn btn-primary" onClick={openAdd}>
            <i className="bi bi-plus-lg me-2" />Add Employee
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['directory', 'orgchart'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'directory' ? 'Directory' : 'Org Chart'}
          </button>
        ))}
      </div>

      {tab === 'directory' && (
        <>
          <div className="card p-3 mb-3">
            <div className="row g-2">
              <div className="col-md-4">
                <div style={{ position: 'relative' }}>
                  <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13 }} />
                  <input className="form-control" placeholder="Search by name, email, department..." style={{ paddingLeft: 32, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="col-md-2">
                <select className="form-select" style={{ fontSize: 13 }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                  <option value="">All Departments</option>
                  {allDepts.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <select className="form-select" style={{ fontSize: 13 }} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                  <option value="">All Roles</option>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="col-md-2">
                <select className="form-select" style={{ fontSize: 13 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="col-md-2">
                <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={() => { setSearch(''); setFilterDept(''); setFilterRole(''); setFilterStatus(''); }}>
                  <i className="bi bi-x-circle me-1" />Clear
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
            ) : (
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead>
                    <tr>
                      <th>Employee</th><th>Department</th><th>Designation</th><th>Role</th><th>Shift</th><th>Join Date</th><th>Status</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8}><div className="empty-state"><i className="bi bi-people" /><h6>No employees found</h6></div></td></tr>
                    ) : filtered.map(emp => (
                      <tr key={emp._id}>
                        <td>
                          <Link href={`/employees/${emp._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#64748b'}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                {emp.avatar || emp.name?.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }} className="text-primary text-decoration-none">{emp.name}</div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.email}</div>
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td style={{ fontSize: 13 }}>{emp.department}</td>
                        <td style={{ fontSize: 13 }}>{emp.designation}</td>
                        <td><span className="badge" style={{ background: (ROLE_COLORS[emp.role] || '#64748b') + '20', color: ROLE_COLORS[emp.role] || '#64748b' }}>{ROLE_LABELS[emp.role] || emp.role}</span></td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{emp.shift}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{emp.joinDate ? new Date(emp.joinDate).toLocaleDateString() : '—'}</td>
                        <td><span className={`badge ${emp.status === 'active' ? 'status-approved' : 'status-rejected'}`}>{emp.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                        {canManage && (
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm btn-outline-primary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(emp)}><i className="bi bi-pencil" /></button>
                              <button className="btn btn-sm btn-outline-secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => toggleStatus(emp)}><i className={`bi ${emp.status === 'active' ? 'bi-pause-circle' : 'bi-play-circle'}`} /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'orgchart' && (
        <div className="card p-4">
          <div className="section-title mb-4">Organization Chart</div>
          {deptGroups.length === 0 && <div className="empty-state"><i className="bi bi-diagram-3" /><p>No employees yet</p></div>}
          {deptGroups.map(g => (
            <div key={g.dept} style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>{g.dept}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {g.members.map(emp => (
                  <div key={emp._id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', minWidth: 180, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#64748b'}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {emp.avatar || emp.name?.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{emp.name}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{emp.designation}</div>
                      <span className="badge mt-1" style={{ background: (ROLE_COLORS[emp.role] || '#64748b') + '20', color: ROLE_COLORS[emp.role] || '#64748b', fontSize: 10 }}>{ROLE_LABELS[emp.role] || emp.role}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editEmp ? 'Edit Employee' : 'Add New Employee'}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  {[['Full Name', 'name', 'text'], ['Email', 'email', 'email'], ['Phone', 'phone', 'text'], ['Join Date', 'joinDate', 'date']].map(([label, key, type]) => (
                    <div key={key} className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
                      <input type={type} className="form-control" value={form[key] || ''} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Department</label>
                    {showNewDept ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input className="form-control" placeholder="Enter new department name" value={newDeptName} onChange={e => setNewDeptName(e.target.value)} />
                        <button type="button" className="btn btn-primary btn-sm" style={{ whiteSpace: 'nowrap' }} onClick={() => {
                          if (!newDeptName.trim()) return;
                          setDepartments(prev => [...prev, newDeptName.trim()]);
                          setForm(p => ({ ...p, department: newDeptName.trim() }));
                          setNewDeptName('');
                          setShowNewDept(false);
                        }}><i className="bi bi-check-lg" /></button>
                        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowNewDept(false)}><i className="bi bi-x-lg" /></button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select className="form-select" value={form.department || ''} onChange={e => setForm(p => ({ ...p, department: e.target.value, designation: '' }))}>
                          <option value="">Select Department</option>
                          {departments.map(d => <option key={d}>{d}</option>)}
                        </select>
                        <button type="button" className="btn btn-outline-primary btn-sm" style={{ whiteSpace: 'nowrap' }} title="Add New Department" onClick={() => setShowNewDept(true)}><i className="bi bi-plus-lg" /></button>
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Designation</label>
                    <select className="form-select" value={form.designation || ''} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))} disabled={!form.department}>
                      <option value="">{form.department ? 'Select Designation' : 'Select Department first'}</option>
                      {designations.filter(d => d.department === form.department).map(d => <option key={d._id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Shift</label>
                    <select className="form-select" value={form.shift || ''} onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}>
                      <option value="">Select Shift</option>
                      {SHIFTS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Role</label>
                    <select className="form-select" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                      {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label>
                    <select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                  {!editEmp && (
                    <div className="col-md-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Password <span style={{ fontWeight: 400, color: '#94a3b8' }}>(auto-generated if blank)</span></label>
                      <input type="password" className="form-control" placeholder="Leave blank to auto-generate" value={form.password || ''} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
                    </div>
                  )}
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Skills (comma separated)</label>
                    <input className="form-control" placeholder="e.g. React, Node.js, AWS" value={form.skills || ''} onChange={e => setForm(p => ({ ...p, skills: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : editEmp ? 'Save Changes' : 'Add Employee'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Temp Password Modal */}
      {tempPasswordModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0 pb-0">
                <button className="btn-close" onClick={() => setTempPasswordModal(null)} />
              </div>
              <div className="modal-body text-center pt-0 pb-4">
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#10b98120', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <i className="bi bi-key-fill" style={{ color: '#10b981', fontSize: 28 }} />
                </div>
                <h5 style={{ fontWeight: 700 }}>Employee Created</h5>
                <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Share this temporary password with the new employee. They will be forced to change it on their first login.</p>
                
                <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 16, marginBottom: 24 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Email</div>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>{tempPasswordModal.email}</div>
                  
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Temporary Password</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, fontFamily: 'monospace' }}>{tempPasswordModal.password}</div>
                    <button className="btn btn-sm btn-light border" style={{ padding: '4px 8px' }} onClick={() => { navigator.clipboard.writeText(tempPasswordModal.password); showToast('Password copied to clipboard!'); }}>
                      <i className="bi bi-copy" />
                    </button>
                  </div>
                </div>

                <button className="btn btn-primary w-100" onClick={() => setTempPasswordModal(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

