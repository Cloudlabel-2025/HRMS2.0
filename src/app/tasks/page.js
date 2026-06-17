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
const EMPTY_TASK = { title: '', description: '', projectId: '', assignedTo: '', priority: 'medium', status: 'To Do', due: '', hours: '' };

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
  const [projectForm, setProjectForm] = useState({ name: '', description: '', deadline: '' });
  const [filterProject, setFilterProject] = useState('');
  const [loading, setLoading]       = useState(true);
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

  const loadEmployees = async () => {
    try {
      const emps = await api.get('/api/employees');
      setEmployees(Array.isArray(emps) ? emps : []);
    } catch {}
  };

  useEffect(() => {
    if (!user) return;
    loadAll();
    if (isAdmin) loadEmployees();
  }, [user]);

  const openAdd  = () => { setEditTask(null); setForm(EMPTY_TASK); setShowModal(true); };
  const openEdit = (task) => {
    setEditTask(task);
    setForm({
      title: task.title, description: task.description || '',
      projectId: task.projectId?._id || task.projectId || '',
      assignedTo: task.assignedTo?._id || task.assignedTo || '',
      priority: task.priority, status: task.status,
      due: task.due || '', hours: task.hours || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title || !form.due) { showToast('Title and due date are required', 'error'); return; }
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

  const handleCreateProject = async () => {
    if (!projectForm.name) { showToast('Project name is required', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/projects', projectForm);
      showToast('Project created');
      setShowProjectModal(false);
      setProjectForm({ name: '', description: '', deadline: '' });
      loadAll();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = tasks.filter(t => !filterProject || t.projectId?._id === filterProject || t.projectId === filterProject);

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
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline-primary" onClick={() => setShowProjectModal(true)}><i className="bi bi-plus-lg me-2" />New Project</button>
            <button className="btn btn-primary" onClick={openAdd}><i className="bi bi-plus-lg me-2" />New Task</button>
          </div>
        )}
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

      {tab !== 'projects' && projects.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <select className="form-select" style={{ width: 220, fontSize: 13 }} value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
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
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>{task.projectId?.name || '—'}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isAdmin ? 8 : 0 }}>
                          <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>
                            {task.assignedTo?.avatar || task.assignedTo?.name?.slice(0, 2).toUpperCase() || '?'}
                          </div>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>Due {task.due || '—'}</span>
                        </div>
                        {isAdmin && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {STATUSES.filter(s => s !== status).map(s => (
                              <button key={s} onClick={e => { e.stopPropagation(); moveTask(task._id, s); }}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: `1px solid ${STATUS_COLORS[s]}40`, background: STATUS_COLORS[s] + '10', color: STATUS_COLORS[s], cursor: 'pointer' }}>
                                → {s}
                              </button>
                            ))}
                          </div>
                        )}
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
                        <td style={{ fontSize: 13 }}>{task.projectId?.name || '—'}</td>
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
                          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Deadline: {proj.deadline || '—'}</div>
                        </div>
                        <span className={`badge ${proj.status === 'completed' ? 'status-approved' : 'status-pending'}`}>{proj.status || 'active'}</span>
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
                    <input className="form-control" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                    <textarea className="form-control" rows={2} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Project</label>
                    <select className="form-select" value={form.projectId} onChange={e => setForm(p => ({ ...p, projectId: e.target.value }))}>
                      <option value="">No Project</option>
                      {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </select>
                  </div>
                  {isAdmin && (
                    <div className="col-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Assign To *</label>
                      <select className="form-select" value={form.assignedTo} onChange={e => setForm(p => ({ ...p, assignedTo: e.target.value }))}>
                        <option value="">Select employee</option>
                        {employees.map(e => <option key={e._id} value={e.userId || e._id}>{e.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Priority</label>
                    <select className="form-select" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                      {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label>
                    <select className="form-select" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Due Date *</label>
                    <DateInput className="form-control" value={form.due} onChange={e => setForm(p => ({ ...p, due: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Est. Hours</label>
                    <input type="number" className="form-control" value={form.hours} onChange={e => setForm(p => ({ ...p, hours: e.target.value }))} />
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
                    <input className="form-control" value={projectForm.name} onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label>
                    <textarea className="form-control" rows={2} value={projectForm.description} onChange={e => setProjectForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Deadline</label>
                    <DateInput className="form-control" value={projectForm.deadline} onChange={e => setProjectForm(p => ({ ...p, deadline: e.target.value }))} />
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
    </AppShell>
  );
}
