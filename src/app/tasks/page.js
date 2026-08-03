'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';
import Pagination from '@/components/Pagination';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useSettings } from '@/lib/settings';

const STATUSES  = ['To Do', 'In Progress', 'Pending', 'Completed', 'Blocked'];
const PRIORITIES = ['low', 'medium', 'high'];
const PRIORITY_COLORS = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };
const STATUS_COLORS   = { 'To Do': '#64748b', 'In Progress': '#3b82f6', 'Pending': '#f59e0b', 'Completed': '#10b981', 'Blocked': '#ef4444' };
const EMPTY_TASK = { title: '', description: '', projectId: '', assignedTo: '', priority: 'medium', status: 'To Do', due: '' };
const MIN_PROJECT_DATE = '2022-03-01';

function formatProjectDuration(startDate, endDate) {
  if (!startDate || !endDate) return '—';
  const days = Math.max(0, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000));
  return days >= 30 ? `${Math.floor(days / 30)}m ${days % 30}d` : `${days} day${days === 1 ? '' : 's'}`;
}

function getCurrentStatusStartedAt(task) {
  const history = Array.isArray(task.statusHistory) ? task.statusHistory : [];
  return history[history.length - 1]?.changedAt || task.updatedAt || task.createdAt;
}

function formatStatusDuration(date) {
  const start = new Date(date).getTime();
  if (!date || Number.isNaN(start)) return 'just now';
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

export default function TasksPage() {
  const { user } = useAuth();
  const { formatDate, formatDateTime } = useSettings();
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
  const [projectForm, setProjectForm] = useState({ name: '', description: '', departments: [], startDate: '', endDate: '', team: [], responsibleTo: '' });
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
  const [statusChange, setStatusChange] = useState(null);
  const [activityComment, setActivityComment] = useState('');
  const [activityDate, setActivityDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [listPage, setListPage] = useState(1);
  const [projPage, setProjPage] = useState(1);
  const [expandedProjectId, setExpandedProjectId] = useState(null);
  const pageSize = 10;

  useEffect(() => {
    setListPage(1);
    setProjPage(1);
  }, [tab, filterProject]);

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
    setUploadForm({ name: '', fileUrl: '', fileSize: '', fileType: 'pdf', projectId: pid, taskId: task._id });
    setSelectedFile(null);
    loadProjectDocs(pid);
    setShowModal(true);
  };

  const handleSave = async (confirmed = false) => {
    if (!form.title) { showToast('Task title is required', 'error'); return; }
    if (form.title.length > 30) { showToast('Task title must be at most 30 characters', 'error'); return; }
    if (!form.title.trim()) { showToast('Task title cannot contain only spaces', 'error'); return; }
    if (!form.description) { showToast('Task description is required', 'error'); return; }
    if (!form.projectId) { showToast('Please select a project', 'error'); return; }
    if (!form.assignedTo) { showToast('Please select an assignee', 'error'); return; }
    if (!form.priority) { showToast('Priority is required', 'error'); return; }
    if (!form.due) { showToast('Due date is required', 'error'); return; }

    // Validate due date is within project's date range
    if (selectedProjectObj) {
      if (form.due < selectedProjectObj.startDate) {
        showToast(`Due date cannot be before project start date (${formatDate(selectedProjectObj.startDate)})`, 'error');
        return;
      }
      if (form.due > selectedProjectObj.endDate) {
        showToast(`Due date cannot be after project end date (${formatDate(selectedProjectObj.endDate)})`, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      if (editTask) {
        if (form.status !== editTask.status && !confirmed) return setStatusChange({ task: editTask, newStatus: form.status, action: 'save' });
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

  const moveTask = async (id, newStatus, confirmed = false) => {
    const task = tasks.find(item => item._id === id);
    if (!task || task.status === newStatus) return;
    if (!confirmed) return setStatusChange({ task, newStatus, action: 'move' });
    try {
      await api.put(`/api/tasks/${id}`, { status: newStatus });
      setTasks(prev => prev.map(t => t._id === id ? { ...t, status: newStatus } : t));
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const addTaskActivity = async () => {
    if (!activityComment.trim() || !editTask) return showToast('Comment is required', 'error');
    setSaving(true);
    try {
      const updated = await api.put(`/api/tasks/${editTask._id}`, { action: 'add_activity', date: activityDate, comment: activityComment });
      setEditTask(updated); setActivityComment(''); showToast('Comment added'); loadAll();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const downloadTaskActivity = () => {
    if (!editTask) return;
    const rows = [['Date', 'Project', 'Task', 'Comment'], ...(editTask.activityLog || []).map(item => [item.date, editTask.projectId?.name || '', editTask.title, item.comment])];
    const csv = rows.map(row => row.map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${editTask.title.replace(/[^a-z0-9]/gi, '-')}-activity.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  const downloadProjectProgress = async (project, projectTasks, format) => {
    const headers = ['Task', 'Assignee', 'Priority', 'Status', 'Due Date'];
    const rows = projectTasks.map(task => [task.title, task.assignedTo?.name || '', task.priority, task.status, task.due || '']);
    const filename = `${project.name.replace(/[^a-z0-9]/gi, '-')}-progress`;
    if (format === 'csv') {
      const csv = [headers, ...rows].map(row => row.map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${filename}.csv`; link.click(); URL.revokeObjectURL(link.href); return;
    }
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Project Progress'); sheet.addRow(headers); rows.forEach(row => sheet.addRow(row)); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach(column => { column.width = 20; });
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); link.download = `${filename}.xlsx`; link.click(); URL.revokeObjectURL(link.href); return;
    }
    const doc = new jsPDF({ orientation: 'landscape' }); doc.setFontSize(14); doc.text(`${project.name} - Project Progress`, 14, 16); autoTable(doc, { head: [headers], body: rows, startY: 22 }); doc.save(`${filename}.pdf`);
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
    if (selectedFile?.size > 3 * 1024 * 1024) { showToast('Document must be smaller than 3 MB', 'error'); return; }
    setSaving(true);
    try {
      let fileUrl = uploadForm.fileUrl;
      if (selectedFile) {
        setFileUploading(true);
        const fd = new FormData();
        fd.append('file', selectedFile);
        fd.append('projectId', uploadForm.projectId);
        const uploadRes = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: fd });
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
      if (uploadForm.projectId) loadProjectDocs(uploadForm.projectId);
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
    if (!projectForm.name.trim()) { showToast('Project name cannot contain only spaces', 'error'); return; }
    if (!projectForm.description) { showToast('Description is required', 'error'); return; }
    if (!projectForm.responsibleTo) { showToast('Project responsible person is required', 'error'); return; }
    if (!projectForm.departments || projectForm.departments.length === 0) { showToast('At least one department is required', 'error'); return; }
    if (!projectForm.startDate) { showToast('Start date is required', 'error'); return; }
    if (!projectForm.endDate) { showToast('End date is required', 'error'); return; }
    if (projectForm.endDate < projectForm.startDate) { showToast('End date cannot be before start date', 'error'); return; }
    if (projectForm.startDate < MIN_PROJECT_DATE) { showToast('Start date cannot be before March 2022', 'error'); return; }
    if (projectForm.endDate < MIN_PROJECT_DATE) { showToast('End date cannot be before March 2022', 'error'); return; }
    setSaving(true);
    try {
      await api.post('/api/projects', projectForm);
      showToast('Project created');
      setShowProjectModal(false);
      setProjectForm({ name: '', description: '', departments: [], startDate: '', endDate: '', team: [], responsibleTo: '' });
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#64748b', fontSize: 10.5, marginBottom: 9 }}>
                          <i className="bi bi-stopwatch" />
                          In {task.status} for {formatStatusDuration(getCurrentStatusStartedAt(task))}
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
                  <thead><tr><th>Task</th><th>Project</th><th>Assignee</th><th>Priority</th><th>Status</th><th>In status</th><th>Due</th>{isAdmin && <th>Edit</th>}</tr></thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={isAdmin ? 8 : 7}><div className="empty-state"><i className="bi bi-check2-square" /><p>No tasks found</p></div></td></tr>
                    ) : filtered.slice((listPage - 1) * pageSize, listPage * pageSize).map(task => (
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
                        <td style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}><i className="bi bi-stopwatch me-1" />{formatStatusDuration(getCurrentStatusStartedAt(task))}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{task.due || '—'}</td>
                        {isAdmin && <td><button className="btn btn-sm btn-outline-primary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => openEdit(task)}><i className="bi bi-pencil" /></button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > 0 && (
                <Pagination
                  currentPage={listPage}
                  totalPages={Math.ceil(filtered.length / pageSize)}
                  onPageChange={setListPage}
                  totalItems={filtered.length}
                  pageSize={pageSize}
                />
              )}
            </div>
          )}

          {/* Projects */}
          {tab === 'projects' && (
            <>
              <div className="row g-3">
                {projects.length === 0 && <div className="col-12"><div className="empty-state"><i className="bi bi-kanban" /><p>No projects yet. Create one!</p></div></div>}
                {projects.slice((projPage - 1) * pageSize, projPage * pageSize).map(proj => {
                const projTasks = tasks.filter(t => t.projectId?._id === proj._id || t.projectId === proj._id);
                const done = projTasks.filter(t => t.status === 'Completed').length;
                const pct  = projTasks.length > 0 ? Math.round((done / projTasks.length) * 100) : proj.progress || 0;
                const expanded = expandedProjectId === proj._id;
                return (
                  <div key={proj._id} className={expanded ? 'col-12' : 'col-md-6 col-xl-4'}>
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
                      {proj.status === 'completed' && <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', marginBottom: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#15803d', fontSize: 11.5, fontWeight: 700 }}><i className="bi bi-stopwatch" />Total time taken: {formatProjectDuration(proj.startDate, proj.completedAt || proj.updatedAt || proj.endDate)}</div>}
                      {proj.team?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {proj.team.map(m => (
                            <div key={m._id || m} style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, border: '2px solid #fff' }}>
                              {m.avatar || m.name?.slice(0, 2).toUpperCase() || '?'}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
                        <button className="btn btn-sm btn-outline-primary" onClick={() => { setExpandedProjectId(expanded ? null : proj._id); if (!expanded) loadProjectDocs(proj._id); }}><i className={`bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`} />{expanded ? 'Hide Tasks' : 'View Progress'}</button>
                        {expanded && <><button className="btn btn-sm btn-outline-secondary" onClick={() => downloadProjectProgress(proj, projTasks, 'csv')}>CSV</button><button className="btn btn-sm btn-outline-success" onClick={() => downloadProjectProgress(proj, projTasks, 'excel')}>Excel</button><button className="btn btn-sm btn-outline-danger" onClick={() => downloadProjectProgress(proj, projTasks, 'pdf')}>PDF</button><span style={{ width: 1, background: '#e2e8f0', margin: '0 4px' }} />{docsLoading ? <span style={{ fontSize: 12, color: '#64748b' }}>Loading documents...</span> : projectDocs.map(doc => <a key={doc._id} href={doc.fileUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary" title={doc.taskId?.title || 'Project document'}><i className="bi bi-paperclip me-1" />{doc.name}</a>)}</>}
                      </div>
                      {expanded && <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}><div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Task Progress ({done}/{projTasks.length} completed)</div><div className="table-responsive"><table className="table table-sm mb-0"><thead><tr><th>Task</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Due</th></tr></thead><tbody>{projTasks.length ? projTasks.map(task => <tr key={task._id}><td><strong>{task.title}</strong><div style={{ fontSize: 11, color: '#64748b' }}>{task.description}</div></td><td>{task.assignedTo?.name || '—'}</td><td style={{ textTransform: 'capitalize' }}>{task.priority}</td><td><span className="badge" style={{ background: STATUS_COLORS[task.status] + '20', color: STATUS_COLORS[task.status] }}>{task.status}</span></td><td>{task.due || '—'}</td></tr>) : <tr><td colSpan={5} style={{ color: '#64748b', textAlign: 'center' }}>No tasks have been created for this project.</td></tr>}</tbody></table></div></div>}
                    </div>
                  </div>
                );
              })}
            </div>
            {projects.length > 0 && (
              <div className="mt-3">
                <Pagination
                  currentPage={projPage}
                  totalPages={Math.ceil(projects.length / pageSize)}
                  onPageChange={setProjPage}
                  totalItems={projects.length}
                  pageSize={pageSize}
                />
              </div>
            )}
          </>
          )}
        </>
      )}

      {/* Task Modal */}
      {showModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg" style={{ maxWidth: 940 }}>
            <div className="modal-content">
              <div className="modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h5 className="modal-title">{editTask ? 'Edit Task' : 'New Task'}</h5>{editTask && <button className="btn btn-sm btn-outline-secondary" title="Download task comments" onClick={downloadTaskActivity}><i className="bi bi-download" /></button>}</div>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', background: '#f8fafc' }}>
                <div className="row g-3">
                  <div className="col-12"><div style={{ fontSize: 12, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: .5, paddingBottom: 7, borderBottom: '1px solid #dbeafe' }}><i className="bi bi-list-check me-2" />Task Details</div></div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Task Title *</label>
                    <input className="form-control" maxLength={30} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
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
                  {editTask && <><div className="col-12"><div style={{ fontSize: 12, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: .5, paddingTop: 8, paddingBottom: 7, borderBottom: '1px solid #dbeafe' }}><i className="bi bi-chat-left-text me-2" />Progress Comments</div></div><div className="col-4"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Comment Date</label><div style={{ display: 'flex', gap: 8 }}><DateInput className="form-control" value={activityDate} onChange={e => setActivityDate(e.target.value)} /><button type="button" className="btn btn-outline-primary" onClick={addTaskActivity} disabled={saving} title="Add dated comment"><i className="bi bi-plus-lg" /></button></div></div><div className="col-8"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Comment</label><textarea className="form-control" rows={2} value={activityComment} onChange={e => setActivityComment(e.target.value)} placeholder="Enter comment for the selected date" maxLength={2000} /></div><div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Saved Comments</label><div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, maxHeight: 160, overflowY: 'auto' }}>{(editTask.activityLog || []).length ? editTask.activityLog.map((item, index) => <div key={item._id || index} style={{ display: 'flex', gap: 12, padding: '9px 12px', borderBottom: index < editTask.activityLog.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 13 }}><strong style={{ color: '#475569', minWidth: 92 }}>{formatDate(item.date)}</strong><span style={{ whiteSpace: 'pre-wrap' }}>{item.comment}</span></div>) : <div style={{ padding: '10px 12px', color: '#64748b', fontSize: 13 }}>No comments added yet.</div>}</div></div><div className="col-12"><div style={{ fontSize: 12, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: .5, paddingTop: 8, paddingBottom: 7, borderBottom: '1px solid #dbeafe' }}><i className="bi bi-paperclip me-2" />Documents</div></div></>}
                  {editTask && <div className="col-12"><div className="row g-2"><div className="col-md-4"><input className="form-control" placeholder="Document name" value={uploadForm.name} onChange={e => setUploadForm(p => ({ ...p, name: e.target.value }))} /></div><div className="col-md-4"><input className="form-control" type="file" onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.size > 3 * 1024 * 1024) { showToast('Document must be smaller than 3 MB', 'error'); e.target.value = ''; return; } setSelectedFile(file); setUploadForm(p => ({ ...p, name: p.name || file.name, fileType: file.name.split('.').pop() || p.fileType, fileSize: `${(file.size / 1024).toFixed(1)} KB` })); } }} /></div><div className="col-md-4"><input className="form-control" placeholder="Or paste document URL" value={uploadForm.fileUrl} onChange={e => setUploadForm(p => ({ ...p, fileUrl: e.target.value }))} /></div><div className="col-12"><small className="text-muted">Upload a document under 3 MB or provide a document URL.</small><button type="button" className="btn btn-sm btn-outline-primary ms-2" onClick={handleUploadDoc} disabled={saving || fileUploading}><i className="bi bi-upload me-1" />{fileUploading ? 'Uploading...' : 'Add Document'}</button></div><div className="col-12"><div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginTop: 5, marginBottom: 4 }}>Uploaded Files</div><div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>{projectDocs.filter(doc => String(doc.taskId?._id || doc.taskId) === String(editTask._id)).length ? projectDocs.filter(doc => String(doc.taskId?._id || doc.taskId) === String(editTask._id)).map(doc => <div key={doc._id} style={{ padding: '5px 3px', borderBottom: '1px solid #f1f5f9' }}><a href={doc.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}><i className="bi bi-paperclip me-1" />{doc.name}</a></div>) : <span style={{ color: '#64748b', fontSize: 12 }}>No files uploaded for this task.</span>}</div></div></div></div>}
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
                                      {d.createdAt ? formatDate(d.createdAt) : '—'}
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
                    <input className="form-control" maxLength={30} value={projectForm.name} onChange={e => setProjectForm(p => ({ ...p, name: e.target.value }))} />
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
                              <button type="button" onClick={() => setProjectForm(p => ({ ...p, departments: p.departments.filter(x => x !== d), responsibleTo: p.departments.filter(x => x !== d).includes(employees.find(employee => String(employee.userId || employee._id) === String(p.responsibleTo))?.department) ? p.responsibleTo : '' }))} style={{ border: 'none', background: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex' }}>&times;</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Project Responsible *</label><select className="form-select" value={projectForm.responsibleTo} onChange={e => setProjectForm(p => ({ ...p, responsibleTo: e.target.value }))} disabled={projectForm.departments.length === 0}><option value="">{projectForm.departments.length ? 'Select responsible person' : 'Select department first'}</option>{employees.filter(employee => projectForm.departments.includes(employee.department)).map(employee => <option key={employee.userId || employee._id} value={employee.userId || employee._id}>{employee.name} ({employee.department})</option>)}</select></div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Start Date *</label>
                    <DateInput className="form-control" value={projectForm.startDate} min={MIN_PROJECT_DATE} onChange={e => setProjectForm(p => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>End Date *</label>
                    <DateInput className="form-control" value={projectForm.endDate} min={MIN_PROJECT_DATE} onChange={e => setProjectForm(p => ({ ...p, endDate: e.target.value }))} />
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

      {statusChange && <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 16 }}>
        <div className="card shadow-lg" style={{ width: '100%', maxWidth: 440, border: 'none', borderRadius: 20, overflow: 'hidden' }}>
          <div style={{ padding: '24px 28px 20px', background: 'linear-gradient(135deg, #f8fbff, #ffffff)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ width: 42, height: 42, borderRadius: 13, background: '#eaf2ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i className="bi bi-arrow-left-right" style={{ fontSize: 19 }} /></div><div><div style={{ fontSize: 11, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', letterSpacing: 0.7 }}>Task workflow</div><h5 style={{ fontWeight: 750, color: '#0f172a', margin: '2px 0 0' }}>Confirm progress change</h5></div></div></div>
          <div style={{ padding: '20px 28px 24px' }}><div style={{ color: '#334155', fontSize: 14, fontWeight: 650, marginBottom: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{statusChange.task.title}</div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ padding: '7px 10px', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 12, fontWeight: 700 }}>{statusChange.task.status}</span><i className="bi bi-arrow-right" style={{ color: '#94a3b8' }} /><span style={{ padding: '7px 10px', borderRadius: 8, background: `${STATUS_COLORS[statusChange.newStatus]}18`, color: STATUS_COLORS[statusChange.newStatus], fontSize: 12, fontWeight: 800 }}>{statusChange.newStatus}</span></div><p style={{ color: '#64748b', fontSize: 12.5, margin: '16px 0 0', lineHeight: 1.5 }}>This updates the task workflow and may notify the relevant reviewers.</p></div>
          <div style={{ padding: '14px 28px', background: '#f8fafc', borderTop: '1px solid #eef2f7', display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-light" style={{ border: '1px solid #cbd5e1', fontWeight: 650 }} onClick={() => setStatusChange(null)}>Cancel</button><button className="btn btn-primary" style={{ fontWeight: 700, paddingInline: 20 }} onClick={() => { const change = statusChange; setStatusChange(null); if (change.action === 'save') handleSave(true); else moveTask(change.task._id, change.newStatus, true); }}>Confirm change</button></div>
        </div>
      </div>}
    </AppShell>
  );
}
