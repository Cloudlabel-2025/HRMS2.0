'use client';

import { useEffect, useMemo, useState } from 'react';
import DateInput from '@/components/DateInput';
import ConfirmModal from '@/components/ConfirmModal';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';

// All User roles except super_admin (see ROLES in User model)
const ASSIGNABLE_ROLES = ['admin_full', 'recruiter', 'team_lead', 'team_admin', 'employee', 'intern', 'sme'];
const EMP_PAGE_SIZE = 10;

const STATUS_CONFIG = {
  pending:   { color: '#f59e0b', bg: '#fffbeb', label: 'Pending' },
  applied:   { color: '#10b981', bg: '#f0fdf4', label: 'Applied' },
  cancelled: { color: '#6b7280', bg: '#f1f5f9', label: 'Cancelled' },
};

const fmt = s => String(s || '').replace(/_/g, ' ');

function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: '#64748b', bg: '#f1f5f9', label: status };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: cfg.bg, color: cfg.color, textTransform: 'capitalize', border: `1px solid ${cfg.color}30` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

function Field({ label, children, col = 'col-md-6', hint }) {
  return (
    <div className={col}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'block' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function CheckboxGroup({ title, options, selected, onToggle, valueOf = o => o, labelOf = o => o, hint }) {
  const items = Array.isArray(options) ? options : [];
  const checkedValues = Array.isArray(selected) ? selected : [];
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#fbfdff' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{title}</div>
      {hint && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{hint}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', maxHeight: 160, overflow: 'auto' }}>
        {items.map((opt, idx) => {
          if (opt === null || opt === undefined) return null;
          let val;
          try { val = valueOf(opt); } catch { return null; }
          if (val === null || val === undefined) return null;
          let label;
          try { label = labelOf(opt); } catch { label = String(val); }
          return (
            <label key={`${String(val)}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={checkedValues.includes(val)} onChange={() => onToggle(val)} />
              {label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function filtersSummary(change) {
  const parts = [];
  if (change.userIds?.length) parts.push(`${change.userIds.length} specific employee(s)`);
  if (change.departments) parts.push(change.departments);
  if (change.roles) parts.push(change.roles);
  if (change.fromShiftId) parts.push(`From: ${change.fromShiftId?.name || 'selected shift'}`);
  return parts.join(' • ') || 'All active employees';
}

export default function ShiftManagement() {
  const { user } = useAuth();
  const { formatDate, formatDateTime } = useSettings();

  const [shifts, setShifts]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [pending, setPending]     = useState([]);
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview]     = useState(null);
  const [toast, setToast]         = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [empPage, setEmpPage] = useState(1);

  const [form, setForm] = useState({
    shiftId: '',
    effectiveDate: todayLocal(),
    reason: '',
    userIds: [],
    departments: [],
    roles: [...ASSIGNABLE_ROLES],
    fromShiftId: '',
    empSearch: '',
  });

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [shiftRes, deptRes, empRes, assignRes] = await Promise.all([
        api.get('/api/settings?type=shifts'),
        api.get('/api/settings?type=departments'),
        api.get('/api/employees'),
        api.get('/api/shifts/assign'),
      ]);
      setShifts((Array.isArray(shiftRes) ? shiftRes : []).filter(s => s && typeof s === 'object' && s._id));
      setDepartments((Array.isArray(deptRes) ? deptRes : []).map(d => d?.name).filter(Boolean).sort());
      setEmployees((Array.isArray(empRes) ? empRes : []).filter(e => e && typeof e === 'object' && e.userId));
      setPending(Array.isArray(assignRes?.pending) ? assignRes.pending : []);
      setHistory(Array.isArray(assignRes?.history) ? assignRes.history : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const toggleDept = dept => setForm(p => ({ ...p, departments: p.departments.includes(dept) ? p.departments.filter(d => d !== dept) : [...p.departments, dept] }));
  const toggleUser = uid => setForm(p => ({ ...p, userIds: p.userIds.includes(uid) ? p.userIds.filter(x => x !== uid) : [...p.userIds, uid] }));

  const filteredEmployees = useMemo(() => {
    const q = form.empSearch.trim().toLowerCase();
    let list = employees.filter(e => e && e.userId && e.status !== 'alumni' && e.role !== 'super_admin');
    if (q) list = list.filter(e => [e.name, e.email, e.department, e.employeeNumber, e.role, e.userId].some(v => String(v || '').toLowerCase().includes(q)));
    return list;
  }, [employees, form.empSearch]);

  const pageCount = Math.max(1, Math.ceil(filteredEmployees.length / EMP_PAGE_SIZE));
  const pageEmployees = filteredEmployees.slice((empPage - 1) * EMP_PAGE_SIZE, empPage * EMP_PAGE_SIZE);

  const selectedShift = useMemo(() => shifts.find(s => s._id === form.shiftId) || null, [shifts, form.shiftId]);

  const departmentOptions = useMemo(() => {
    const fromSettings = departments.filter(Boolean);
    const fromEmployees = employees.map(e => e?.department).filter(Boolean);
    return [...new Set([...fromSettings, ...fromEmployees])].sort();
  }, [departments, employees]);

  const estimatedCount = useMemo(() => {
    let list = employees.filter(e => e.status !== 'alumni' && e.role !== 'super_admin');
    if (form.departments.length) list = list.filter(e => form.departments.includes(e.department));
    if (form.roles.length) list = list.filter(e => form.roles.includes(e.role));
    if (form.fromShiftId) {
      const fromName = shifts.find(s => s._id === form.fromShiftId)?.name;
      list = list.filter(e => e.shiftId === form.fromShiftId || (e.shift && e.shift === fromName));
    }
    const ids = new Set(list.map(e => e.userId).filter(Boolean));
    form.userIds.forEach(uid => uid && ids.add(uid));
    return ids.size;
  }, [employees, shifts, form]);

  const reasonOk = form.reason.trim().length > 0;
  const shiftOk = !!form.shiftId;
  const isImmediate = !form.effectiveDate || form.effectiveDate <= todayLocal();
  const modalCount = preview?.count ?? estimatedCount;

  const runPreview = async () => {
    setAttempted(true);
    if (!shiftOk) return showToast('Select a target shift', 'error');
    if (!reasonOk) return showToast('Reason is required', 'error');
    setPreviewing(true);
    try {
      const res = await api.post('/api/shifts/assign/preview', {
        shiftId: form.shiftId,
        reason: form.reason,
        effectiveDate: form.effectiveDate,
        targets: {
          userIds: form.userIds,
          departments: form.departments,
          roles: form.roles,
          fromShiftId: form.fromShiftId || undefined,
        },
      });
      setPreview(res);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    setAttempted(true);
    if (!shiftOk) return showToast('Select a target shift', 'error');
    if (!reasonOk) return showToast('Reason is required', 'error');
    setSaving(true);
    try {
      const res = await api.post('/api/shifts/assign', {
        shiftId: form.shiftId,
        reason: form.reason,
        effectiveDate: form.effectiveDate,
        targets: {
          userIds: form.userIds,
          departments: form.departments,
          roles: form.roles,
          fromShiftId: form.fromShiftId || undefined,
        },
      });
      setConfirmOpen(false);
      setPreview(null);
      if (res.scheduled) {
        showToast(`Scheduled for ${formatDate(res.effectiveDate)} — ${res.count} employee(s) will move to ${res.shiftName}.`);
      } else {
        showToast(`Applied — ${res.applied} employee(s) moved to ${res.shiftName}.`);
      }
      await loadData(true);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelChange = async (change) => {
    try {
      await api.delete('/api/shifts/assign?id=' + change._id);
      showToast('Change cancelled');
      await loadData(true);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><div className="spinner-border text-primary" /></div>;
  }

  return (
    <>
      {toast && (
        <div className={`alert alert-${toast.type === 'error' ? 'danger' : 'success'} py-2`} style={{ fontSize: 13 }}>
          <i className={`bi ${toast.type === 'error' ? 'bi-exclamation-circle' : 'bi-check-circle'} me-1`} />{toast.msg}
        </div>
      )}

      {/* Assignment form */}
      <div className="card p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap" style={{ gap: 8 }}>
          <h6 className="mb-0" style={{ fontSize: 13, fontWeight: 700 }}>Assign or schedule a shift change</h6>
        </div>

        <div className="row g-3">
          <Field label="Target Shift" col="col-md-4">
            <select className="form-select" style={{ fontSize: 13 }} value={form.shiftId} onChange={e => setForm(p => ({ ...p, shiftId: e.target.value }))}>
              <option value="">Select shift</option>
              {shifts.map(s => (
                <option key={s._id} value={s._id}>{s.name} — {s.startTime}–{s.endTime}</option>
              ))}
            </select>
          </Field>

          <Field label="From Current Shift (optional)" col="col-md-4">
            <select className="form-select" style={{ fontSize: 13 }} value={form.fromShiftId} onChange={e => setForm(p => ({ ...p, fromShiftId: e.target.value }))}>
              <option value="">All shifts</option>
              {shifts.map(s => (
                <option key={s._id} value={s._id}>{s.name} — {s.startTime}–{s.endTime}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Only employees currently on this shift are included.</div>
          </Field>

          <Field label="Effective Date" col="col-md-4">
            <DateInput className="form-control" style={{ fontSize: 13 }} value={form.effectiveDate} onChange={e => setForm(p => ({ ...p, effectiveDate: e.target.value }))} />
            {form.effectiveDate && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                Selected: {formatDate(form.effectiveDate)}
              </div>
            )}
            <div style={{ fontSize: 11, color: isImmediate ? '#2563eb' : '#b45309', marginTop: 3 }}>
              {isImmediate ? 'Applies immediately on confirm.' : 'Scheduled — applied automatically on this date.'}
            </div>
          </Field>

          <Field label="Reason (required)" col="col-md-12">
            <textarea className="form-control" rows={2} style={{ fontSize: 13 }} placeholder="e.g. New roster approved by ops — all support staff move to evening shift from the 15th" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
            {attempted && !reasonOk && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 3 }}>
                <i className="bi bi-exclamation-circle me-1" />Reason is required before submitting
              </div>
            )}
          </Field>

          <div className="col-12">
            <CheckboxGroup
              title="Departments (optional)"
              hint="Leave all unchecked to include all departments. Options are taken from Settings → Departments (falling back to employee departments if none are configured)."
              options={departmentOptions}
              selected={form.departments}
              onToggle={toggleDept}
            />
          </div>

          <div className="col-12">
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#fbfdff' }}>
              <div className="d-flex align-items-center justify-content-between flex-wrap" style={{ gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Specific Employees ({form.userIds.length} selected)
                </div>
                <input
                  className="form-control form-control-sm"
                  style={{ fontSize: 12, maxWidth: 320 }}
                  placeholder="Search employees..."
                  value={form.empSearch}
                  onChange={e => { setForm(p => ({ ...p, empSearch: e.target.value })); setEmpPage(1); }}
                />
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                Optional — search and tick individuals. Picks are merged with the department/from-shift filters above.
              </div>
              {pageEmployees.length === 0 ? (
                <div style={{ fontSize: 12, color: '#94a3b8', padding: '8px 2px' }}>No employees match the current search.</div>
              ) : (
                <div style={{ maxHeight: 280, overflow: 'auto' }}>
                  {pageEmployees.map(e => (
                    <label key={e.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', borderBottom: '1px solid #eef2f7', fontSize: 12.5, color: '#334155', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.userIds.includes(e.userId)} onChange={() => toggleUser(e.userId)} />
                      <span>
                        {e.name} <span style={{ color: '#94a3b8' }}>({e.department || '—'} • {e.shift || 'no shift'})</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {pageCount > 1 && (
                <div className="d-flex align-items-center justify-content-between mt-2" style={{ fontSize: 12 }}>
                  <span style={{ color: '#64748b' }}>Page {empPage} of {pageCount}</span>
                  <div className="d-flex gap-1">
                    <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 12, padding: '1px 8px' }} disabled={empPage <= 1} onClick={() => setEmpPage(p => Math.max(1, p - 1))}>Prev</button>
                    <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 12, padding: '1px 8px' }} disabled={empPage >= pageCount} onClick={() => setEmpPage(p => Math.min(pageCount, p + 1))}>Next</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 d-flex align-items-center gap-2">
          <button className="btn btn-outline-primary btn-sm" style={{ fontSize: 13 }} onClick={runPreview} disabled={previewing}>
            {previewing ? <><span className="spinner-border spinner-border-sm me-1" />Previewing...</> : <><i className="bi bi-eye me-1" />Preview Match</>}
          </button>
          <button
            className="btn btn-primary btn-sm"
            style={{ fontSize: 13 }}
            disabled={saving}
            onClick={() => {
              setAttempted(true);
              if (!shiftOk) return showToast('Select a target shift', 'error');
              if (!reasonOk) return showToast('Reason is required', 'error');
              setConfirmOpen(true);
            }}
          >
            {isImmediate ? <><i className="bi bi-lightning-charge me-1" />Apply Now</> : <><i className="bi bi-calendar-check me-1" />Schedule Change</>}
          </button>
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="card p-3 mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap" style={{ gap: 8 }}>
            <h6 className="mb-0" style={{ fontSize: 13, fontWeight: 700 }}>
              Preview — <span style={{ color: '#2563eb' }}>{preview.count}</span> affected · target <strong>{preview.shiftName}</strong>
            </h6>
            <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 12 }} onClick={() => setPreview(null)}><i className="bi bi-x-lg" /></button>
          </div>
          <div className="table-responsive" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="table table-sm mb-0">
              <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Current Shift</th>
                  <th>New Shift</th>
                </tr>
              </thead>
              <tbody>
                {preview.users.length === 0 ? (
                  <tr><td colSpan={4}><div className="empty-state py-3"><i className="bi bi-people" /><h6>No matching employees</h6></div></td></tr>
                ) : preview.users.map(u => (
                  <tr key={u._id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{u.email}{u.employeeNumber ? ` • ${u.employeeNumber}` : ''}</div>
                    </td>
                    <td style={{ fontSize: 12.5 }}>{u.department || '—'}</td>
                    <td style={{ fontSize: 12.5 }}>{u.shift || '—'}</td>
                    <td style={{ fontSize: 12.5, color: '#2563eb', fontWeight: 600 }}>{preview.shiftName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scheduled */}
      <div className="card p-3 mb-3">
        <h6 className="mb-3" style={{ fontSize: 13, fontWeight: 700 }}>Scheduled changes ({pending.length})</h6>
        {pending.length === 0 ? (
          <div className="empty-state py-3"><i className="bi bi-calendar-check" /><h6>No scheduled changes</h6></div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Target Shift</th>
                  <th>Filters</th>
                  <th>Reason</th>
                  <th>Effective</th>
                  <th>Status</th>
                  <th>Created By / At</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.map(c => (
                  <tr key={c._id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.targetShiftName}</div>
                      {c.targetShiftId?.startTime && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.targetShiftId.startTime} - {c.targetShiftId.endTime}</div>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{filtersSummary(c)}</td>
                    <td style={{ fontSize: 12.5 }}>{c.reason}</td>
                    <td style={{ fontSize: 12.5 }}>{formatDate(c.effectiveDate)}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>
                      <div>{c.createdBy?.name || 'System'}</div>
                      <div style={{ fontSize: 11 }}>{formatDateTime(c.createdAt)}</div>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => cancelChange(c)}>
                        <i className="bi bi-x-circle me-1" />Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History */}
      <div className="card p-3 mb-3">
        <h6 className="mb-3" style={{ fontSize: 13, fontWeight: 700 }}>History ({history.length})</h6>
        {history.length === 0 ? (
          <div className="empty-state py-3"><i className="bi bi-clock-history" /><h6>No past shift changes</h6></div>
        ) : (
          <div className="table-responsive">
            <table className="table mb-0">
              <thead>
                <tr>
                  <th>Target Shift</th>
                  <th>Filters</th>
                  <th>Reason</th>
                  <th>Effective</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th>Applied At</th>
                  <th>Created By</th>
                </tr>
              </thead>
              <tbody>
                {history.map(c => (
                  <tr key={c._id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.targetShiftName}</div>
                      {c.targetShiftId?.startTime && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.targetShiftId.startTime} - {c.targetShiftId.endTime}</div>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{filtersSummary(c)}</td>
                    <td style={{ fontSize: 12.5 }}>{c.reason}</td>
                    <td style={{ fontSize: 12.5 }}>{formatDate(c.effectiveDate)}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td style={{ fontSize: 12.5 }}>{c.appliedCount}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{c.appliedAt ? formatDateTime(c.appliedAt) : '—'}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{c.createdBy?.name || 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={isImmediate ? 'Apply Shift Change' : 'Schedule Shift Change'}
        confirmText={isImmediate ? 'Apply Now' : 'Schedule'}
        variant="primary"
        confirming={saving}
        onConfirm={submit}
        onClose={() => setConfirmOpen(false)}
      >
        <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
          <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div><span style={{ color: '#94a3b8', fontWeight: 700 }}>Affected:</span> <strong>{modalCount}</strong> employee(s)</div>
            <div className="mt-1"><span style={{ color: '#94a3b8', fontWeight: 700 }}>To shift:</span> <strong>{selectedShift?.name}</strong> {selectedShift && `(${selectedShift.startTime} - ${selectedShift.endTime})`}</div>
            <div className="mt-1"><span style={{ color: '#94a3b8', fontWeight: 700 }}>When:</span> {isImmediate ? 'Immediately' : formatDate(form.effectiveDate)}</div>
            <div className="mt-1"><span style={{ color: '#94a3b8', fontWeight: 700 }}>Reason:</span> {form.reason}</div>
          </div>
          <p className="mb-0" style={{ fontSize: 12, color: '#ef4444' }}>
            <i className="bi bi-exclamation-triangle me-1" />
            {isImmediate
              ? 'Applies instantly to all matching active employees (super_admin is always excluded).'
              : 'Applied automatically on the effective date. Employees on the target shift are skipped.'}
          </p>
        </div>
      </ConfirmModal>
    </>
  );
}
