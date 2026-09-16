'use client';
import { useState, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const isAdminRole = (r) => ['super_admin', 'admin_full'].includes(r);

const BULK_MAX_SIZE = 3 * 1024 * 1024;
const BULK_EXTS = ['xlsx', 'xls', 'csv'];

function formatBytes(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb > 1024) return (bytes / 1048576).toFixed(1) + ' MB';
  return kb.toFixed(1) + ' KB';
}

export default function LeaveBulkPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('balance');
  const [file, setFile] = useState(null);
  const [balanceMode, setBalanceMode] = useState('delta');
  const [leaveMode, setLeaveMode] = useState('approved');
  const [skipEligibility, setSkipEligibility] = useState(false);
  const [preview, setPreview] = useState(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [result, setResult] = useState(null);
  const [showModeHelp, setShowModeHelp] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const fileInputRef = useRef(null);

  const acceptFile = (f) => {
    if (!f) return;
    const ext = String(f.name || '').split('.').pop().toLowerCase();
    if (!BULK_EXTS.includes(ext)) { showToast('Only .xlsx, .xls or .csv files are accepted', 'error'); return; }
    if (f.size === 0) { showToast('File is empty', 'error'); return; }
    if (f.size > BULK_MAX_SIZE) { showToast('File exceeds 3 MB limit (' + formatBytes(f.size) + ')', 'error'); return; }
    setFile(f);
    setPreview(null);
    setResult(null);
  };

  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (user && !isAdminRole(user.role)) {
    return (
      <AppShell title="Bulk Leave Import">
        <div className="alert alert-danger">Only Super Admin / Admin (Full) can use bulk import.</div>
      </AppShell>
    );
  }

  const downloadTemplate = async () => {
    try {
      const res = await fetch(`/api/leave/bulk/template?type=${tab}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Template download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leave-${tab}-template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleValidate = async () => {
    if (!file) { showToast('Select an Excel/CSV file first', 'error'); return; }
    setBusy(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', tab);
      if (tab === 'leaves' && skipEligibility) fd.append('skipEligibility', '1');
      const data = await api.post('/api/leave/bulk/validate', fd);
      setPreview(data);
      setErrorsOnly(data.invalid > 0);
      showToast(`${data.valid} valid, ${data.invalid} invalid of ${data.total}`);
    } catch (e) {
      showToast(e.message, 'error');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter(r => r.errors.length === 0).map(r => ({ rowNum: r.rowNum, data: r.data }));
    if (!validRows.length) { showToast('No valid rows to import', 'error'); return; }
    setShowConfirm(false);
    setBusy(true);
    try {
      const data = await api.post('/api/leave/bulk/commit', {
        type: tab,
        mode: tab === 'balance' ? balanceMode : leaveMode,
        rows: validRows,
        cloudinary: preview.cloudinary || null,
        fileName: file?.name || null,
      });
      setResult(data);
      if (data.failed > 0) showToast(`${data.committed} imported, ${data.failed} failed`, 'error');
      else showToast(`${data.committed} rows imported`);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = () => {
    if (!preview) return;
    const bad = preview.rows.filter(r => r.errors.length > 0);
    if (!bad.length) return;
    const header = 'rowNum,employeeEmail,employeeCode,errors\n';
    const lines = bad.map(r => {
      const d = r.data || {};
      const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      return `${r.rowNum},${q(d.employeeEmail)},${q(d.employeeCode)},${q(r.errors.join(' | '))}`;
    });
    const blob = new Blob([header + lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leave-${tab}-errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleRows = preview
    ? (errorsOnly ? preview.rows.filter(r => r.errors.length > 0) : preview.rows)
    : [];

  return (
    <AppShell title="Bulk Leave Import">
      {toast && (
        <div className="toast-container-custom">
          <div className="toast-custom">
            <i className="bi bi-info-circle me-2" />{toast.msg}
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h4>Bulk Leave Import</h4>
          <p>Upload balances or leave history from Excel. Employees are matched by Email or Employee Code.</p>
        </div>
        <button className="btn btn-outline-secondary" onClick={() => { window.location.href = '/leave'; }}>
          <i className="bi bi-arrow-left me-1" /> Back to Leaves
        </button>
      </div>

      <div className="bulk-head-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 4, background: '#f1f4f9', borderRadius: 14, padding: 4, width: 'fit-content' }}>
          {[{ key: 'balance', label: 'Leave Balance' }, { key: 'leaves', label: 'Leave History' }].map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setPreview(null); setResult(null); clearFile(); }}
              style={{ padding: '8px 20px', borderRadius: 10, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#0f172a' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.2s' }}>
              {t.label}
            </button>
          ))}
        </div>
        <button className="btn btn-outline-primary btn-sm" onClick={downloadTemplate} style={{ borderRadius: 10, minHeight: 40, padding: '8px 18px', fontSize: 13 }}>
          <i className="bi bi-download me-2" />{tab === 'balance' ? 'Balance' : 'History'} template (.xlsx)
        </button>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-lg-7">
          <div className="card h-100" style={{ borderRadius: 14 }}>
            <div className="card-body">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 4 }}>Source file</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>Matched by Email or Employee Code · .xlsx · .xls · .csv · 500 rows · 3 MB</div>
              <div className="bulk-file-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-outline-secondary btn-sm" style={{ borderRadius: 10, minHeight: 36, padding: '6px 14px', fontSize: 13, flexShrink: 0 }} onClick={() => fileInputRef.current?.click()}>
                  <i className="bi bi-folder2-open me-2" />Choose file
                </button>
                {file ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 32, maxWidth: '100%', padding: '4px 6px 4px 10px', border: '1px solid #e2e8f0', borderRadius: 999, background: '#f1f4f9', fontSize: 12 }}>
                    <i className="bi bi-file-earmark-spreadsheet" style={{ color: '#3b82f6', fontSize: 14, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: '#0f172a', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                    <span style={{ color: '#94a3b8', flexShrink: 0 }}>{formatBytes(file.size)}</span>
                    <button className="btn btn-sm btn-outline-secondary" style={{ width: 24, height: 24, minHeight: 24, padding: 0, borderRadius: 999, fontSize: 12, lineHeight: 1 }} onClick={clearFile} title="Remove file">
                      <i className="bi bi-x" />
                    </button>
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>No file chosen</span>
                )}
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => acceptFile(e.target.files?.[0])} />
              </div>
              {preview?.cloudinary?.url && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12 }}>
                  <i className="bi bi-cloud-check" style={{ color: '#16a34a' }} />
                  <span style={{ color: '#15803d', fontWeight: 600 }}>Archived to Cloudinary</span>
                  <a href={preview.cloudinary.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto' }}>View file</a>
                </div>
              )}
              {preview && !preview.cloudinary?.url && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
                  <i className="bi bi-exclamation-triangle" />
                  <span>{preview.cloudinaryError ? 'Cloudinary archive failed: ' + preview.cloudinaryError : 'File was not archived to Cloudinary.'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-12 col-lg-5">
          <div className="card h-100" style={{ borderRadius: 14 }}>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Options</div>
                  <button className="btn btn-link btn-sm p-0" style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none' }} onClick={() => setShowModeHelp(true)}>
                    <i className="bi bi-info-circle me-1" />How this works
                  </button>
                </div>
                {tab === 'balance' ? (
                  <select className="form-select w-100" style={{ fontSize: 13, borderRadius: 10, minHeight: 40 }} value={balanceMode} onChange={e => setBalanceMode(e.target.value)}>
                    <option value="delta">Add (delta correction)</option>
                    <option value="overwrite">Overwrite (opening balance)</option>
                  </select>
                ) : (
                  <>
                    <select className="form-select w-100" style={{ fontSize: 13, borderRadius: 10, minHeight: 40 }} value={leaveMode} onChange={e => setLeaveMode(e.target.value)}>
                      <option value="approved">Approved (deduct + attendance)</option>
                      <option value="pending">Pending (goes to approvals)</option>
                    </select>
                    <label className="mt-2" style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Skip eligibility checks for migration">
                      <input type="checkbox" className="form-check-input m-0" checked={skipEligibility} onChange={e => setSkipEligibility(e.target.checked)} />
                      Skip eligibility
                    </label>
                  </>
                )}
              </div>
              <button className="btn btn-primary w-100" style={{ borderRadius: 10, minHeight: 42 }} disabled={busy || !file} onClick={handleValidate}>
                {busy ? <><span className="spinner-border spinner-border-sm me-2" />Checking…</> : <><i className="bi bi-search me-2" />Check file</>}
              </button>
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: -6 }}>Nothing is saved until Confirm Import</div>
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <div className="card mb-3" style={{ borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Preview</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                <span style={{ fontWeight: 700, color: '#16a34a' }}>{preview.valid} valid</span>
                <span style={{ color: '#cbd5e1', margin: '0 6px' }}>·</span>
                <span style={{ fontWeight: 700, color: '#dc2626' }}>{preview.invalid} invalid</span>
                <span style={{ color: '#cbd5e1', margin: '0 6px' }}>·</span>
                {preview.total} rows
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="m-0" style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}><input type="checkbox" className="form-check-input m-0" checked={errorsOnly} onChange={e => setErrorsOnly(e.target.checked)} />Errors only</label>
              {preview.invalid > 0 && <button className="btn btn-sm btn-outline-secondary" style={{ borderRadius: 8 }} onClick={downloadErrors}><i className="bi bi-download me-1" />Error CSV</button>}
              <button className="btn btn-sm btn-success" style={{ borderRadius: 8 }} disabled={busy || preview.valid === 0} onClick={() => setShowConfirm(true)}>
                <i className="bi bi-check-lg me-1" />Confirm Import ({preview.valid})
              </button>
            </div>
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="table-responsive" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="table table-sm mb-0">
                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc' }}>
                  <tr>
                    <th>Row</th><th>Employee</th>
                    {tab === 'balance'
                      ? <><th>Type</th><th>Alloc</th><th>Used</th><th>Pend</th><th>C/F</th><th>Year</th></>
                      : <><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th></>}
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(r => (
                    <tr key={r.rowNum} style={r.errors.length ? { background: '#fef2f2' } : {}}>
                      <td>{r.rowNum}</td>
                      <td style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600 }}>{r.user?.name || r.data.employeeEmail || r.data.employeeCode || '—'}</div>
                        <div style={{ color: '#94a3b8' }}>{r.data.employeeEmail}{r.data.employeeCode ? ` · ${r.data.employeeCode}` : ''}</div>
                        {r.policyName && <div style={{ color: '#64748b' }}>{r.policyName}</div>}
                      </td>
                      {tab === 'balance' ? (
                        <>
                          <td><span className="badge" style={{ background: '#f1f5f9', color: '#1e293b' }}>{r.data.typeCode}</span></td>
                          <td>{r.data.allocated}</td><td>{r.data.used}</td><td>{r.data.pending}</td><td>{r.data.carriedForward}</td><td>{r.data.cycleYear}</td>
                        </>
                      ) : (
                        <>
                          <td><span className="badge" style={{ background: '#f1f5f9', color: '#1e293b' }}>{r.data.typeCode}</span></td>
                          <td style={{ fontSize: 12 }}>{r.data.from}</td>
                          <td style={{ fontSize: 12 }}>{r.data.to}</td>
                          <td>{r.computedDays ?? '—'}</td>
                          <td style={{ fontSize: 12 }}>{leaveMode}</td>
                        </>
                      )}
                      <td style={{ fontSize: 12, maxWidth: 320 }}>
                        {r.errors.length === 0
                          ? <span className="badge" style={{ background: '#dcfce7', color: '#16a34a' }}>OK</span>
                          : r.errors.map((e, i) => <div key={i} className="text-danger">• {e}</div>)}
                        {r.warnings.map((w, i) => <div key={`w${i}`} className="text-warning">• {w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="modal show d-block" style={{ background: 'rgba(15,23,42,0.55)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: 16, border: 'none', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', padding: '20px 24px' }}>
                <h5 className="modal-title" style={{ fontWeight: 700, fontSize: 17 }}>
                  <i className={result.failed > 0 ? 'bi bi-exclamation-triangle me-2' : 'bi bi-check-circle me-2'} style={{ color: result.failed > 0 ? '#d97706' : '#16a34a' }} />
                  Import finished
                </h5>
                <button className="btn-close" onClick={() => setResult(null)} />
              </div>
              <div className="modal-body" style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span className="badge" style={{ background: '#dcfce7', color: '#16a34a' }}>{result.committed} succeeded</span>
                  <span className="badge" style={{ background: result.failed > 0 ? '#fef3c7' : '#f1f5f9', color: result.failed > 0 ? '#d97706' : '#64748b' }}>{result.failed} failed</span>
                </div>
                {result.archive?.url && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12 }}>
                    <i className="bi bi-cloud-check" style={{ color: '#16a34a' }} />
                    <span style={{ color: '#475569' }}>Source file archived in Documents (HR)</span>
                    <a href={result.archive.url} download={file?.name || 'bulk-leave-' + tab + '-archive.xlsx'} style={{ marginLeft: 'auto', color: '#3b82f6', fontWeight: 600 }}><i className="bi bi-download me-1" />Download file</a>
                  </div>
                )}
                {result.errors?.length > 0 ? (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                    {result.errors.slice(0, 20).map((e, i) => <div key={i} className="text-danger" style={{ marginBottom: 4 }}>Row {e.rowNum}: {e.error}</div>)}
                    {result.errors.length > 20 && <div style={{ color: '#94a3b8' }}>…and {result.errors.length - 20} more</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: '#64748b' }}>All rows imported successfully.</div>
                )}
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
                {preview && preview.invalid > 0 && (
                  <button className="btn btn-outline-secondary" onClick={downloadErrors}>
                    <i className="bi bi-download me-1" />Download error rows
                  </button>
                )}
                <button className="btn btn-primary" onClick={() => setResult(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirm && preview && (
        <div className="modal show d-block" style={{ background: 'rgba(15,23,42,0.55)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: 16, border: 'none', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', padding: '20px 24px' }}>
                <h5 className="modal-title" style={{ fontWeight: 700, fontSize: 17 }}>
                  <i className="bi bi-question-circle me-2" style={{ color: '#3b82f6' }} />
                  Confirm Import
                </h5>
                <button className="btn-close" onClick={() => setShowConfirm(false)} disabled={busy} />
              </div>
              <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 14, color: '#0f172a' }}>
                  Import <b>{preview.valid} valid row(s)</b> as <b>{tab === 'balance' ? balanceMode : leaveMode}</b>? Invalid rows will be skipped.
                </div>
                {tab === 'balance' ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {balanceMode === 'delta'
                      ? 'Add mode: your numbers will be added to the current balances.'
                      : 'Overwrite mode: balances will be replaced with your exact numbers.'}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {leaveMode === 'approved'
                      ? 'Approved mode: deducts paid days and creates attendance entries.'
                      : 'Pending mode: requests go to manager approvals.'}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, color: '#475569' }}>
                  <i className="bi bi-list-check" style={{ color: '#3b82f6' }} />
                  <span>Validated: {preview.valid} valid · {preview.invalid} invalid of {preview.total}</span>
                  {preview.cloudinary?.url && <a href={preview.cloudinary.url} download={file?.name || 'bulk-leave-' + tab + '.xlsx'} style={{ marginLeft: 'auto', color: '#3b82f6', fontWeight: 600 }}><i className="bi bi-download me-1" />Download file</a>}
                </div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
                <button className="btn btn-outline-secondary" onClick={() => setShowConfirm(false)} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" style={{ minHeight: 42 }} onClick={handleCommit} disabled={busy}>
                  {busy ? <><span className="spinner-border spinner-border-sm me-2" />Importing…</> : 'Confirm & Import (' + preview.valid + ')'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showModeHelp && (
        <div className="modal show d-block" style={{ background: 'rgba(15,23,42,0.55)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ borderRadius: 16, border: 'none', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', padding: '20px 24px' }}>
                <h5 className="modal-title" style={{ fontWeight: 700, fontSize: 17 }}>
                  <i className="bi bi-info-circle me-2" style={{ color: '#3b82f6' }} />
                  {tab === 'balance' ? 'How Balance import works' : 'How History import works'}
                </h5>
                <button className="btn-close" onClick={() => setShowModeHelp(false)} />
              </div>
              <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {tab === 'balance' ? (
                  <>
                    <div style={{ display: 'flex', gap: 10, fontSize: 13, color: '#334155' }}>
                      <i className="bi bi-plus-circle" style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
                      <span><b>Add (delta correction)</b> adds your numbers to the current balance — for example, allocated +2 for a mid-year correction.</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 13, color: '#334155' }}>
                      <i className="bi bi-arrow-repeat" style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
                      <span><b>Overwrite (opening balance)</b> replaces the balance with your exact numbers — for migration. Only use it when you mean to replace.</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 10, fontSize: 13, color: '#334155' }}>
                      <i className="bi bi-check-circle" style={{ color: '#16a34a', flexShrink: 0, marginTop: 2 }} />
                      <span><b>Approved</b> creates the leave record, deducts paid days from the balance, and creates attendance entries for those dates.</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 13, color: '#334155' }}>
                      <i className="bi bi-hourglass-split" style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
                      <span><b>Pending</b> creates requests that go to manager approvals. Overlapping dates with existing leaves are blocked.</span>
                    </div>
                  </>
                )}
                <div style={{ fontSize: 12, color: '#94a3b8', borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>Nothing is saved until you press Confirm Import.</div>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid #f1f5f9', padding: '16px 24px' }}>
                <button className="btn btn-outline-secondary" onClick={() => setShowModeHelp(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
