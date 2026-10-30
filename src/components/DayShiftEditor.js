'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';

export default function DayShiftEditor({ date, onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [employeeIds, setEmployeeIds] = useState([]);
  const [search, setSearch] = useState('');
  const employeeId = employeeIds[0] || '';
  const [data, setData] = useState(null);
  const [shiftId, setShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [action, setAction] = useState('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;
    api.get('/api/shifts/day?roster=1').then(rows => { if (active) setEmployees(rows); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null); setPreview(null); setReason(''); setError('');
    if (employeeId) api.get(`/api/shifts/day?userId=${employeeId}&date=${date}`)
      .then(result => {
        if (!active) return;
        setData(result); setShiftId(result.override?.status === 'active' ? result.override.shiftId : '');
      }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [employeeId, date, reload]);

  const check = async nextAction => {
    setBusy(true); setError(''); setPreview(null); setMessage(''); setAction(nextAction);
    try { setPreview(await api.post('/api/shifts/day', { userIds: employeeIds, date, shiftId, action: nextAction, preview: true })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(''); setToast(null);
    try {
      const saved = await api.post('/api/shifts/day', { userIds: employeeIds, date, shiftId, action, reason,
        previews: preview.results.map(({ userId, revision, previewToken }) => ({ userId, revision, previewToken })) });
      const payrollMessage = saved.payrollsUpdated ? ` ${saved.payrollsUpdated} payroll record(s) recalculated as drafts for review.` : '';
      if (saved.payrollsUpdated > 0) setToast({ type: 'success', message: `Payroll rerun completed — ${saved.payrollsUpdated} record(s) recalculated as drafts for review.` });
      setMessage((action === 'cancel' ? `Overrides cancelled for ${employeeIds.length} employee(s). Normal schedules apply.` : `Shift saved for ${employeeIds.length} employee(s) for ${date} only.`) + payrollMessage);
      setPreview(null); setReload(value => value + 1);
      onSaved?.();
    } catch (e) {
      const reason = e.message || 'An unexpected error occurred.';
      setError(reason); setPreview(null);
      setToast({ type: 'error', message: `Shift change / payroll rerun failed: ${reason}` });
    }
    finally { setBusy(false); }
  };
  const timing = schedule => schedule ? `${schedule.name}: ${schedule.startTime}–${schedule.endTime}${schedule.endTime <= schedule.startTime ? ' (ends next day)' : ''}` : 'No shift assigned';
  const visibleEmployees = employees.filter(employee => `${employee.name} ${employee.department || ''}`.toLowerCase().includes(search.toLowerCase()));
  const selectEmployees = ids => {
    if (ids.length > 50) { setError('Select up to 50 employees at a time.'); return; }
    setEmployeeIds(ids); setPreview(null); setMessage(''); setError('');
  };
  return (
    <section className="card p-3 my-3" aria-label="Shift for selected day">
      {toast && createPortal(<div className="toast-container-custom" role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
        <div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'error' ? 'bi-exclamation-circle' : 'bi-check-circle'}`} aria-hidden="true" />{toast.message}</div>
      </div>, document.body)}
      <h6>Shift for {date}</h6>
      <p className="text-muted small">Replace the shift for this date only. The normal assignment resumes afterwards.</p>
      {error && <div role="alert" className="alert alert-danger py-2">{error}</div>}
      {message && <div role="status" className="alert alert-success py-2">{message}</div>}
      <fieldset disabled={busy} className="mb-3">
        <legend className="form-label fs-6">Employees · {employeeIds.length} selected (maximum 50)</legend>
        <input className="form-control mb-2" aria-label="Search employees by name or department" placeholder="Search name or department" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="d-flex gap-2 mb-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => selectEmployees([...new Set([...employeeIds, ...visibleEmployees.map(e => e._id)])])}>Select all matching</button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => selectEmployees([])}>Clear selection</button>
        </div>
        <div className="border rounded p-2" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {visibleEmployees.map(employee => <label key={employee._id} className="d-flex align-items-center gap-2 py-1">
            <input type="checkbox" className="form-check-input m-0" checked={employeeIds.includes(employee._id)} onChange={e => selectEmployees(e.target.checked ? [...employeeIds, employee._id] : employeeIds.filter(id => id !== employee._id))} />
            <span>{employee.name} · {employee.department}</span>
          </label>)}
          {!visibleEmployees.length && <span className="text-muted small">No matching employees.</span>}
        </div>
      </fieldset>
      {data && <>
        {date < data.today && <p className="small text-muted">Past-date changes recalculate completed attendance and rerun existing payroll for the affected period as drafts. Permission requests and pending attendance corrections must be reconciled first.</p>}
        {employeeIds.length === 1 && <p className="small mb-2"><strong>{data.override?.status === 'active' ? 'Day override' : 'Normal schedule'}:</strong> {timing(data.schedule)}</p>}
        {!data.editable ? <p className="text-muted small mb-0">Today may have active attendance. Choose a completed past date or a future date.</p> : <>
          <label className="form-label">Replacement shift or mini shift
            <select className="form-select" value={shiftId} disabled={busy} onChange={e => { setShiftId(e.target.value); setPreview(null); }}>
              <option value="">Choose shift</option>
              {data.shifts.map(shift => <option key={shift._id} value={shift._id}>{shift.parentShiftId ? 'Mini shift · ' : ''}{shift.name} ({shift.startTime}–{shift.endTime})</option>)}
            </select>
          </label>
          <label className="form-label">Reason
            <textarea className="form-control" value={reason} disabled={busy} maxLength={500} onChange={e => setReason(e.target.value)} />
          </label>
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-outline-primary btn-sm" disabled={busy || !shiftId} onClick={() => check('replace')}>Preview change</button>
            {(employeeIds.length > 1 || data.override?.status === 'active') && <button className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => check('cancel')}>Preview cancellation</button>}
          </div>
          {preview && <div className="alert alert-info mt-3 mb-0">
            <p className="small">All selected employees must pass validation. If any employee is blocked, resolve the issue or deselect them and preview again. The group is saved together.</p>
            {preview.results.map(row => <div key={row.userId} className="border-top pt-2 mb-2">
              <strong>{row.name || employees.find(employee => employee._id === row.userId)?.name || row.userId}</strong>
              {row.error ? <p role="alert" className="text-danger small mb-1">{row.error}</p> : <>
            <p className="small mb-1">{timing(row.schedule)}</p>
            <p className="small my-2">{row.date} · {row.timezone} · Expected work: {row.schedule?.expectedHours || 0} minutes. Applies to this day only.</p>
            {!!row.payrolls?.length && <p className="small fw-semibold">Payroll {row.payrolls.map(payroll => `${payroll.month} (${payroll.status})`).join(', ')} will be recalculated and returned to draft for review.</p>}
            {row.attendance && <div className="small mb-2">
              <p>Recorded clock times and leave balances are preserved. Attendance will be recalculated:</p>
              <table className="table table-sm"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>
                {['status', 'hoursWorked', 'payableHours', 'breakDeduction', 'shortfallMins', 'shortHours'].map(field =>
                  <tr key={field}><td>{({ status: 'Status', hoursWorked: 'Worked minutes', payableHours: 'Credited minutes', breakDeduction: 'Break deduction (minutes)', shortfallMins: 'Early departure (minutes)', shortHours: 'Short hours' })[field]}</td><td>{String(row.attendance.before[field] ?? '—')}</td><td>{String(row.attendance.after[field] ?? '—')}</td></tr>)}
              </tbody></table>
            </div>}
              </>}
            </div>)}
            <button className="btn btn-primary btn-sm" disabled={busy || !preview.canApply || reason.trim().length < 5} onClick={save}>{busy ? 'Saving…' : action === 'cancel' ? `Cancel for ${employeeIds.length} employee(s)` : `Apply to ${employeeIds.length} employee(s)`}</button>
          </div>}
        </>}
      </>}
    </section>
  );
}
