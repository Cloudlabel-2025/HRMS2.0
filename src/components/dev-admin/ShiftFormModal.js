'use client';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function minutesToHrMin(totalMins) {
  const m = Number(totalMins) || 0;
  return { hours: Math.floor(m / 60), minutes: m % 60 };
}

export function hrMinToMinutes(hours, minutes) {
  return (Number(hours) || 0) * 60 + (Number(minutes) || 0);
}

export const DEFAULT_SHIFT_FORM = {
  name: '',
  startTime: '',
  endTime: '',
  absentThreshold: 240,
  lateThreshold: 15,
  earlyLoginWindow: 120,
  autoLogoutAfterShiftEnd: 360,
  halfDayThreshold: 180,
  breaks: [
    { name: 'Break', type: 'break', maxDuration: 30, maxCount: 1 },
    { name: 'Lunch', type: 'lunch', maxDuration: 60, maxCount: 1 },
  ],
};

export function validateShiftForm(form) {
  const errs = {};
  if (!form.startTime) errs.startTime = 'Start time is required';
  else if (!TIME_RE.test(form.startTime)) errs.startTime = 'Start time must be in HH:MM (24-hour) format';
  if (!form.endTime) errs.endTime = 'End time is required';
  else if (!TIME_RE.test(form.endTime)) errs.endTime = 'End time must be in HH:MM (24-hour) format';
  return errs;
}

