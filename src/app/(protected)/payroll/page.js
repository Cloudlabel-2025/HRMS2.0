'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';

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
  const [structureForm, setStructureForm] = useState({ userId: '', grossLPA: '', ruleId: '', overrides: [] });
  const strVal = (v) => v === '' || v === undefined || v === null ? '' : String(v);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [registerPage, setRegisterPage] = useState(1);
  const [structurePage, setStructurePage] = useState(1);
  const [rules, setRules] = useState([]);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', isDefault: false, earnings: [{ code: 'BASIC', label: 'Basic Pay', type: 'percent_of_gross', value: 50 }], deductions: [], lopConfig: { basis: 'working_days', deductFrom: 'gross', countHalfDay: true } });
  const [savingRule, setSavingRule] = useState(false);
  const pageSize = 10;

  useEffect(() => {
    setRegisterPage(1);
    setStructurePage(1);
  }, [tab, month]);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const approvePayroll = async (action) => {
    if (action === 'finalize' && !cycleReady) {
      if (!confirm('The current payroll cycle has not ended yet. Finalizing now will lock salary payouts mid-cycle. Are you sure you want to finalize anyway?')) return;
    }
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
      const [p, s, e, r] = await Promise.all([
        api.get(`/api/payroll?month=${month}`),
        isAdmin ? api.get('/api/payroll/structure') : Promise.resolve([]),
        isAdmin ? api.get('/api/employees') : Promise.resolve([]),
        isAdmin ? api.get('/api/payroll/rules') : Promise.resolve([]),
      ]);
      setPayrolls(Array.isArray(p) ? p : []);
      setStructures(Array.isArray(s) ? s : []);
      setEmployees(Array.isArray(e) ? e : []);
      setRules(Array.isArray(r) ? r : []);
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
      showToast(res.isMidCycle ? `Draft preview generated for ${res.processed} employees` : `Payroll processed for ${res.processed} employees`);
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
          <div class='row'><span style='color:#64748b'>Monthly Gross</span><span>${fmt(slip.monthlyGross)}</span></div>
          <div class='row'><span style='color:#64748b'>Basic Pay</span><span>${fmt(slip.basicPay)}</span></div>
          <div class='row'><span style='color:#64748b'>HRA</span><span>${fmt(slip.hra)}</span></div>
          <div class='row'><span style='color:#64748b'>Dearness Allowance</span><span>${fmt(slip.dearnessAllowance)}</span></div>
          <div class='row'><span style='color:#64748b'>Conveyance Allowance</span><span>${fmt(slip.conveyanceAllowance)}</span></div>
          <div class='row'><span style='color:#64748b'>Medical Allowance</span><span>${fmt(slip.medicalAllowance)}</span></div>
        </div>
        <div class='box' style='flex:1'>
          <div style='font-weight:700;font-size:13px;color:#ef4444;margin-bottom:10px'>DEDUCTIONS</div>
          <div class='row ded'><span>EPFO</span><span>${fmt(slip.pf)}</span></div>
          <div class='row ded'><span>ESI</span><span>${fmt(slip.esi)}</span></div>
          <div class='row ded'><span>Loss of Pay</span><span>${fmt(slip.lossOfPay)}</span></div>
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
    if (!structureForm.userId || !structureForm.grossLPA) return showToast('Employee and gross LPA required', 'error');
    setSaving(true);
    try {
      await api.post('/api/payroll/structure', {
        userId: structureForm.userId,
        grossLPA: +structureForm.grossLPA,
        ruleId: structureForm.ruleId || null,
        overrides: structureForm.overrides || [],
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

  const saveRule = async () => {
    if (!ruleForm.name) return showToast('Rule name is required', 'error');
    if (!ruleForm.earnings?.length) return showToast('At least one earning component is required', 'error');
    if (!ruleForm.earnings.some(e => e.code === 'BASIC')) return showToast('A BASIC earning component is required', 'error');
    setSavingRule(true);
    try {
      const payload = { ...ruleForm };
      if (!payload._id) delete payload._id;
      await api.post('/api/payroll/rules', payload);
      showToast(ruleForm._id ? 'Rule updated' : 'Rule created');
      setShowRuleModal(false);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSavingRule(false);
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
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="form-select" style={{ width: 160, fontSize: 13 }} value={month} onChange={e => setMonth(e.target.value)}>
            {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {isAdmin && <>
            <button className="btn btn-outline-primary" onClick={() => approvePayroll('approve')}>
              <i className="bi bi-check-circle me-2" />Approve
            </button>
            <button className="btn btn-outline-success" onClick={() => approvePayroll('finalize')}>
              <i className="bi bi-lock me-2" />Finalize
            </button>
            <button className="btn btn-primary" onClick={runPayroll} disabled={running} title={!cycleReady ? 'Generates draft calculations for cycle in progress' : 'Generates draft calculations for cycle'}>
              {running ? <><span className="spinner-border spinner-border-sm me-2" />Running...</> : <><i className="bi bi-play-circle me-2" />{cycleReady ? 'Run Payroll' : 'Run Preview Draft'}</>}
            </button>
            {!cycleReady && <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: 12, padding: '6px 12px', borderRadius: 8, alignSelf: 'center' }}><i className="bi bi-info-circle me-1" />Cycle in progress — Preview mode</span>}
          </>}
        </div>
      </div>

      {isAdmin && (
        <div className="row g-3 mb-4">
          {[
            { label: 'Total Payroll', value: fmt(totalNet), icon: 'bi-cash-stack', color: '#3b82f6' },
            { label: 'Finalized', value: payrolls.filter(p => p.status === 'finalized').length, icon: 'bi-check-circle', color: '#10b981' },
            { label: 'Draft', value: payrolls.filter(p => p.status === 'draft').length, icon: 'bi-hourglass-split', color: '#f59e0b' },
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
          ...(isAdmin ? [{ key: 'rules', label: 'Payroll Rules' }] : []),
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
                  <thead><tr><th>Employee</th><th>Monthly Gross</th><th>Basic</th><th>HRA</th><th>DA</th><th>CA</th><th>MA</th><th>PF</th><th>ESI</th><th>LOP (₹)</th><th>Net Pay</th><th>Status</th><th>Payslip</th></tr></thead>
                  <tbody>
                    {payrolls.length === 0 ? (
                      <tr><td colSpan={13}><div className="empty-state"><i className="bi bi-cash-stack" /><h6>No payroll records for {month}. Run payroll to generate.</h6></div></td></tr>
                    ) : payrolls.slice((registerPage - 1) * pageSize, registerPage * pageSize).map(p => (
                      <tr key={p._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{p.userId?.avatar}</div>
                            <div><div style={{ fontSize: 13, fontWeight: 600 }}>{p.userId?.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{p.userId?.department}</div></div>
                          </div>
                        </td>
                        {[p.monthlyGross, p.basicPay, p.hra, p.dearnessAllowance, p.conveyanceAllowance, p.medicalAllowance].map((v, i) => <td key={i} style={{ fontSize: 13 }}>{fmt(v)}</td>)}
                        {[p.pf, p.esi, p.lossOfPay].map((v, i) => <td key={i} style={{ fontSize: 13, color: '#ef4444' }}>{fmt(v)}</td>)}
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
              {payrolls.length > 0 && (
                <Pagination
                  currentPage={registerPage}
                  totalPages={Math.ceil(payrolls.length / pageSize)}
                  onPageChange={setRegisterPage}
                  totalItems={payrolls.length}
                  pageSize={pageSize}
                />
              )}
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
                          {[['Monthly Gross', mySlip.monthlyGross], ['Basic Pay', mySlip.basicPay], ['HRA', mySlip.hra], ['Dearness Allowance', mySlip.dearnessAllowance], ['Conveyance Allowance', mySlip.conveyanceAllowance], ['Medical Allowance', mySlip.medicalAllowance]].map(([l, v]) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}><span style={{ color: '#64748b' }}>{l}</span><span style={{ fontWeight: 600 }}>{fmt(v)}</span></div>
                          ))}
                        </div>
                      </div>
                      <div className="col-6">
                        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: '#ef4444' }}>DEDUCTIONS</div>
                          {[['Provident Fund', mySlip.pf], ['ESI', mySlip.esi], ['Loss of Pay', mySlip.lossOfPay]].map(([l, v]) => (
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
                <button className="btn btn-primary btn-sm" onClick={() => { setStructureForm({ userId: '', grossLPA: '', ruleId: '', overrides: [] }); setShowStructureModal(true); }}><i className="bi bi-plus-lg me-1" />Add Structure</button>
              </div>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Employee</th><th>Gross LPA (₹)</th><th>Monthly Gross</th><th>Rule</th><th>Bonuses</th><th>Edit</th></tr></thead>
                  <tbody>
                    {structures.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-diagram-3" /><h6>No salary structures defined</h6></div></td></tr>
                    ) : structures.map ? structures.slice((structurePage - 1) * pageSize, structurePage * pageSize).map(s => {
                      const mg = s.grossLPA / 12;
                      return (
                      <tr key={s._id}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{s.userId?.name || '—'}</td>
                        <td style={{ fontSize: 13, fontWeight: 700 }}>{fmt(s.grossLPA)}</td>
                        <td style={{ fontSize: 13 }}>{fmt(mg)}</td>
                        <td style={{ fontSize: 12 }}>{s.ruleId?.name || <span style={{ color: '#94a3b8' }}>Default</span>}</td>
                        <td style={{ fontSize: 12 }}>{s.overrides?.filter(o => o.type === 'bonus' && o.value > 0).map(o => `${o.label}: ${fmt(o.value)}`).join(', ') || '—'}</td>
                        <td><button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setStructureForm({ userId: s.userId?._id || '', grossLPA: String(s.grossLPA), ruleId: s.ruleId?._id || '', overrides: s.overrides || [] }); setShowStructureModal(true); }}><i className="bi bi-pencil" /></button></td>
                      </tr>
                      );
                    }) : null}
                  </tbody>
                </table>
              </div>
              {structures.length > 0 && (
                <Pagination
                  currentPage={structurePage}
                  totalPages={Math.ceil(structures.length / pageSize)}
                  onPageChange={setStructurePage}
                  totalItems={structures.length}
                  pageSize={pageSize}
                />
              )}
            </div>
          )}

          {tab === 'rules' && isAdmin && (
            <div className="card">
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Payroll Rules</span>
                <button className="btn btn-primary btn-sm" onClick={() => { setRuleForm({ name: '', isDefault: false, earnings: [{ code: 'BASIC', label: 'Basic Pay', type: 'percent_of_gross', value: 50 }], deductions: [], lopConfig: { basis: 'working_days', deductFrom: 'gross', countHalfDay: true, graceDays: 0 } }); setShowRuleModal(true); }}><i className="bi bi-plus-lg me-1" />Add Rule</button>
              </div>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Rule Name</th><th>Default</th><th>Earnings</th><th>Deductions</th><th>LOP Basis</th><th>Edit</th></tr></thead>
                  <tbody>
                    {rules.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-diagram-3" /><h6>No payroll rules defined</h6></div></td></tr>
                    ) : rules.map(r => (
                      <tr key={r._id}>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</td>
                        <td>{r.isDefault ? <span className="badge status-approved">Default</span> : '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.earnings?.map(e => `${e.label} (${e.value}${e.type.includes('percent') ? '%' : ''})`).join(', ')}</td>
                        <td style={{ fontSize: 12 }}>{r.deductions?.filter(d => d.enabled !== false).map(d => d.label).join(', ') || '—'}</td>
                        <td style={{ fontSize: 12 }}>{r.lopConfig?.basis === 'calendar_days' ? 'Calendar Days' : 'Working Days'}</td>
                        <td><button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setRuleForm({ ...r }); setShowRuleModal(true); }}><i className="bi bi-pencil" /></button></td>
                      </tr>
                    ))}
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
              {(showSlip.earningsArray?.length ? showSlip.earningsArray : [['Monthly Gross', showSlip.monthlyGross], ['Basic Pay', showSlip.basicPay], ['HRA', showSlip.hra], ['DA', showSlip.dearnessAllowance], ['CA', showSlip.conveyanceAllowance], ['MA', showSlip.medicalAllowance]].map(([l, v]) => ({ label: l, amount: v }))).map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}><span style={{ color: '#64748b' }}>{e.label}</span><span>{fmt(e.amount)}</span></div>
              ))}
              {(showSlip.deductionsArray?.length ? showSlip.deductionsArray : [{ label: 'PF', amount: showSlip.pf }, { label: 'ESI', amount: showSlip.esi }, { label: 'LOP', amount: showSlip.lossOfPay }]).map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', color: '#ef4444', fontSize: 13 }}><span>{d.label}</span><span>-{fmt(d.amount)}</span></div>
              ))}
              {showSlip.bonuses?.length > 0 && <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8b5cf6', marginTop: 8, marginBottom: 4 }}>BONUSES</div>
                {showSlip.bonuses.map((b, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', color: '#8b5cf6', fontSize: 13 }}><span>{b.label}</span><span>+{fmt(b.amount)}</span></div>
                ))}
              </>}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 800, fontSize: 16 }}><span>Net Pay</span><span style={{ color: '#3b82f6' }}>{fmt(showSlip.netPay)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Payroll Rule Modal */}
      {showRuleModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg" style={{ maxWidth: 720 }}>
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">{ruleForm._id ? 'Edit' : 'New'} Payroll Rule</h5><button className="btn-close" onClick={() => setShowRuleModal(false)} /></div>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                <div className="row g-3">
                  <div className="col-8">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Rule Name</label>
                    <input className="form-control" value={ruleForm.name} onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Standard India" />
                  </div>
                  <div className="col-4 d-flex align-items-end">
                    <div className="form-check"><input className="form-check-input" type="checkbox" checked={ruleForm.isDefault || false} onChange={e => setRuleForm(p => ({ ...p, isDefault: e.target.checked }))} id="ruleDefault" /><label className="form-check-label" htmlFor="ruleDefault" style={{ fontSize: 13 }}>Default Rule</label></div>
                  </div>

                  {/* Earnings */}
                  <div className="col-12">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label className="form-label mb-0" style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>Earnings Components</label>
                      <button className="btn btn-outline-success btn-sm" style={{ fontSize: 11 }} onClick={() => setRuleForm(p => ({ ...p, earnings: [...(p.earnings || []), { code: '', label: '', type: 'percent_of_gross', value: 0 }] }))}><i className="bi bi-plus me-1" />Add</button>
                    </div>
                    {(ruleForm.earnings || []).map((comp, idx) => (
                      <div key={idx} className="row g-2 mb-2 align-items-center">
                        <div className="col-2"><input className="form-control form-control-sm" placeholder="Code" value={comp.code} onChange={e => { const arr = [...ruleForm.earnings]; arr[idx] = { ...arr[idx], code: e.target.value.toUpperCase() }; setRuleForm(p => ({ ...p, earnings: arr })); }} /></div>
                        <div className="col-3"><input className="form-control form-control-sm" placeholder="Label" value={comp.label} onChange={e => { const arr = [...ruleForm.earnings]; arr[idx] = { ...arr[idx], label: e.target.value }; setRuleForm(p => ({ ...p, earnings: arr })); }} /></div>
                        <div className="col-3"><select className="form-select form-select-sm" value={comp.type} onChange={e => { const arr = [...ruleForm.earnings]; arr[idx] = { ...arr[idx], type: e.target.value }; setRuleForm(p => ({ ...p, earnings: arr })); }}><option value="percent_of_gross">% of Gross</option><option value="percent_of_basic">% of Basic</option><option value="fixed">Fixed ₹</option><option value="remainder">Remainder</option></select></div>
                        <div className="col-2"><input type="number" className="form-control form-control-sm" placeholder="Value" value={comp.value} onChange={e => { const arr = [...ruleForm.earnings]; arr[idx] = { ...arr[idx], value: +e.target.value }; setRuleForm(p => ({ ...p, earnings: arr })); }} /></div>
                        <div className="col-2 text-end">{comp.code !== 'BASIC' && <button className="btn btn-sm btn-outline-danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setRuleForm(p => ({ ...p, earnings: p.earnings.filter((_, i) => i !== idx) }))}><i className="bi bi-trash" /></button>}</div>
                      </div>
                    ))}
                  </div>

                  {/* Deductions */}
                  <div className="col-12">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label className="form-label mb-0" style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>Deductions</label>
                      <button className="btn btn-outline-danger btn-sm" style={{ fontSize: 11 }} onClick={() => setRuleForm(p => ({ ...p, deductions: [...(p.deductions || []), { code: '', label: '', type: 'percent_of_gross', value: 0, cap: null, eligibilityMaxGross: null, enabled: true }] }))}><i className="bi bi-plus me-1" />Add</button>
                    </div>
                    {(ruleForm.deductions || []).map((comp, idx) => (
                      <div key={idx} className="row g-2 mb-2 align-items-center">
                        <div className="col-2"><input className="form-control form-control-sm" placeholder="Code" value={comp.code} onChange={e => { const arr = [...ruleForm.deductions]; arr[idx] = { ...arr[idx], code: e.target.value.toUpperCase() }; setRuleForm(p => ({ ...p, deductions: arr })); }} /></div>
                        <div className="col-2"><input className="form-control form-control-sm" placeholder="Label" value={comp.label} onChange={e => { const arr = [...ruleForm.deductions]; arr[idx] = { ...arr[idx], label: e.target.value }; setRuleForm(p => ({ ...p, deductions: arr })); }} /></div>
                        <div className="col-2"><select className="form-select form-select-sm" value={comp.type} onChange={e => { const arr = [...ruleForm.deductions]; arr[idx] = { ...arr[idx], type: e.target.value }; setRuleForm(p => ({ ...p, deductions: arr })); }}><option value="percent_of_basic_da">% of Basic+DA</option><option value="percent_of_gross">% of Gross</option><option value="fixed">Fixed ₹</option></select></div>
                        <div className="col-1"><input type="number" className="form-control form-control-sm" placeholder="Val" value={comp.value} onChange={e => { const arr = [...ruleForm.deductions]; arr[idx] = { ...arr[idx], value: +e.target.value }; setRuleForm(p => ({ ...p, deductions: arr })); }} /></div>
                        <div className="col-2"><input type="number" className="form-control form-control-sm" placeholder="Cap ₹" value={comp.cap || ''} onChange={e => { const arr = [...ruleForm.deductions]; arr[idx] = { ...arr[idx], cap: e.target.value ? +e.target.value : null }; setRuleForm(p => ({ ...p, deductions: arr })); }} /></div>
                        <div className="col-2"><input type="number" className="form-control form-control-sm" placeholder="Max Gross" value={comp.eligibilityMaxGross || ''} onChange={e => { const arr = [...ruleForm.deductions]; arr[idx] = { ...arr[idx], eligibilityMaxGross: e.target.value ? +e.target.value : null }; setRuleForm(p => ({ ...p, deductions: arr })); }} /></div>
                        <div className="col-1 text-end"><button className="btn btn-sm btn-outline-danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setRuleForm(p => ({ ...p, deductions: p.deductions.filter((_, i) => i !== idx) }))}><i className="bi bi-trash" /></button></div>
                      </div>
                    ))}
                  </div>

                  {/* LOP Config */}
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>LOP Configuration</label>
                    <div className="row g-2">
                      <div className="col-3">
                        <label className="form-label" style={{ fontSize: 11 }}>LOP Basis</label>
                        <select className="form-select form-select-sm" value={ruleForm.lopConfig?.basis || 'working_days'} onChange={e => setRuleForm(p => ({ ...p, lopConfig: { ...p.lopConfig, basis: e.target.value } }))}>
                          <option value="working_days">Working Days (Cycle)</option>
                          <option value="calendar_days">Calendar Days (Month)</option>
                          <option value="fixed_26">Fixed 26 Days</option>
                          <option value="fixed_30">Fixed 30 Days</option>
                        </select>
                      </div>
                      <div className="col-3">
                        <label className="form-label" style={{ fontSize: 11 }}>Deduct From</label>
                        <select className="form-select form-select-sm" value={ruleForm.lopConfig?.deductFrom || 'gross'} onChange={e => setRuleForm(p => ({ ...p, lopConfig: { ...p.lopConfig, deductFrom: e.target.value } }))}>
                          <option value="gross">Gross Salary</option>
                          <option value="basic">Basic Salary</option>
                          <option value="basic_da">Basic + DA</option>
                        </select>
                      </div>
                      <div className="col-3">
                        <label className="form-label" style={{ fontSize: 11 }}>Grace LOP Days</label>
                        <input type="number" min="0" className="form-control form-control-sm" placeholder="e.g. 0" value={ruleForm.lopConfig?.graceDays ?? 0} onChange={e => setRuleForm(p => ({ ...p, lopConfig: { ...p.lopConfig, graceDays: +e.target.value } }))} />
                      </div>
                      <div className="col-3 d-flex align-items-end">
                        <div className="form-check"><input className="form-check-input" type="checkbox" checked={ruleForm.lopConfig?.countHalfDay !== false} onChange={e => setRuleForm(p => ({ ...p, lopConfig: { ...p.lopConfig, countHalfDay: e.target.checked } }))} id="halfDayLop" /><label className="form-check-label" htmlFor="halfDayLop" style={{ fontSize: 12 }}>Half-day = 0.5 LOP</label></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowRuleModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveRule} disabled={savingRule}>{savingRule ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save Rule'}</button>
              </div>
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
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Gross LPA (₹)</label>
                    <input type="number" className="form-control" value={strVal(structureForm.grossLPA)} onChange={e => setStructureForm(p => ({ ...p, grossLPA: e.target.value }))} placeholder="e.g. 180000" />
                  </div>
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Payroll Rule</label>
                    <select className="form-select" value={structureForm.ruleId || ''} onChange={e => setStructureForm(p => ({ ...p, ruleId: e.target.value }))}>
                      <option value="">Default Rule</option>
                      {rules.map(r => <option key={r._id} value={r._id}>{r.name}{r.isDefault ? ' (Default)' : ''}</option>)}
                    </select>
                  </div>
                  <div className="col-12">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label className="form-label mb-0" style={{ fontSize: 13, fontWeight: 600 }}>Bonuses / Overrides</label>
                      <button className="btn btn-outline-primary btn-sm" style={{ fontSize: 11 }} onClick={() => setStructureForm(p => ({ ...p, overrides: [...(p.overrides || []), { code: 'BONUS', label: 'Bonus', type: 'bonus', value: 0, recurring: true }] }))}><i className="bi bi-plus me-1" />Add</button>
                    </div>
                    {(structureForm.overrides || []).map((ovr, idx) => (
                      <div key={idx} className="row g-2 mb-2 align-items-center">
                        <div className="col-3"><input className="form-control form-control-sm" placeholder="Code" value={ovr.code || ''} onChange={e => { const arr = [...structureForm.overrides]; arr[idx] = { ...arr[idx], code: e.target.value }; setStructureForm(p => ({ ...p, overrides: arr })); }} /></div>
                        <div className="col-3"><input className="form-control form-control-sm" placeholder="Label" value={ovr.label || ''} onChange={e => { const arr = [...structureForm.overrides]; arr[idx] = { ...arr[idx], label: e.target.value }; setStructureForm(p => ({ ...p, overrides: arr })); }} /></div>
                        <div className="col-2"><input type="number" className="form-control form-control-sm" placeholder="₹" value={ovr.value || ''} onChange={e => { const arr = [...structureForm.overrides]; arr[idx] = { ...arr[idx], value: +e.target.value }; setStructureForm(p => ({ ...p, overrides: arr })); }} /></div>
                        <div className="col-2"><div className="form-check mt-1"><input className="form-check-input" type="checkbox" checked={ovr.recurring !== false} onChange={e => { const arr = [...structureForm.overrides]; arr[idx] = { ...arr[idx], recurring: e.target.checked }; setStructureForm(p => ({ ...p, overrides: arr })); }} /><label className="form-check-label" style={{ fontSize: 11 }}>Monthly</label></div></div>
                        <div className="col-2 text-end"><button className="btn btn-sm btn-outline-danger" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setStructureForm(p => ({ ...p, overrides: p.overrides.filter((_, i) => i !== idx) }))}><i className="bi bi-trash" /></button></div>
                      </div>
                    ))}
                  </div>
                  {structureForm.grossLPA > 0 && (
                    <div className="col-12" style={{ background: '#f8fafc', borderRadius: 8, padding: 12, marginTop: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>MONTHLY BREAKDOWN (Auto-computed)</div>
                      {(() => { const m = +structureForm.grossLPA / 12; return [
                        ['Monthly Gross', m],
                        ['Basic (50%)', m * 0.5],
                        ['HRA (20%)', m * 0.2],
                        ['DA (15%)', m * 0.15],
                        ['CA (10%)', m * 0.1],
                        ['MA (5%)', m * 0.05],
                      ].map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                          <span style={{ color: '#64748b' }}>{l}</span>
                          <span style={{ fontWeight: 600 }}>₹{Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                        </div>
                      )) })()}
                    </div>
                  )}
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
