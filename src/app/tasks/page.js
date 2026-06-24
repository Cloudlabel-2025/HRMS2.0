'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';

const STATUSES  = ['To Do', 'In Progress', 'Completed', 'Blocked'];
const PRIORITIES = ['low', 'medium', 'high'];
const PRIORITY_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };
const STATUS_COLORS   = { 'To Do': '#64748b', 'In Progress': '#3b82f6', 'Completed': '#10b981', 'Blocked': '#ef4444' };
const EMPTY_TASK = { title: '', description: '', projectId: '', assignedTo: '', priority: 'medium', status: 'To Do', due: '' };

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks]           = useState([]);
  const [projects, setProjects]     = useState([]);
  const [employees, setEmployees]   = useState([]);
  const [tab, setTab]               = useState('kanban');
  const [showModal, setShowModal]   = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editTask, setEditTask]     = useState(null);
  const [form, setForm]             = useState(EMPTY_TASK);
  const [selectedProjectObj, setSelectedProjectObj] = useState(null);
  const [infoProject, setInfoProject] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [projectForm, setProjectForm] = useState({ name: '', description: '', departments: [], startDate: '', endDate: '', team: [] });
  const [filterProject, setFilterProject] = useState('');
  const [showProjectDocsModal, setShowProjectDocsModal] = useState(false);
  const [selectedDocProject, setSelectedDocProject] = useState(null);
  const [projectDocs, setProjectDocs]   = useState([]);
  const [docsLoading, setDocsLoading]   = useState(false);
  const [uploadDocModal, setUploadDocModal] = useState(false);
  const [uploadForm, setUploadForm]     = useState({ name: '', fileUrl: '', fileSize: '', fileType: 'pdf', projectId: '', taskId: null });
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full', 'team_lead', 'team_admin'].includes(user?.role);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [t, p] = await Promise.all([
        api.get('/api/tasks'),
        api.get('/api/projects'),
      ]);
      setTasks(Array.isArray(t) ? t : []);
      setProjects(Array.isArray(p) ? p : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadDepartmentsAndEmployees = async () => {
    try {
      const [deptData, emps] = await Promise.all([
        api.get('/api/settings?type=departments'),
        api.get('/api/employees'),
      ]);
      setDepartments(Array.isArray(deptData) ? deptData.map(d => d.name) : []);
      setEmployees(Array.isArray(emps) ? emps : []);
    } catch (e) {
      console.warn('Failed to load departments/employees:', e);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadAll();
    if (isAdmin) loadDepartmentsAndEmployees();
  }, [user]);

  const openAdd  = () => { setEditTask(null); setForm(EMPTY_TASK); setSelectedProjectObj(null); setShowModal(true); };
  const openEdit = (task) => {
    const pid = task.projectId?._id || task.projectId || '';
    setEditTask(task);
    setForm({
      title: task.title, description: task.description || '',
      projectId: pid,
      assignedTo: task.assignedTo?._id || task.assignedTo || '',
      priority: task.priority, status: task.status,
      due: task.due || '',
    });
    setSelectedProjectObj(projects.find(p => String(p._id) === String(pid)) || null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title) { showToast('Task title is required', 'error'); return; }
    if (form.title.length > 30) { showToast('Task title must be at most 30 characters', 'error'); return; }
    if (!/^[a-zA-Z0-9]+$/.test(form.title)) { showToast('Task title must contain only letters and numbers', 'error'); return; }
    if (!form.description) { showToast('Task description is required', 'error'); return; }
    if (!form.projectId) { showToast('Please select a project', 'error'); return; }
    if (!form.assignedTo) { showToast('Please select an assignee', 'error'); return; }
    if (!form.priority) { showToast('Priority is required', 'error'); return; }
    if (!form.due) { showToast('Due date is required', 'error'); return; }

    // Validate due date is within project's date range
    if (selectedProjectObj) {
      if (form.due < selectedProjectObj.startDate) {
        showToast(`Due date cannot be before project start date (${selectedProjectObj.startDate})`, 'error');
        return;
      }
      if (form.due > selectedProjectObj.endDate) {
        showToast(`Due date cannot be after project end date (${selectedProjectObj.endDate})`, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      if (editTask) {
        await api.put(`/api/tasks/${editTask._id}`, form);
        showToast('Task updated');
      } else {
        await api.post('/api/tasks', form);
        showToast('Task created');
      }
      setShowModal(false);
      loadAll();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const moveTask = async (id, newStatus) => {
    try {
      await api.put(`/api/tasks/${id}`, { status: newStatus });
      setTasks(prev => prev.map(t => t._id === id ? { ...t, status: newStatus } : t));
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const loadProjectDocs = async (projectId) => {
    if (!projectId) return;
    setDocsLoading(true);
    try {
      const res = await api.get(`/api/projects/documents?projectId=${projectId}`);
      setProjectDocs(Array.isArray(res?.documents) ? res.documents : []);
    } catch {
      setProjectDocs([]);
    } finally {
      setDocsLoading(false);
    }
  };

  const openProjectDocs = () => {
    setShowProjectDocsModal(true);
    const first = projects[0];
    setSelectedDocProject(first?._id || null);
    if (first) loadProjectDocs(first._id);
  };

  const selectDocProject = (id) => {
    setSelectedDocProject(id);
    loadProjectDocs(id);
  };

  const handleUploadDoc = async () => {
    if (!uploadForm.name || !uploadForm.taskId) { showToast('Name and task are required', 'error'); return; }
    if (!selectedFile && !uploadForm.fileUrl) { showToast('Please select a file', 'error'); return; }
    setSaving(true);
    try {
      let fileUrl = uploadForm.fileUrl;
      if (selectedFile) {
        setFileUploading(true);
        const fd = new FormData();
        fd.append('file', selectedFile);
        const uploadRes = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` }, body: fd });
        const uploadJson = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadJson.error || 'Upload failed');
        fileUrl = uploadJson.data.url;
        setFileUploading(false);
      }
      await api.post('/api/projects/documents', { ...uploadForm, fileUrl, fileSize: uploadForm.fileSize, fileType: uploadForm.fileType });
      showToast('Document uploaded');
      setUploadDocModal(false);
      setSelectedFile(null);
      setSelectedFile(null);
      setUploadForm({ name: '', fileUrl: '', fileSize: '', fileType: 'pdf', projectId: '', taskId: null });
      if (selectedDocProject) loadProjectDocs(selectedDocProject);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
      setFileUploading(false);
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/api/projects/documents/${docId}`);
      showToast('Document deleted');
      if (selectedDocProject) loadProjectDocs(selectedDocProject);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleCreateProject = async () => {
    if (!projectForm.name) { showToast('Project name is required', 'error'); return; }
    if (projectForm.name.length > 30) { showToast('Project name must be at most 30 characters', 'error'); return; }
    if (!/^[a-zA-Z0-9]+$/.test(projectForm.name)) { showToast('Project name must contain only letters and numbers', 'error'); return; }
    if (!projectForm.description) { showToast('Description is required', 'error'); return; }
    if (!projectForm.departments || projectForm.departments.length === 0) { showToast('At least one department is required', 'error'); return; }
    if (!projectForm.startDate) { showToast('Start date is required', 'error'); return; }
    if (!projectForm.endDate) { showToast('End date is required', 'error'); return; }
    if (projectForm.endDate < projectForm.startDate) { showToast('End date cannot be before start date', 'error'); return; }
    const today = new Date().toISOString().split('T')[0];
    if (projectForm.startDate < today) { showToast('Start date cannot be before today', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/projects', projectForm);
      showToast('Project created');
      setShowProjectModal(false);
      setProjectForm({ name: '', description: '', departments: [], startDate: '', endDate: '', team: [] });
      loadAll();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = tasks.filter(t => !filterProject || t.projectId?._id === filterProject || t.projectId === filterProject);
  const userProjectIds = [...new Set(tasks.map(t => t.projectId?._id || t.projectId).filter(Boolean))];
  const visibleProjects = projects.filter(p => userProjectIds.includes(p._id));

  const selectedProjectDepts = selectedProjectObj?.departments || [];
  const assignableEmployees = selectedProjectDepts.length > 0
    ? employees.filter(e => selectedProjectDepts.includes(e.department))
    : employees;

  return (
    <AppShell title="Tasks & Projects">
      {toast && (
        <div className="toast-container-custom">
          <div className={`toast-custom ${toast.type}`}>
            <i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h4>Tasks & Projects</h4>
          <p>{tasks.filter(t => t.status !== 'Completed').length} active · {tasks.filter(t => t.status === 'Completed').length} completed</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline-secondary" onClick={openProjectDocs}><i className="bi bi-folder2-open me-2" />Project Documents</button>
            {isAdmin && (
              <>
                <button className="btn btn-outline-primary" onClick={() => setShowProjectModal(true)}><i className="bi bi-plus-lg me-2" />New Project</button>
                <button className="btn btn-primary" onClick={openAdd}><i className="bi bi-plus-lg me-2" />New Task</button>
              </>
            )}
          </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['kanban', 'list', 'projects'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'kanban' ? 'Kanban Board' : t === 'list' ? 'List View' : 'Projects'}
          </button>
        ))}
      </div>

      {tab !== 'projects' && visibleProjects.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <select className="form-select" style={{ width: 220, fontSize: 13 }} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {visibleProjects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div>
      ) : (
        <>
          {/* Kanban */}
          {tab === 'kanban' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {STATUSES.map(status => {
                const colTasks = filtered.filter(t => t.status === status);
                return (
                  <div key={status} className="kanban-col">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[status] }} />
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{status}</span>
                      </div>
                      <span style={{ background: '#e2e8f0', color: '#64748b', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{colTasks.length}</span>
                    </div>
                    {colTasks.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>No tasks</div>}
                    {colTasks.map(task => (
                      <div key={task._id} className="kanban-card" onClick={() => openEdit(task)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e293b', lineHeight: 1.4, flex: 1 }}>{task.title}</span>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLORS[task.priority], flexShrink: 0, marginTop: 4, marginLeft: 6 }} />
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                          {task.projectId?.name || '—'}
                          {task.projectId?.departments?.length > 0 && <span style={{ color: '#64748b' }}> · {task.projectId.departments.join(', ')}</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>
                            {task.assignedTo?.avatar || task.assignedTo?.name?.slice(0, 2).toUpperCase() || '?'}
                          </div>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>Due {task.due || '—'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {STATUSES.filter(s => s !== status).filter(s => s !== 'Blocked' || isAdmin).map(s => (
                            <button key={s} onClick={e => { e.stopPropagation(); moveTask(task._id, s); }}
                              style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${STATUS_COLORS[s]}40`, background: STATUS_COLORS[s] + '10', color: STATUS_COLORS[s], cursor: 'pointer', fontWeight: 600 }}>
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* List */}
          {tab === 'list' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Task</th><th>Project</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Due</th>{isAdmin && <th>Edit</th>}</tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-check2-square" /><p>No tasks found</p></div></td></tr>
                    ) : filtered.map(task => (
                      <tr key={task._id}>
                        <td>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{task.title}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{task.description}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {task.projectId?.name || '—'}
                          {task.projectId?.departments?.length > 0 && <div style={{ fontSize: 10, color: '#94a3b8' }}>{task.projectId.departments.join(', ')}</div>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>
                              {task.assignedTo?.avatar || task.assignedTo?.name?.slice(0, 2).toUpperCase() || '?'}
                            </div>
                            <span style={{ fontSize: 12 }}>{task.assignedTo?.name || '—'}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: PRIORITY_COLORS[task.priority], display: 'inline-block', marginRight: 6 }} />
                          <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{task.priority}</span>
                        </td>
                        <td><span className="badge" style={{ background: STATUS_COLORS[task.status] + '20', color: STATUS_COLORS[task.status] }}>{task.status}</span></td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{task.due || '—'}</td>
                        {isAdmin && <td><button className="btn btn-sm btn-outline-primary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(task)}><i className="bi bi-pencil" /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Projects */}
          {tab === 'projects' && (
            <div className="row g-3">
              {projects.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-kanban" /><p>No projects yet. Create one!</p></div></div>}
              {projects.map(proj => {
                const projTasks = tasks.filter(t => t.projectId?._id === proj._id || t.projectId === proj._id);
                const done = projTasks.filter(t => t.status === 'Completed').length;
                const pct  = projTasks.length > 0 ? Math.round((done / projTasks.length) * 100) : proj.progress || 0;
                return (
                  <div key={proj._id} className="col-md-6 col-xl-4">
                    <div className="card p-3">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{proj.name}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{proj.startDate || '—'} → {proj.endDate || '—'}</div>
                          {proj.departments?.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                              {proj.departments.map(d => <span key={d} style={{ background: '#f1f5f9', color: '#475569', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4 }}>{d}</span>)}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`badge ${proj.status === 'completed' ? 'status-approved' : 'status-pending'}`}>{proj.status || 'active'}</span>
                          <button className="project-info-btn" onClick={() => setInfoProject(proj)} title="Project details"><i className="bi bi-info" /></button>
                        </div>
                      </div>
                      <div className="progress mb-2">
                        <div className="progress-bar" style={{ width: `${pct}%`, background: '#3b82f6' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                        <span>{pct}% complete</span>
                        <span>{done}/{projTasks.length} tasks done</span>
                      </div>
                      {proj.team?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {proj.team.map(m => (
                            <div key={m._id || m} style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, border: '2px solid #fff' }}>
                              {m.avatar || m.name?.slice(0, 2).toUpperCase() || '?'}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Task Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editTask ? 'Edit Task' : 'New Task'}</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Task Title *</label>
                    <input className="form-control" maxLength={30} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value.replace(/[^a-zA-Z0-9]/g, '') }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description *</label>
                    <textarea className="form-control" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Project *</label>
                    <select className="form-select" value={form.projectId} onChange={e => { const v = e.target.value; const found = projects.find(p => String(p._id) === String(v)); setSelectedProjectObj(found || null); setForm(p => ({ ...p, projectId: v })); }}>
                      <option value="">Select Project</option>
                      {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  {isAdmin && (
                    <div className="col-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Assign To *</label>
                      <select className="form-select assign-select" value={form.assignedTo} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))} disabled={!selectedProjectObj}>
                        <option value="">Select employee</option>
                        {assignableEmployees.map(e => <option key={e._id} value={e.userId || e._id}>{e.name}{selectedProjectDepts.length > 0 ? ` (${e.department})` : ''}</option>)}
                      </select>
                      {selectedProjectDepts.length > 0 && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Showing employees from selected project's departments</div>
                      )}
                    </div>
                  )}
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Priority *</label>
                    <select className="form-select" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                      {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status *</label>
                    <select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Due Date *</label>
                    <DateInput className="form-control" value={form.due} onChange={e => setForm(p => ({ ...p, due: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : editTask ? 'Save Changes' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Documents Modal */}
      {showProjectDocsModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg" style={{ maxWidth: 760 }}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-folder2-open me-2" />Project Documents</h5>
                <button className="btn-close" onClick={() => setShowProjectDocsModal(false)} />
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <div className="proj-docs-layout">
                  <div className="proj-docs-sidebar">
                    <div style={{ padding: '8px 16px 4px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>Projects</div>
                    {projects.length === 0 ? (
                      <div className="proj-docs-empty" style={{ padding: '20px 10px', fontSize: 12 }}>No projects</div>
                    ) : projects.map(p => (
                      <button key={p._id} className={`proj-docs-sidebar-item${selectedDocProject === p._id ? ' active' : ''}`} onClick={() => selectDocProject(p._id)}>
                        <i className="bi bi-kanban" />
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <div className="proj-docs-main">
                    {!selectedDocProject ? (
                      <div className="proj-docs-empty"><i className="bi bi-hand-index" /><p>Select a project</p></div>
                    ) : (
                      <>
                        <div className="proj-docs-header">
                          <h6><i className="bi bi-list-task me-2" />{projects.find(p => p._id === selectedDocProject)?.name || 'Project'} Tasks</h6>
                          <button className="btn btn-sm btn-primary proj-docs-upload-btn" onClick={() => { setUploadForm(p => ({ ...p, projectId: selectedDocProject })); setUploadDocModal(true); }}>
                            <i className="bi bi-upload me-1" />Upload Document
                          </button>
                        </div>
                        {tasks.filter(t => t.projectId?._id === selectedDocProject || t.projectId === selectedDocProject).length === 0 ? (
                          <div className="proj-docs-empty"><i className="bi bi-list-task" /><p>No tasks for this project</p></div>
                        ) : tasks.filter(t => t.projectId?._id === selectedDocProject || t.projectId === selectedDocProject).map(task => {
                          const taskDocs = projectDocs.filter(d => d.taskId?._id === task._id || d.taskId === task._id);
                          const hasDocs = taskDocs.length > 0;
                          return (
                            <div key={task._id} style={{ marginBottom: 16, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                              <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: hasDocs ? '1px solid #e2e8f0' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[task.status], flexShrink: 0 }} />
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{task.title}</span>
                                  <span className="badge" style={{ background: PRIORITY_COLORS[task.priority] + '20', color: PRIORITY_COLORS[task.priority], fontSize: 10, padding: '2px 8px' }}>{task.priority}</span>
                                  {!hasDocs && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>No documents</span>}
                                </div>
                              </div>
                              {hasDocs && taskDocs.map(d => (
                                <div key={d._id} className="proj-docs-item" style={{ padding: '8px 14px' }}>
                                  <div className="proj-docs-item-icon" style={{ width: 32, height: 32, fontSize: 13 }}>
                                    <i className={`bi ${d.fileType === 'pdf' ? 'bi-file-earmark-pdf' : 'bi-file-earmark'}`} />
                                  </div>
                                  <div className="proj-docs-item-info">
                                    <div className="proj-docs-item-name" style={{ fontSize: 12.5 }}>{d.name}</div>
                                    <div className="proj-docs-item-meta">
                                      <i className="bi bi-calendar3" style={{ fontSize: 9 }} />
                                      {d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}
                                      {d.fileSize ? <><span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1', display: 'inline-block' }} />{d.fileSize}</> : ''}
                                      {d.uploadedBy?.name ? <><span style={{ width: 3, height: 3, borderRadius: '50%', background: '#cbd5e1', display: 'inline-block' }} />{d.uploadedBy.name}</> : ''}
                                    </div>
                                  </div>
                                  <div className="proj-docs-actions">
                                    <a href={d.fileUrl} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ padding: '4px 8px', fontSize: 10, borderRadius: 6, background: '#eff6ff', color: '#2563eb', border: '1px solid #dbeafe' }}>
                                      <i className="bi bi-download" />
                                    </a>
                                    {['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user?.role) && (
                                      <button className="btn btn-sm" style={{ padding: '4px 8px', fontSize: 10, borderRadius: 6, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }} onClick={() => handleDeleteDoc(d._id)}>
                                        <i className="bi bi-trash" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload Document Modal */}
      {uploadDocModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-upload me-2" />Upload Document</h5>
                <button className="btn-close" onClick={() => setUploadDocModal(false)} />
              </div>
              <div className="modal-body">
                <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    <i className="bi bi-kanban me-2" />{projects.find(p => p._id === uploadForm.projectId)?.name || 'Project'}
                  </div>
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Task *</label>
                    <select className="form-select" value={uploadForm.taskId || ''} onChange={e => setUploadForm(p => ({ ...p, taskId: e.target.value || null }))}>
                      <option value="">Select a task</option>
                      {tasks.filter(t => t.projectId?._id === uploadForm.projectId || t.projectId === uploadForm.projectId).map(task => (
                        <option key={task._id} value={task._id}>{task.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Document Name *</label>
                    <input className="form-control" value={uploadForm.name} onChange={e => setUploadForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Add Document *</label>
                    <input className="form-control" type="file" onChange={e => { const f = e.target.files?.[0]; if (f) { setSelectedFile(f); setUploadForm(p => ({ ...p, fileType: f.name.split('.').pop() || p.fileType })); } }} style={{ padding: '6px 12px', minHeight: 42 }} />
                    {selectedFile && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}><i className="bi bi-check-circle me-1" />{selectedFile.name}</div>}
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>File Type</label>
                    <select className="form-select" value={uploadForm.fileType} onChange={e => setUploadForm(p => ({ ...p, fileType: e.target.value }))}>
                      {['pdf', 'doc', 'docx', 'zip', 'image', 'other'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setUploadDocModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleUploadDoc} disabled={saving || fileUploading}>
                  {fileUploading ? <><span className="spinner-border spinner-border-sm me-2" />Uploading file...</> : saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Modal */}
      {showProjectModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">New Project</h5>
                <button className="btn-close" onClick={() => setShowProjectModal(false)} />
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Project Name *</label>
                    <input className="form-control" maxLength={30} value={projectForm.name} onChange={e => setProjectForm(p => ({ ...p, name: e.target.value.replace(/[^a-zA-Z0-9]/g, '') }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description *</label>
                    <textarea className="form-control" rows={2} value={projectForm.description} onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Departments</label>
                    <div>
                      <select className="form-select" value="" onChange={e => { const v = e.target.value; if (v && !projectForm.departments.includes(v)) setProjectForm(p => ({ ...p, departments: [...p.departments, v] })); }}>
                        <option value="">Add department...</option>
                        {departments.length === 0 && <option disabled>No departments — add in Settings</option>}
                        {departments.filter(d => !projectForm.departments.includes(d)).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {projectForm.departments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {projectForm.departments.map(d => (
                            <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', fontSize: 12, fontWeight: 600 }}>
                              {d}
                              <button type="button" onClick={() => setProjectForm(p => ({ ...p, departments: p.departments.filter(x => x !== d) }))} style={{ border: 'none', background: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex' }}>&times;</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Start Date *</label>
                    <DateInput className="form-control" value={projectForm.startDate} onChange={e => setProjectForm(p => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>End Date *</label>
                    <DateInput className="form-control" value={projectForm.endDate} onChange={e => setProjectForm(p => ({ ...p, endDate: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowProjectModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleCreateProject} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Creating...</> : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {infoProject && (
        <div className="project-info-overlay" onClick={() => setInfoProject(null)}>
          <div className="project-info-modal" onClick={e => e.stopPropagation()}>
            <div className="project-info-header">
              <h5>{infoProject.name}</h5>
              <button className="project-info-close" onClick={() => setInfoProject(null)}><i className="bi bi-x" /></button>
            </div>
            <div className="project-info-body">
              <div className="project-info-section">
                <div className="project-info-label">Description</div>
                <div className="project-info-value">{infoProject.description || '—'}</div>
              </div>
              <div className="project-info-section">
                <div className="project-info-label">Departments</div>
                <div className="project-info-chips">
                  {infoProject.departments?.length > 0
                    ? infoProject.departments.map(d => <span key={d} className="project-info-chip">{d}</span>)
                    : <span className="project-info-value" style={{ color: '#94a3b8' }}>None</span>}
                </div>
              </div>
              <div className="project-info-section">
                <div className="project-info-label">Duration</div>
                <div className="project-info-value">{infoProject.startDate || '—'} → {infoProject.endDate || '—'}</div>
              </div>
              <div className="project-info-section">
                <div className="project-info-label">Tasks</div>
                <div className="project-info-value">
                  {(() => {
                    const pts = tasks.filter(t => t.projectId?._id === infoProject._id || t.projectId === infoProject._id);
                    const done = pts.filter(t => t.status === 'Completed').length;
                    return `${done}/${pts.length} completed`;
                  })()}
                </div>
              </div>
              {infoProject.team?.length > 0 && (
                <div className="project-info-section">
                  <div className="project-info-label">Team Members</div>
                  <div className="project-info-members">
                    {infoProject.team.map(m => (
                      <div key={m._id || m} className="project-info-member">
                        <div className="project-info-member-avatar">{m.avatar || m.name?.slice(0, 2).toUpperCase() || '?'}</div>
                        <span>{m.name || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </AppShell>
  );
}