export default function ShiftFormModal({ form, setForm, errors, setErrors, saving, onSave, onClose }) {
  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 720 }}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{form._id ? 'Edit' : 'Add'} Shift</h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Shift Name *</label>
                <input className="form-control form-control-sm" value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="col-md-3">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Start Time</label>
                <input type="time" className={`form-control form-control-sm${errors.startTime ? ' is-invalid' : ''}`} value={form.startTime || ''} onChange={e => { setForm(p => ({ ...p, startTime: e.target.value })); setErrors(p => ({ ...p, startTime: '' })); }} />
                {errors.startTime && <div className="invalid-feedback d-block" style={{ fontSize: 12 }}>{errors.startTime}</div>}
              </div>
              <div className="col-md-3">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>End Time</label>
                <input type="time" className={`form-control form-control-sm${errors.endTime ? ' is-invalid' : ''}`} value={form.endTime || ''} onChange={e => { setForm(p => ({ ...p, endTime: e.target.value })); setErrors(p => ({ ...p, endTime: '' })); }} />
                {errors.endTime && <div className="invalid-feedback d-block" style={{ fontSize: 12 }}>{errors.endTime}</div>}
              </div>

              <div className="col-12" style={{ marginTop: 8, marginBottom: -4, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Work Hours Policy</span>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Shift Length <span className="text-muted" style={{ fontSize: 10 }}>(from start–end)</span></label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 38 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>{(() => { const s = String(form.startTime || ''); const e = String(form.endTime || ''); if (!/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(e)) return '—'; const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number); let d = (eh * 60 + em) - (sh * 60 + sm); if (d <= 0) d += 1440; return `${Math.floor(d / 60)}h ${d % 60}m`; })()}</span>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Absent Threshold <span className="text-muted" style={{ fontSize: 10 }}>(below = absent)</span></label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" max="23" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.absentThreshold ?? 240).hours}
                    onChange={e => { const cur = minutesToHrMin(form.absentThreshold ?? 240); setForm(p => ({ ...p, absentThreshold: hrMinToMinutes(Number(e.target.value), cur.minutes) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>h</span>
                  <input type="number" min="0" max="59" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.absentThreshold ?? 240).minutes}
                    onChange={e => { const cur = minutesToHrMin(form.absentThreshold ?? 240); setForm(p => ({ ...p, absentThreshold: hrMinToMinutes(cur.hours, Number(e.target.value)) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>m</span>
                </div>
              </div>

              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Half Day Threshold <span className="text-muted" style={{ fontSize: 10 }}>(below = half-day)</span></label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" max="23" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.halfDayThreshold ?? 180).hours}
                    onChange={e => { const cur = minutesToHrMin(form.halfDayThreshold ?? 180); setForm(p => ({ ...p, halfDayThreshold: hrMinToMinutes(Number(e.target.value), cur.minutes) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>h</span>
                  <input type="number" min="0" max="59" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.halfDayThreshold ?? 180).minutes}
                    onChange={e => { const cur = minutesToHrMin(form.halfDayThreshold ?? 180); setForm(p => ({ ...p, halfDayThreshold: hrMinToMinutes(cur.hours, Number(e.target.value)) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>m</span>
                </div>
              </div>
              <div className="col-12" style={{ marginTop: 8, marginBottom: -4, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Attendance Rules</span>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Late After</label>
                <span className="text-muted" style={{ fontSize: 10, display: 'block', marginTop: 2, marginBottom: 4 }}>from shift start</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" max="23" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.lateThreshold ?? 15).hours}
                    onChange={e => { const cur = minutesToHrMin(form.lateThreshold ?? 15); setForm(p => ({ ...p, lateThreshold: hrMinToMinutes(Number(e.target.value), cur.minutes) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>h</span>
                  <input type="number" min="0" max="59" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.lateThreshold ?? 15).minutes}
                    onChange={e => { const cur = minutesToHrMin(form.lateThreshold ?? 15); setForm(p => ({ ...p, lateThreshold: hrMinToMinutes(cur.hours, Number(e.target.value)) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>m</span>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Early Login Window <span className="text-muted" style={{ fontSize: 10 }}>(before start)</span></label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" max="23" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.earlyLoginWindow ?? 120).hours}
                    onChange={e => { const cur = minutesToHrMin(form.earlyLoginWindow ?? 120); setForm(p => ({ ...p, earlyLoginWindow: hrMinToMinutes(Number(e.target.value), cur.minutes) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>h</span>
                  <input type="number" min="0" max="59" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.earlyLoginWindow ?? 120).minutes}
                    onChange={e => { const cur = minutesToHrMin(form.earlyLoginWindow ?? 120); setForm(p => ({ ...p, earlyLoginWindow: hrMinToMinutes(cur.hours, Number(e.target.value)) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>m</span>
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold" style={{ fontSize: 13 }}>Auto-Logout After Shift End</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="number" min="0" max="23" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.autoLogoutAfterShiftEnd ?? 360).hours}
                    onChange={e => { const cur = minutesToHrMin(form.autoLogoutAfterShiftEnd ?? 360); setForm(p => ({ ...p, autoLogoutAfterShiftEnd: hrMinToMinutes(Number(e.target.value), cur.minutes) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>h</span>
                  <input type="number" min="0" max="59" className="form-control form-control-sm" style={{ fontSize: 14, width: 64, height: 38, textAlign: 'center', padding: '0 8px' }}
                    value={minutesToHrMin(form.autoLogoutAfterShiftEnd ?? 360).minutes}
                    onChange={e => { const cur = minutesToHrMin(form.autoLogoutAfterShiftEnd ?? 360); setForm(p => ({ ...p, autoLogoutAfterShiftEnd: hrMinToMinutes(cur.hours, Number(e.target.value)) })); }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>m</span>
                </div>
              </div>

              <div className="col-12" style={{ marginTop: 8, marginBottom: -4, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Break Configuration</span>
              </div>
              <div className="col-12">
                {(form.breaks || []).map((br, idx) => (
                  <div key={idx} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                        <input className="form-control form-control-sm" style={{ fontSize: 13, fontWeight: 600, maxWidth: 160 }}
                          value={br.name || ''} placeholder="Break name"
                          onChange={e => { const breaks = [...(form.breaks || [])]; breaks[idx] = { ...breaks[idx], name: e.target.value }; setForm({ ...form, breaks }); }} />
                        <input className="form-control form-control-sm" style={{ fontSize: 12, maxWidth: 120 }}
                          value={br.type || ''} placeholder="Type (e.g. tea, snack)"
                          onChange={e => { const breaks = [...(form.breaks || [])]; breaks[idx] = { ...breaks[idx], type: e.target.value }; setForm({ ...form, breaks }); }} />
                      </div>
                      <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 12, padding: '4px 8px' }}
                        onClick={() => { const breaks = [...(form.breaks || [])]; breaks.splice(idx, 1); setForm({ ...form, breaks }); }}>
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Max Duration</span>
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          {(() => { const { hours: bh, minutes: bm } = minutesToHrMin(br.maxDuration || 0); return (
                            <>
                              <input type="number" min="0" max="23" className="form-control form-control-sm"
                                style={{ fontSize: 13, width: 52, height: 34, textAlign: 'center', padding: '0 6px' }}
                                value={bh} onChange={e => { const breaks = [...(form.breaks || [])]; breaks[idx] = { ...breaks[idx], maxDuration: hrMinToMinutes(e.target.value, bm) }; setForm({ ...form, breaks }); }} />
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>h</span>
                              <input type="number" min="0" max="59" className="form-control form-control-sm"
                                style={{ fontSize: 13, width: 52, height: 34, textAlign: 'center', padding: '0 6px' }}
                                value={bm} onChange={e => { const breaks = [...(form.breaks || [])]; breaks[idx] = { ...breaks[idx], maxDuration: hrMinToMinutes(bh, e.target.value) }; setForm({ ...form, breaks }); }} />
                              <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>m</span>
                            </>
                          ); })()}
                        </div>
                      </div>
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Max Count</span>
                        <input type="number" min="1" className="form-control form-control-sm"
                          style={{ fontSize: 13, width: 52, height: 34, textAlign: 'center', padding: '0 6px' }}
                          value={br.maxCount ?? 1} onChange={e => { const breaks = [...(form.breaks || [])]; breaks[idx] = { ...breaks[idx], maxCount: parseInt(e.target.value, 10) || 1 }; setForm({ ...form, breaks }); }} />
                      </div>
                    </div>
                  </div>
                ))}
                <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 12, padding: '8px 16px', borderRadius: 8, marginTop: 4 }}
                  onClick={() => setForm({ ...form, breaks: [...(form.breaks || []), { name: '', type: '', maxDuration: 0, maxCount: 1 }] })}>
                  <i className="bi bi-plus-lg me-1" />Add Break
                </button>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
