'use client';

const ICONS = {
  missing: { icon: 'bi-exclamation-triangle', bg: '#fef3c7', color: '#d97706' },
  finalize: { icon: 'bi-shield-exclamation', bg: '#fee2e2', color: '#dc2626' },
  result: { icon: 'bi-check-circle', bg: '#dcfce7', color: '#16a34a' },
};

export default function PayrollAlertModal({
  open,
  mode = 'missing', // 'missing' | 'finalize' | 'result'
  month = '',
  cycleLabel = '',
  payrollEndDay = '',
  missing = [],
  result = null,
  confirming = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null;
  const danger = mode === 'finalize';
  const { icon, bg, color } = ICONS[mode] || ICONS.missing;

  const titles = {
    missing: 'Employees Without Salary Structure',
    finalize: 'Finalize Payroll Early?',
    result: 'Payroll Run Complete',
  };
  const confirms = {
    missing: 'Continue Any Way',
    finalize: 'Finalize Anyway',
    result: 'Done',
  };

  return (
    <div className="modal show d-block" role="dialog" aria-modal="true" style={{ background: 'rgba(15,23,42,0.55)', zIndex: 1060 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: mode === 'result' ? 520 : 480, animation: 'dropIn 0.2s cubic-bezier(0.4,0,0.2,1)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 16, border: 'none', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className={`bi ${icon}`} style={{ color, fontSize: 17 }} />
              </div>
              <h5 className="modal-title" style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{titles[mode]}</h5>
            </div>
            <button className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <div className="modal-body">
            {mode === 'missing' && (
              <>
                <p style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
                  <strong style={{ color }}>{missing.length} active employee(s)</strong> have no salary structure and will be skipped for <strong>{month}</strong>. They will not appear in this payroll run.
                </p>
                <div style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: 10, maxHeight: 260, overflowY: 'auto' }}>
                  {missing.slice(0, 8).map(e => (
                    <div key={e.userId || e.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 4px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{e.name}</span>
                      <span style={{ color: '#94a3b8' }}>{e.department || '—'}</span>
                    </div>
                  ))}
                  {missing.length > 8 && <div style={{ fontSize: 12, color: '#94a3b8', padding: '6px 4px' }}>…and {missing.length - 8} more</div>}
                </div>
                <p style={{ fontSize: 12, color: '#ef4444', marginTop: 10, marginBottom: 0 }}>
                  <i className="bi bi-info-circle me-1" />Add structures in the Structures tab to include them, or continue to skip them this run.
                </p>
              </>
            )}
            {mode === 'finalize' && (
              <>
                <p style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
                  The payroll cycle for <strong>{month}</strong>{cycleLabel ? ` (${cycleLabel})` : ''} has <strong>not ended yet</strong>
                  {payrollEndDay ? <> (ends <strong>{payrollEndDay}</strong>)</> : null}. Finalizing now will <strong style={{ color: '#dc2626' }}>lock salary payouts mid-cycle</strong>.
                </p>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#991b1b' }}>
                  <i className="bi bi-exclamation-triangle me-2" />
                  Finalized payrolls cannot be re-run. Reopening requires an admin action with audit trail.
                </div>
              </>
            )}
            {mode === 'result' && result && (
              <>
                <div className="row g-2 mb-3">
                  {[
                    ['Processed', result.processed ?? '—', '#10b981'],
                    ['Skipped', (result.skipped || []).length, (result.skipped || []).length ? '#f59e0b' : '#64748b'],
                    ['Working Days', result.workingDays ?? '—', '#3b82f6'],
                  ].map(([label, value, c]) => (
                    <div key={label} className="col-4">
                      <div style={{ background: '#f8fafc', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{value}</div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {result.isMidCycle && (
                  <p style={{ fontSize: 12, color: '#1d4ed8', background: '#eff6ff', borderRadius: 8, padding: '8px 10px' }}>
                    <i className="bi bi-info-circle me-1" />Cycle in progress — this is a draft preview. Future dates are not counted as LOP yet.
                  </p>
                )}
                {(result.skipped || []).length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 10, maxHeight: 200, overflowY: 'auto' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>Skipped (no salary structure)</div>
                    {result.skipped.slice(0, 8).map(s => (
                      <div key={String(s.userId)} style={{ fontSize: 12, color: '#78350f', padding: '3px 0' }}>{s.name || String(s.userId)} — {s.reason}</div>
                    ))}
                    {result.skipped.length > 8 && <div style={{ fontSize: 12, color: '#92400e' }}>…and {result.skipped.length - 8} more</div>}
                  </div>
                )}
                {result.runId && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Run ID: {result.runId}</div>}
              </>
            )}
          </div>
          <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9' }}>
            {mode === 'result' ? (
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            ) : (
              <>
                <button className="btn btn-outline-secondary" onClick={onClose} disabled={confirming}>Cancel</button>
                <button className={`btn btn-${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={confirming}>
                  {confirming ? <><span className="spinner-border spinner-border-sm me-2" />Processing...</> : confirms[mode]}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
