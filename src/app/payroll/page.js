'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';

const MONTHS = Array.from({ length: 6 }, (_, i) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
});

const fmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';

export default function PayrollPage() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [tab, setTab] = useState('register');
  const [month, setMonth] = useState(MONTHS[0]);
  const [payrolls, setPayrolls] = useState([]);
  const [structures, setStructures] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showSlip, setShowSlip] = useState(null);
  const [showStructureModal, setShowStructureModal] = useState(false);
  const [structureForm, setStructureForm] = useState({ userId: '', da: '', hra: '', ca: '', medical: '', bonus: '', epfo: '', esi: '', professionalTax: '', lop: '', loan: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const approvePayroll = async (action) => {
    try {
      const res = await api.post('/api/payroll/approve', { month, action });
      showToast(`Payroll ${action}d — ${res.updated} records updated`);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [p, s, e] = await Promise.all([
        api.get(`/api/payroll?month=${month}`),
        isAdmin ? api.get('/api/payroll/structure') : Promise.resolve([]),
        isAdmin ? api.get('/api/employees') : Promise.resolve([]),
      ]);
      setPayrolls(Array.isArray(p) ? p : []);
      setStructures(Array.isArray(s) ? s : []);
      setEmployees(Array.isArray(e) ? e : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user, month]);

  const runPayroll = async () => {
    // Warn if any active employees have no salary structure
    const activeEmps = employees.filter(e => e.status === 'active');
    const structuredIds = new Set(structures.map(s => s.userId?._id || s.userId));
    const missing = activeEmps.filter(e => !structuredIds.has(e.userId));
    if (missing.length > 0) {
      if (!confirm(`${missing.length} active employee(s) have no salary structure and will be skipped:\n${missing.slice(0, 5).map(e => e.name).join(', ')}${missing.length > 5 ? '...' : ''}\n\nContinue?`)) return;
    }
    setRunning(true);
    try {
      const res = await api.post('/api/payroll/run', { month });
      showToast(`Payroll processed for ${res.processed} employees`);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const printPayslip = (slip, empName) => {
    const w = window.open('', '_blank', 'width=800,height=700');
    const fmt = n => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
    w.document.write(`<!DOCTYPE html><html><head><title>Payslip - ${empName}</title><style>
      body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#1e293b;}
      h2{margin:0;}  .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:14px;}
      .gross{font-weight:700;color:#10b981;} .ded{color:#ef4444;} .net{font-size:18px;font-weight:800;color:#3b82f6;}
      .box{background:#f8fafc;border-radius:10px;padding:16px;margin:12px 0;}
      .header{display:flex;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e2e8f0;}
      @media print{body{margin:16px;}button{display:none;}}
    </style></head><body>
      <div class='header'><div><h2>HRMS Pro</h2><div style='font-size:12px;color:#64748b'>Enterprise HR Platform</div></div><div style='text-align:right'><div style='font-weight:700;font-size:16px'>PAYSLIP</div><div style='font-size:12px;color:#64748b'>${slip.month}</div></div></div>
      <div class='box'>
        <div class='row'><span style='color:#64748b'>Employee</span><span style='font-weight:600'>${empName}</span></div>
        <div class='row'><span style='color:#64748b'>Pay Period</span><span style='font-weight:600'>${slip.cycleLabel || slip.month}</span></div>
        <div class='row'><span style='color:#64748b'>Days Present</span><span>${slip.presentDays ?? '—'}</span></div>
        <div class='row'><span style='color:#64748b'>LOP Days</span><span>${slip.lopDays || 0}</span></div>
      </div>
      <div style='display:flex;gap:12px'>
        <div class='box' style='flex:1'>
          <div style='font-weight:700;font-size:13px;color:#10b981;margin-bottom:10px'>EARNINGS</div>
          <div class='row'><span style='color:#64748b'>DA</span><span>${fmt(slip.da)}</span></div>
          <div class='row'><span style='color:#64748b'>HRA</span><span>${fmt(slip.hra)}</span></div>
          <div class='row'><span style='color:#64748b'>CA</span><span>${fmt(slip.ca)}</span></div>
          <div class='row'><span style='color:#64748b'>Medical</span><span>${fmt(slip.medical)}</span></div>
          <div class='row'><span style='color:#64748b'>Bonus</span><span>${fmt(slip.bonus)}</span></div>
          <div class='row gross'><span>Gross Pay</span><span>${fmt(slip.grossPay)}</span></div>
        </div>
        <div class='box' style='flex:1'>
          <div style='font-weight:700;font-size:13px;color:#ef4444;margin-bottom:10px'>DEDUCTIONS</div>
          <div class='row ded'><span>EPFO</span><span>${fmt(slip.epfo)}</span></div>
          <div class='row ded'><span>ESI</span><span>${fmt(slip.esi)}</span></div>
          <div class='row ded'><span>Professional Tax</span><span>${fmt(slip.professionalTax)}</span></div>
          <div class='row ded'><span>Loan</span><span>${fmt(slip.loan)}</span></div>
          <div class='row ded'><span>Total Deductions</span><span>${fmt(slip.totalDeductions)}</span></div>
        </div>
      </div>
      <div class='box' style='margin-top:12px;display:flex;justify-content:space-between;align-items:center'>
        <span style='font-size:15px;font-weight:700'>NET PAY</span><span class='net'>${fmt(slip.netPay)}</span>
      </div>
      <div style='text-align:center;margin-top:24px'><button onclick='window.print()' style='background:#3b82f6;color:#fff;border:none;padding:10px 32px;border-radius:8px;font-size:14px;cursor:pointer'>Print / Save as PDF</button></div>
    </body></html>`);
    w.document.close();
  };

  const saveStructure = async () => {
    if (!structureForm.userId) return showToast('Employee is required', 'error');
    if (!structureForm.da || !structureForm.hra || !structureForm.ca || !structureForm.medical) return showToast('All earnings fields (DA, HRA, CA, Medical) are required', 'error');
    if (!structureForm.epfo || !structureForm.esi) return showToast('EPFO and ESI are required', 'error');
    setSaving(true);
    try {
      await api.post('/api/payroll/structure', {
        ...structureForm,
        da: +structureForm.da, hra: +structureForm.hra, ca: +structureForm.ca, medical: +structureForm.medical,
        bonus: +structureForm.bonus || 0,
        epfo: +structureForm.epfo, esi: +structureForm.esi,
        professionalTax: +structureForm.professionalTax || 0,
        lop: +structureForm.lop || 0, loan: +structureForm.loan || 0,
      });
      showToast('Salary structure saved');
      setShowStructureModal(false);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cycleReady = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const endDayRaw = settings.payrollEndDay;
    const endDay = endDayRaw
      ? (Number(endDayRaw) || Number(String(endDayRaw).split('-')[2]) || 25)
      : 25;
    const cycEnd = `${y}-${String(m).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    return new Date().toISOString().slice(0, 10) > cycEnd;
  }, [month, settings.payrollEndDay]);

  const mySlip = !isAdmin && payrolls.length > 0 ? payrolls[0] : null;
  const totalNet = payrolls.reduce((s, p) => s + (p.netPay || 0), 0);

  return (
    <AppShell title="Payroll">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Payroll Management</h4><p>Salary processing, payslips, and statutory deductions</p></div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="form-select" style={{ width: 160, fontSize: 13 }} value={month} onChange={e => setMonth(e.target.value)}>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn btn-outline-primary" onClick={() => approvePayroll('approve')}>
              <i className="bi bi-check-circle me-2" />Approve
            </button>
            <button className="btn btn-outline-success" onClick={() => approvePayroll('finalize')}>
              <i className="bi bi-lock me-2" />Finalize
            </button>
            <button className="btn btn-primary" onClick={runPayroll} disabled={running || !cycleReady} title={!cycleReady ? 'Payroll cycle has not ended yet' : ''}>
              {running ? <><span className="spinner-border spinner-border-sm me-2" />Running...</> : <><i className="bi bi-play-circle me-2" />Run Payroll</>}
            </button>
            {!cycleReady && <span className="badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 12, padding: '6px 12px', borderRadius: 8, alignSelf: 'center' }}><i className="bi bi-exclamation-triangle me-1" />Cycle not ended</span>}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="row g-3 mb-4">
          {[
            { label: 'Total Payroll', value: fmt(totalNet), icon: 'bi-cash-stack', color: '#3b82f6' },
            { label: 'Processed', value: payrolls.filter(p => p.status === 'processed').length, icon: 'bi-check-circle', color: '#10b981' },
            { label: 'Pending', value: payrolls.filter(p => p.status === 'pending').length, icon: 'bi-hourglass-split', color: '#f59e0b' },
            { label: 'Employees', value: payrolls.length, icon: 'bi-people', color: '#8b5cf6' },
          ].map((s, i) => (
            <div key={i} className="col-6 col-xl-3">
              <div className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{s.value}</div>
                  </div>
                  <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          ...(isAdmin ? [{ key: 'register', label: 'Payroll Register' }] : []),
          { key: 'myslip', label: 'My Payslip' },
          ...(isAdmin ? [{ key: 'structure', label: 'Salary Structure' }] : []),
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e293b' : '#64748b', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'register' && isAdmin && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Employee</th><th>DA</th><th>HRA</th><th>CA</th><th>Medical</th><th>Bonus</th><th>Gross</th><th>EPFO</th><th>ESI</th><th>Prof. Tax</th><th>LOP Days</th><th>Net Pay</th><th>Status</th><th>Payslip</th></tr></thead>
                  <tbody>
                    {payrolls.length === 0 ? (
                      <tr><td colSpan={14}><div className="empty-state"><i className="bi bi-cash-stack" /><h6>No payroll records for {month}. Run payroll to generate.</h6></div></td></tr>
                    ) : payrolls.map(p => (
                      <tr key={p._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{p.userId?.avatar}</div>
                            <div><div style={{ fontSize: 13, fontWeight: 600 }}>{p.userId?.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{p.userId?.department}</div></div>
                          </div>
                        </td>
                        {[p.da, p.hra, p.ca, p.medical, p.bonus, p.grossPay].map((v, i) => <td key={i} style={{ fontSize: 13 }}>{fmt(v)}</td>)}
                        {[p.epfo, p.esi, p.professionalTax].map((v, i) => <td key={i} style={{ fontSize: 13, color: '#ef4444' }}>{fmt(v)}</td>)}
                        <td style={{ fontSize: 13, color: '#f59e0b' }}>{p.lopDays || 0}d</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>{fmt(p.netPay)}</td>
                        <td><span className={`badge ${p.status === 'finalized' ? 'status-approved' : p.status === 'approved' ? 'status-approved' : p.status === 'draft' ? 'status-pending' : 'status-pending'}`} style={p.status === 'draft' ? { background: '#dbeafe', color: '#2563eb' } : p.status === 'approved' ? { background: '#fef3c7', color: '#d97706' } : {}}>{p.status}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setShowSlip(p)}><i className="bi bi-eye me-1" />View</button>
                            <button className="btn btn-sm btn-outline-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => printPayslip(p, p.userId?.name)}><i className="bi bi-printer me-1" />PDF</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'myslip' && (
            <div className="row justify-content-center">
              <div className="col-lg-8">
                {mySlip ? (
                  <div className="card p-4">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 20, borderBottom: '2px solid #f1f5f9' }}>
                      <div><h5 style={{ fontWeight: 800, margin: 0 }}>HRMS Pro</h5><div style={{ fontSize: 12, color: '#64748b' }}>Enterprise HR Platform</div></div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, fontSize: 16 }}>PAYSLIP</div><div style={{ fontSize: 12, color: '#64748b' }}>{mySlip.month}</div></div>
                    </div>
                    <div className="row mb-4">
                      <div className="col-6">
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Employee</div><div style={{ fontWeight: 700 }}>{user?.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, marginBottom: 4 }}>Department</div><div style={{ fontWeight: 600 }}>{user?.department}</div>
                      </div>
                      <div className="col-6">
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Pay Period</div><div style={{ fontWeight: 700 }}>{mySlip.cycleLabel || mySlip.month}</div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, marginBottom: 4 }}>Days Present</div><div style={{ fontWeight: 600 }}>{mySlip.presentDays ?? '—'}</div>
                      </div>
                    </div>
                    <div className="row g-3 mb-4">
                      <div className="col-6">
                        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#10b981' }}>EARNINGS</div>
                          {[['DA', mySlip.da], ['HRA', mySlip.hra], ['CA', mySlip.ca], ['Medical', mySlip.medical], ['Bonus', mySlip.bonus]].map(([l, v]) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}><span style={{ color: '#64748b' }}>{l}</span><span style={{ fontWeight: 600 }}>{fmt(v)}</span></div>
                          ))}
                          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Gross</span><span style={{ color: '#10b981' }}>{fmt(mySlip.grossPay)}</span></div>
                        </div>
                      </div>
                      <div className="col-6">
                        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#ef4444' }}>DEDUCTIONS</div>
                          {[['EPFO', mySlip.epfo], ['ESI', mySlip.esi], ['Professional Tax', mySlip.professionalTax], ['Loan', mySlip.loan]].map(([l, v]) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}><span style={{ color: '#64748b' }}>{l}</span><span style={{ fontWeight: 600, color: '#ef4444' }}>{fmt(v)}</span></div>
                          ))}
                          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>Total</span><span style={{ color: '#ef4444' }}>{fmt(mySlip.totalDeductions)}</span></div>
                        </div>
                      </div>
                    </div>
                    <div style={{ background: 'linear-gradient(135deg,#3b82f6,#1e293b)', borderRadius: 12, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
                      <div><div style={{ fontSize: 12, opacity: 0.8 }}>NET PAY</div><div style={{ fontSize: 28, fontWeight: 800 }}>{fmt(mySlip.netPay)}</div></div>
                      <button
                        onClick={() => printPayslip(mySlip, user?.name)}
                        style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <i className="bi bi-printer" /> Print / PDF
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="card p-5"><div className="empty-state"><i className="bi bi-cash-stack" /><h6>No payslip available for {month}</h6><p>Contact HR if you believe this is an error.</p></div></div>
                )}
              </div>
            </div>
          )}

          {tab === 'structure' && isAdmin && (
            <div className="card">
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Salary Structures</span>
                <button className="btn btn-primary btn-sm" onClick={() => { setStructureForm({ userId: '', da: '', hra: '', ca: '', medical: '', bonus: '', epfo: '', esi: '', professionalTax: '', lop: '', loan: '' }); setShowStructureModal(true); }}><i className="bi bi-plus-lg me-1" />Add Structure</button>
              </div>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Employee</th><th>DA</th><th>HRA</th><th>CA</th><th>Medical</th><th>Bonus</th><th>EPFO</th><th>ESI</th><th>Prof. Tax</th><th>Total Earnings</th><th>Total Deductions</th><th>Edit</th></tr></thead>
                  <tbody>
                    {structures.length === 0 ? (
                      <tr><td colSpan={12}><div className="empty-state"><i className="bi bi-diagram-3" /><h6>No salary structures defined</h6></div></td></tr>
                    ) : structures.map ? structures.map(s => {
                      const totalEarnings = s.da + s.hra + s.ca + s.medical + s.bonus;
                      const totalDeductions = s.epfo + s.esi + s.professionalTax + s.lop + s.loan;
                      return (
                      <tr key={s._id}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{s.userId?.name || '—'}</td>
                        <td style={{ fontSize: 13 }}>{fmt(s.da)}</td>
                        <td style={{ fontSize: 13 }}>{fmt(s.hra)}</td>
                        <td style={{ fontSize: 13 }}>{fmt(s.ca)}</td>
                        <td style={{ fontSize: 13 }}>{fmt(s.medical)}</td>
                        <td style={{ fontSize: 13 }}>{s.bonus > 0 ? fmt(s.bonus) : '—'}</td>
                        <td style={{ fontSize: 13 }}>{fmt(s.epfo)}</td>
                        <td style={{ fontSize: 13 }}>{s.esi > 0 ? fmt(s.esi) : 'N/A'}</td>
                        <td style={{ fontSize: 13 }}>{fmt(s.professionalTax)}</td>
                        <td style={{ fontSize: 13, fontWeight: 700 }}>{fmt(totalEarnings)}</td>
                        <td style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>{fmt(totalDeductions)}</td>
                        <td><button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setStructureForm({ userId: s.userId?._id || '', da: s.da, hra: s.hra, ca: s.ca, medical: s.medical, bonus: s.bonus, epfo: s.epfo, esi: s.esi, professionalTax: s.professionalTax, lop: s.lop, loan: s.loan }); setShowStructureModal(true); }}><i className="bi bi-pencil" /></button></td>
                      </tr>
                    )}) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Payslip Modal */}
      {showSlip && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content p-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h5 style={{ margin: 0 }}>Payslip — {showSlip.userId?.name}</h5>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{showSlip.cycleLabel || showSlip.month}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm btn-outline-success" onClick={() => printPayslip(showSlip, showSlip.userId?.name)}><i className="bi bi-printer me-1" />PDF</button>
                  <button className="btn-close" onClick={() => setShowSlip(null)} />
                </div>
              </div>
              {[['DA', showSlip.da], ['HRA', showSlip.hra], ['CA', showSlip.ca], ['Medical', showSlip.medical], ['Bonus', showSlip.bonus]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><span style={{ color: '#64748b' }}>{l}</span><span>{fmt(v)}</span></div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontWeight: 700, color: '#10b981', fontSize: 13 }}><span>Gross</span><span>{fmt(showSlip.grossPay)}</span></div>
              {[['EPFO', showSlip.epfo], ['ESI', showSlip.esi], ['Professional Tax', showSlip.professionalTax], ['Loan', showSlip.loan]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', color: '#ef4444', fontSize: 13 }}><span>{l}</span><span>-{fmt(v)}</span></div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 800, fontSize: 16 }}><span>Net Pay</span><span style={{ color: '#3b82f6' }}>{fmt(showSlip.netPay)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Structure Modal */}
      {showStructureModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Salary Structure</h5><button className="btn-close" onClick={() => setShowStructureModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employee</label>
                    {structureForm.userId ? (
                      <div style={{ padding: '8px 12px', background: '#f1f5f9', borderRadius: 6, fontSize: 14, fontWeight: 600 }}>
                        {employees.find(e => (e.userId || e._id) === structureForm.userId)?.name || '—'}
                      </div>
                    ) : (
                      <select className="form-select" value={structureForm.userId} onChange={e => setStructureForm(p => ({ ...p, userId: e.target.value }))}>
                        <option value="">Select employee</option>
                        {employees.map(e => <option key={e._id} value={e.userId || e._id}>{e.name}</option>)}
                      </select>
                    )}
                  </div>

                  {/* Earnings */}
                  <div className="col-12"><h6 style={{ fontWeight: 700, color: '#10b981', margin: 0, fontSize: 14 }}>EARNINGS</h6><hr style={{ margin: '6px 0 12px', opacity: 0.15 }} /></div>
                  {[['Dearness Allowance (DA)', 'da', true], ['House Rent Allowance (HRA)', 'hra', true], ['Conveyance Allowances (CA)', 'ca', true], ['Medical Allowances', 'medical', true], ['Bonus', 'bonus', false]].map(([label, key, required]) => (
                    <div key={key} className="col-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}</label>
                      <input type="text" inputMode="numeric" className="form-control" value={structureForm[key]} onChange={e => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) setStructureForm(p => ({ ...p, [key]: v })); }} />
                    </div>
                  ))}

                  {/* Deductions */}
                  <div className="col-12" style={{ marginTop: 8 }}><h6 style={{ fontWeight: 700, color: '#ef4444', margin: 0, fontSize: 14 }}>DEDUCTIONS</h6><hr style={{ margin: '6px 0 12px', opacity: 0.15 }} /></div>
                  {[['EPFO', 'epfo', true], ['ESI', 'esi', true], ['Professional Tax', 'professionalTax', false], ['Loss of Pay', 'lop', false], ['Loan', 'loan', false]].map(([label, key, required]) => (
                    <div key={key} className="col-6">
                      <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}</label>
                      <input type="text" inputMode="numeric" className="form-control" value={structureForm[key]} onChange={e => { const v = e.target.value; if (v === '' || /^\d+$/.test(v)) setStructureForm(p => ({ ...p, [key]: v })); }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowStructureModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveStructure} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save Structure'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
