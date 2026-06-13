'use client';
import { useState, useEffect } from 'react';
import { useFormErrors } from '@/lib/useFormErrors';
import Link from 'next/link';
import { useAuth, ROLE_COLORS, ROLE_LABELS } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const EMPTY_FORM = {
  name: '', email: '', phone: '', department: '', designation: '', role: 'employee', shift: '', status: 'active', joinDate: '',
  skills: '', panNumber: '', aadhaarNumber: '', address: '',
  addressLine1: '', addressLine2: '', addressLine3: '', cityTown: '', pinCode: '',
  emergencyContactName: '', emergencyContactPhone: '', gender: '', bloodGroup: '',
};

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_REGEX = /^[0-9]{12}$/;
const NAME_REGEX = /^[A-Za-z\s]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALPHA_SPACE_REGEX = /^[A-Za-z\s]+$/;

function validateIdentifiers(panNumber, aadhaarNumber) {
  if (panNumber && !PAN_REGEX.test(panNumber.toUpperCase())) return 'PAN must be in format ABCDE1234F';
  if (aadhaarNumber && !AADHAAR_REGEX.test(aadhaarNumber.replace(/\s/g, ''))) return 'Aadhaar must be exactly 12 digits';
  return null;
}

function composeAddress(form) {
  return [
    form.addressLine1,
    form.addressLine2,
    form.addressLine3,
    form.cityTown,
    form.pinCode ? `PIN ${form.pinCode}` : '',
  ].map(v => String(v || '').trim()).filter(Boolean).join(', ');
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const { errors: formErrs, setErrors: setFormErrs, clearError: clearFormErr, clearAll: clearFormErrs, Err: FErr } = useFormErrors();
  const [employees, setEmployees]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [tab, setTab]               = useState('directory');
  const [firstLogins, setFirstLogins] = useState([]);
  const [firstLoginsLoading, setFirstLoginsLoading] = useState(false);
  const [showModal, setShowModal]   = useState(false);
  const [editEmp, setEditEmp]       = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [toast, setToast]           = useState({ msg: '', type: 'success' });
  const [tempPasswordModal, setTempPasswordModal] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [showNewDept, setShowNewDept] = useState(false);
  const [newDesigName, setNewDesigName] = useState('');
  const [showNewDesig, setShowNewDesig] = useState(false);
  const [newShiftName, setNewShiftName] = useState('');
  const [showNewShift, setShowNewShift] = useState(false);

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
  const recordAuditAction = (action, details, severity = 'low') => {
    api.post('/api/audit/action', { action, module: 'Employees', details, severity }).catch(() => {});
  };
  const rejectEmployeeSave = (message) => {
    showToast(message, 'error');
    recordAuditAction(
      editEmp ? 'Employee Update Validation Failed' : 'Employee Create Validation Failed',
      `${editEmp ? `Employee: ${editEmp.name}. ` : ''}${message}`,
      'medium'
    );
  };

  const loadDepartments = () => api.get('/api/settings?type=departments').then(data => setDepartments(data.map(d => d.name))).catch(() => {});
  const loadDesignations = () => api.get('/api/settings?type=designations').then(data => setDesignations(data)).catch(() => {});
  const loadShifts = () => api.get('/api/settings?type=shifts').then(data => setShifts(Array.isArray(data) ? data : [])).catch(() => {});
  const load = () => { setLoading(true); api.get('/api/employees').then(setEmployees).catch(e => showToast(e.message, 'error')).finally(() => setLoading(false)); };

  const loadFirstLogins = () => {
    setFirstLoginsLoading(true);
    api.get('/api/employees/first-logins')
      .then(setFirstLogins)
      .catch(() => {})
      .finally(() => setFirstLoginsLoading(false));
  };

  const lookupCityByPin = async (pin) => {
    if (!/^[0-9]{6}$/.test(pin)) return;
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const data = await res.json();
      const office = data?.[0]?.PostOffice?.[0];
      const city = office?.District || office?.Block || office?.Name;
      if (city) setForm(p => ({ ...p, cityTown: p.cityTown || city }));
    } catch {}
  };

  useEffect(() => { load(); loadDepartments(); loadDesignations(); loadShifts(); }, []);

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    return (
      (!q || e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q)) &&
      (!filterDept   || e.department === filterDept) &&
      (!filterRole   || e.role === filterRole) &&
      (!filterStatus || e.status === filterStatus)
    );
  });

  const openAdd  = () => { setEditEmp(null); setForm(EMPTY_FORM); clearFormErrs(); setShowModal(true); };
  const openEdit = (emp) => { setEditEmp(emp); setForm({ ...EMPTY_FORM, ...emp, skills: (emp.skills || []).join(', '), panNumber: '', aadhaarNumber: '' }); clearFormErrs(); setShowModal(true); };

  const handleSave = async () => {
    const name = form.name?.trim() || '';
    const email = form.email?.trim() || '';
    const phone = form.phone?.trim() || '';
    const errs = {};

    if (!name) errs.name = 'Full name is required';
    else if (!NAME_REGEX.test(name)) errs.name = 'Name must contain only letters and spaces';
    if (!email) errs.email = 'Email is required';
    else if (!EMAIL_REGEX.test(email)) errs.email = 'Please enter a valid email address';
    if (!phone) errs.phone = 'Phone number is required';
    else if (!/^[0-9]{10}$/.test(phone)) errs.phone = 'Phone must be exactly 10 digits';
    if (!form.department) errs.department = 'Department is required';
    if (!form.designation) errs.designation = 'Designation is required';
    if (!form.addressLine1?.trim()) errs.addressLine1 = 'Address line 1 is required';
    if (!form.cityTown?.trim()) errs.cityTown = 'City or town name is required';
    if (!/^[0-9]{6}$/.test(form.pinCode || '')) errs.pinCode = 'Pin code must be exactly 6 digits';
    if (!form.emergencyContactName?.trim()) errs.emergencyContactName = 'Emergency contact name is required';
    else if (!NAME_REGEX.test(form.emergencyContactName.trim())) errs.emergencyContactName = 'Must contain only letters and spaces';
    if (!form.emergencyContactPhone?.trim()) errs.emergencyContactPhone = 'Emergency contact phone is required';
    else if (!/^[0-9]{10}$/.test(form.emergencyContactPhone.trim())) errs.emergencyContactPhone = 'Must be exactly 10 digits';
    if (!form.gender) errs.gender = 'Gender is required';
    if (!form.bloodGroup) errs.bloodGroup = 'Blood group is required';
    if (!form.shift) errs.shift = 'Shift is required';
    if (!form.joinDate) errs.joinDate = 'Join date is required';
    if (!form.role) errs.role = 'Role is required';
    const idError = validateIdentifiers(form.panNumber, form.aadhaarNumber);
    if (idError) errs.panNumber = idError;

    if (Object.keys(errs).length) { setFormErrs(errs); return; }

    setSaving(true);
    try {
      const payload = { ...form, address: composeAddress(form), skills: form.skills.split(',').map(s => s.trim()).filter(Boolean) };
      if (payload.panNumber) payload.panNumber = payload.panNumber.toUpperCase().trim();
      if (payload.aadhaarNumber) payload.aadhaarNumber = payload.aadhaarNumber.replace(/\s/g, '');
      if (!payload.panNumber) delete payload.panNumber;
      if (!payload.aadhaarNumber) delete payload.aadhaarNumber;
      if (editEmp) {
        await api.put(`/api/employees/${editEmp._id}`, payload);
        showToast('Employee updated');
        setShowModal(false);
      } else {
        const res = await api.post('/api/employees', payload);
        showToast('Employee added');
        setShowModal(false);
        if (res.tempPassword) setTempPasswordModal({ email: res.employee.email, password: res.tempPassword });
      }
      load(); loadDepartments(); loadShifts();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (emp) => {
    try {
      await api.put(`/api/employees/${emp._id}`, { status: emp.status === 'active' ? 'inactive' : 'active' });
      showToast('Status updated'); load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const canManage = user?.role === 'super_admin' || user?.role === 'admin_full';
  const canAdd    = user?.role === 'super_admin' || user?.role === 'recruiter';
  const allDepts  = [...new Set([...departments, ...employees.map(e => e.department).filter(Boolean)])];
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
        {['directory', 'orgchart', 'firstlogin'].map(t => (
          <button key={t} onClick={() => { setTab(t); if (t === 'firstlogin') loadFirstLogins(); }}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'directory' ? 'Directory' : t === 'orgchart' ? 'Org Chart' : <><i className="bi bi-box-arrow-in-right me-1" />First Login</>}
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
                      <th>Employee</th><th>Emp ID</th><th>Department</th><th>Designation</th><th>Role</th><th>Status</th><th>Lifecycle</th>
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
                        <td style={{ fontSize: 13 }}>{emp.employeeNumber ? <span className="badge" style={{ background: '#eff6ff', color: '#2563eb', fontWeight: 700 }}>{emp.employeeNumber}</span> : <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>}</td>
                        <td style={{ fontSize: 13 }}>{emp.department}</td>
                        <td style={{ fontSize: 13 }}>{emp.designation}</td>
                        <td><span className="badge" style={{ background: (ROLE_COLORS[emp.role] || '#64748b') + '20', color: ROLE_COLORS[emp.role] || '#64748b' }}>{ROLE_LABELS[emp.role] || emp.role}</span></td>
                        <td><span className={`badge ${emp.status === 'active' ? 'status-approved' : 'status-rejected'}`}>{emp.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                        <td>{emp.employmentStatus ? <span className="badge" style={{ background: '#f8fafc', color: '#475569', textTransform: 'capitalize', border: '1px solid #e2e8f0' }}>{emp.employmentStatus.replace(/_/g, ' ')}</span> : <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>}</td>
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

      {tab === 'firstlogin' && (
        <div className="card">
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="bi bi-box-arrow-in-right" style={{ color: '#3b82f6', fontSize: 15 }} />
            <span style={{ fontWeight: 750, fontSize: 14.5 }}>First Login Tracker</span>
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>
              {firstLogins.filter(e => e.neverLoggedIn).length} pending · {firstLogins.filter(e => !e.neverLoggedIn).length} logged in
            </span>
            <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 12 }} onClick={loadFirstLogins}>
              <i className="bi bi-arrow-clockwise" />
            </button>
          </div>
          {firstLoginsLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
          ) : firstLogins.length === 0 ? (
            <div className="empty-state"><i className="bi bi-people" /><p>No employees found</p></div>
          ) : (
            <div className="table-responsive">
              <table className="table mb-0">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Designation</th>
                    <th>Role</th>
                    <th>Account Created</th>
                    <th>First Login</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {firstLogins.map(emp => (
                    <tr key={emp._id}>
                      <td>
                        <Link href={`/employees/${emp._id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${ROLE_COLORS[emp.role] || '#64748b'}, #1e293b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                              {emp.name?.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#2563eb' }}>{emp.name}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>{emp.email}</div>
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td style={{ fontSize: 13 }}>{emp.department || '—'}</td>
                      <td style={{ fontSize: 13 }}>{emp.designation || '—'}</td>
                      <td><span className="badge" style={{ background: (ROLE_COLORS[emp.role] || '#64748b') + '20', color: ROLE_COLORS[emp.role] || '#64748b' }}>{ROLE_LABELS[emp.role] || emp.role}</span></td>
                      <td style={{ fontSize: 12, color: '#64748b' }}>{emp.accountCreatedAt ? formatDate(emp.accountCreatedAt) : '—'}</td>
                      <td style={{ fontSize: 12 }}>
                        {emp.firstLoginAt
                          ? <span style={{ color: '#10b981', fontWeight: 600 }}>{new Date(emp.firstLoginAt).toLocaleString()}</span>
                          : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Not yet</span>}
                      </td>
                      <td>
                        {emp.neverLoggedIn
                          ? <span className="badge" style={{ background: '#fef3c7', color: '#d97706' }}><i className="bi bi-clock me-1" />Pending</span>
                          : <span className="badge" style={{ background: '#dcfce7', color: '#16a34a' }}><i className="bi bi-check-circle me-1" />Logged In</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                <div className="row g-3 employee-form">
                  <div className="col-12"><div className="employee-form-section">Personal Details</div></div>
                  <div className="col-md-6">
                    <label className="form-label">Full Name *</label>
                    <input type="text" className={`form-control ${formErrs.name ? 'is-invalid' : ''}`} placeholder="e.g. John Smith" value={form.name || ''} onChange={e => { setForm(p => ({ ...p, name: e.target.value.replace(/[^A-Za-z\s]/g, '') })); clearFormErr('name'); }} />
                    <FErr f="name" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">Blood Group *</label>
                    <select className={`form-select ${formErrs.bloodGroup ? 'is-invalid' : ''}`} value={form.bloodGroup || ''} onChange={e => { setForm(p => ({ ...p, bloodGroup: e.target.value })); clearFormErr('bloodGroup'); }}>
                      <option value="">Select</option>
                      {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                    <FErr f="bloodGroup" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">Gender *</label>
                    <select className={`form-select ${formErrs.gender ? 'is-invalid' : ''}`} value={form.gender || ''} onChange={e => { setForm(p => ({ ...p, gender: e.target.value })); clearFormErr('gender'); }}>
                      <option value="">Select</option>
                      <option value="male">Male</option><option value="female">Female</option><option value="non_binary">Non-Binary</option><option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                    <FErr f="gender" />
                  </div>

                  <div className="col-12"><div className="employee-form-section">Address Details</div></div>
                  <div className="col-md-6"><label className="form-label">Address Line 1 *</label><input className={`form-control ${formErrs.addressLine1 ? 'is-invalid' : ''}`} placeholder="House no, street" value={form.addressLine1 || ''} onChange={e => { setForm(p => ({ ...p, addressLine1: e.target.value })); clearFormErr('addressLine1'); }} /><FErr f="addressLine1" /></div>
                  <div className="col-md-6"><label className="form-label">Address Line 2</label><input className="form-control" placeholder="Area, landmark" value={form.addressLine2 || ''} onChange={e => setForm(p => ({ ...p, addressLine2: e.target.value }))} /></div>
                  <div className="col-md-6"><label className="form-label">Address Line 3</label><input className="form-control" placeholder="District or extra address detail" value={form.addressLine3 || ''} onChange={e => setForm(p => ({ ...p, addressLine3: e.target.value }))} /></div>
                  <div className="col-md-3"><label className="form-label">City / Town *</label><input className={`form-control ${formErrs.cityTown ? 'is-invalid' : ''}`} placeholder="City or town" value={form.cityTown || ''} onChange={e => { setForm(p => ({ ...p, cityTown: e.target.value })); clearFormErr('cityTown'); }} /><FErr f="cityTown" /></div>
                  <div className="col-md-3"><label className="form-label">Pin Code *</label><input className={`form-control ${formErrs.pinCode ? 'is-invalid' : ''}`} placeholder="6 digits" maxLength={6} value={form.pinCode || ''} onChange={e => { const pin = e.target.value.replace(/\D/g, '').slice(0, 6); setForm(p => ({ ...p, pinCode: pin })); clearFormErr('pinCode'); if (pin.length === 6) lookupCityByPin(pin); }} /><FErr f="pinCode" /></div>

                  <div className="col-12"><div className="employee-form-section">Contact Details</div></div>
                  <div className="col-md-6"><label className="form-label">Email *</label><input type="email" className={`form-control ${formErrs.email ? 'is-invalid' : ''}`} placeholder="e.g. john@company.com" autoComplete="off" value={form.email || ''} onChange={e => { setForm(p => ({ ...p, email: e.target.value })); clearFormErr('email'); }} /><FErr f="email" /></div>
                  <div className="col-md-6"><label className="form-label">Phone *</label><input type="tel" className={`form-control ${formErrs.phone ? 'is-invalid' : ''}`} placeholder="10-digit number" maxLength={10} autoComplete="off" value={form.phone || ''} onChange={e => { setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })); clearFormErr('phone'); }} /><FErr f="phone" /></div>

                  <div className="col-12"><div className="employee-form-section">Emergency Contact</div></div>
                  <div className="col-md-6"><label className="form-label">Emergency Contact Name *</label><input type="text" className={`form-control ${formErrs.emergencyContactName ? 'is-invalid' : ''}`} placeholder="e.g. Jane Smith" value={form.emergencyContactName || ''} onChange={e => { setForm(p => ({ ...p, emergencyContactName: e.target.value.replace(/[^A-Za-z\s]/g, '') })); clearFormErr('emergencyContactName'); }} /><FErr f="emergencyContactName" /></div>
                  <div className="col-md-6"><label className="form-label">Emergency Contact Phone *</label><input type="tel" className={`form-control ${formErrs.emergencyContactPhone ? 'is-invalid' : ''}`} placeholder="10-digit number" maxLength={10} value={form.emergencyContactPhone || ''} onChange={e => { setForm(p => ({ ...p, emergencyContactPhone: e.target.value.replace(/\D/g, '').slice(0, 10) })); clearFormErr('emergencyContactPhone'); }} /><FErr f="emergencyContactPhone" /></div>

                  <div className="col-12"><div className="employee-form-section">Work Details</div></div>
                  <div className="col-md-6"><label className="form-label">Join Date *</label><input type="date" className={`form-control ${formErrs.joinDate ? 'is-invalid' : ''}`} value={form.joinDate || ''} onChange={e => { setForm(p => ({ ...p, joinDate: e.target.value })); clearFormErr('joinDate'); }} /><FErr f="joinDate" /></div>
                  <div className="col-md-6"><label className="form-label">Department *</label><FErr f="department" />{showNewDept ? <div style={{ display: 'flex', gap: 8 }}><input className="form-control" placeholder="Letters and spaces only" value={newDeptName} onChange={e => setNewDeptName(e.target.value.replace(/[^A-Za-z\s]/g, ''))} /><button type="button" className="btn btn-primary btn-sm" onClick={() => { if (!newDeptName.trim()) return; setDepartments(prev => [...prev, newDeptName.trim()]); setForm(p => ({ ...p, department: newDeptName.trim() })); setNewDeptName(''); setShowNewDept(false); }}><i className="bi bi-check-lg" /></button><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowNewDept(false)}><i className="bi bi-x-lg" /></button></div> : <div style={{ display: 'flex', gap: 8 }}><select className="form-select" value={form.department || ''} onChange={e => setForm(p => ({ ...p, department: e.target.value, designation: '' }))}><option value="">Select Department</option>{departments.map(d => <option key={d}>{d}</option>)}</select><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setShowNewDept(true)}><i className="bi bi-plus-lg" /></button></div>}</div>
                  <div className="col-md-6"><label className="form-label">Designation *</label><FErr f="designation" />{showNewDesig ? <div style={{ display: 'flex', gap: 8 }}><input className="form-control" placeholder="Letters and spaces only" value={newDesigName} onChange={e => setNewDesigName(e.target.value.replace(/[^A-Za-z\s]/g, ''))} /><button type="button" className="btn btn-primary btn-sm" onClick={async () => { if (!newDesigName.trim()) return; try { await api.post('/api/settings', { type: 'designations', name: newDesigName.trim(), department: form.department || '' }); await loadDesignations(); setForm(p => ({ ...p, designation: newDesigName.trim() })); } catch {} setNewDesigName(''); setShowNewDesig(false); }}><i className="bi bi-check-lg" /></button><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowNewDesig(false)}><i className="bi bi-x-lg" /></button></div> : <div style={{ display: 'flex', gap: 8 }}><select className="form-select" value={form.designation || ''} onChange={e => setForm(p => ({ ...p, designation: e.target.value }))}><option value="">Select Designation</option>{designations.map(d => <option key={d._id} value={d.name}>{d.name}{d.department ? ` (${d.department})` : ''}</option>)}</select><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setShowNewDesig(true)}><i className="bi bi-plus-lg" /></button></div>}</div>
                  <div className="col-md-6"><label className="form-label">Shift *</label><FErr f="shift" />{showNewShift ? <div style={{ display: 'flex', gap: 8 }}><input className="form-control" placeholder="e.g. Morning (9AM-6PM)" value={newShiftName} onChange={e => setNewShiftName(e.target.value)} /><button type="button" className="btn btn-primary btn-sm" onClick={async () => { if (!newShiftName.trim()) return; try { await api.post('/api/settings', { type: 'shifts', name: newShiftName.trim(), startTime: '09:00', endTime: '18:00' }); await loadShifts(); setForm(p => ({ ...p, shift: newShiftName.trim() })); } catch {} setNewShiftName(''); setShowNewShift(false); }}><i className="bi bi-check-lg" /></button><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowNewShift(false)}><i className="bi bi-x-lg" /></button></div> : <div style={{ display: 'flex', gap: 8 }}><select className="form-select" value={form.shift || ''} onChange={e => setForm(p => ({ ...p, shift: e.target.value }))}><option value="">Select Shift</option>{shifts.map(s => <option key={s._id} value={s.name}>{s.name}{s.startTime && s.endTime ? ` (${s.startTime}-${s.endTime})` : ''}</option>)}</select><button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setShowNewShift(true)}><i className="bi bi-plus-lg" /></button></div>}</div>
                  <div className="col-md-6"><label className="form-label">Role *</label><select className="form-select" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>{Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div className="col-md-6"><label className="form-label">Status</label><select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                  {!editEmp && <div className="col-md-6"><label className="form-label">Password <span style={{ fontWeight: 400, color: '#94a3b8' }}>(auto-generated if blank)</span></label><input type="password" className="form-control" autoComplete="new-password" placeholder="Leave blank to auto-generate" value={form.password || ''} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>}
                  <div className="col-12"><label className="form-label">Skills <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional, comma separated)</span></label><input className="form-control" placeholder="e.g. React, Node.js, AWS" value={form.skills || ''} onChange={e => setForm(p => ({ ...p, skills: e.target.value }))} /></div>
                  {/* PAN & Aadhaar */}
                  {!editEmp && canManage && (
                    <>
                      <div className="col-12" style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
                          <i className="bi bi-shield-lock" style={{ color: '#d97706', fontSize: 14 }} />
                          <div style={{ fontSize: 12, color: '#92400e' }}>
                            <strong>Sensitive Identifiers</strong> — stored encrypted. Only masked values shown after saving.
                          </div>
                        </div>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>PAN Number <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
                        <input className="form-control" style={{ fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase' }}
                          placeholder="ABCDE1234F" maxLength={10} value={form.panNumber || ''}
                          onChange={e => setForm(p => ({ ...p, panNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))} />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>5 letters + 4 digits + 1 letter</div>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Aadhaar Number <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
                        <input className="form-control" style={{ fontFamily: 'monospace', letterSpacing: 1 }}
                          placeholder="123456789012" maxLength={12} value={form.aadhaarNumber || ''}
                          onChange={e => setForm(p => ({ ...p, aadhaarNumber: e.target.value.replace(/\D/g, '') }))} />
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>12-digit Aadhaar number</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => { setShowModal(false); clearFormErrs(); }}>Cancel</button>
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
                <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>Share this temporary password with the new employee. They will be forced to change it on first login.</p>
                <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, padding: 16, marginBottom: 24 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Email</div>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>{tempPasswordModal.email}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Temporary Password</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, fontFamily: 'monospace' }}>{tempPasswordModal.password}</div>
                    <button className="btn btn-sm btn-light border" style={{ padding: '4px 8px' }} onClick={() => { navigator.clipboard.writeText(tempPasswordModal.password); showToast('Password copied!'); }}>
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


