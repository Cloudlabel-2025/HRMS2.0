'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

const INV_STATUS = {
  paid: { bg: '#dcfce7', color: '#16a34a' }, pending: { bg: '#fef3c7', color: '#d97706' },
  sent: { bg: '#dbeafe', color: '#2563eb' }, overdue: { bg: '#fee2e2', color: '#dc2626' },
  draft: { bg: '#f1f5f9', color: '#64748b' },
};
const fmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : '—';
const DEPTS = ['Engineering', 'HR', 'Finance', 'Design', 'Marketing', 'Operations', 'Sales'];
const EMPTY_INV = { invoiceNo: '', client: '', amount: '', issued: '', due: '', status: 'draft' };
const EMPTY_EXP = { category: 'Travel', amount: '', date: '', description: '' };
const EXP_CATS = ['Travel', 'Software', 'Training', 'Office', 'Hardware', 'Other'];

function BudgetChart({ budgets }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!budgets.length || !ref.current) return;
    const ctx = ref.current.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: budgets.map(b => b.department),
        datasets: [
          { label: 'Allocated', data: budgets.map(b => b.allocated / 1000), backgroundColor: '#dbeafe', borderRadius: 6 },
          { label: 'Spent', data: budgets.map(b => b.spent / 1000), backgroundColor: '#3b82f6', borderRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 10 } } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => `₹${v}K` } } },
      },
    });
    return () => chart.destroy();
  }, [budgets]);
  return <canvas ref={ref} />;
}

export default function FinancePage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvModal, setShowInvModal] = useState(false);
  const [showExpModal, setShowExpModal] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [invForm, setInvForm] = useState(EMPTY_INV);
  const [expForm, setExpForm] = useState(EMPTY_EXP);
  const [budgetForm, setBudgetForm] = useState({ department: 'Engineering', year: new Date().getFullYear(), allocated: '', spent: '0' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [inv, exp, bud] = await Promise.all([
        api.get('/api/finance/invoices'),
        api.get('/api/finance/expenses'),
        api.get(`/api/finance/budgets?year=${new Date().getFullYear()}`),
      ]);
      setInvoices(Array.isArray(inv?.invoices) ? inv.invoices : []);
      setExpenses(Array.isArray(exp?.expenses) ? exp.expenses : []);
      setBudgets(Array.isArray(bud?.budgets) ? bud.budgets : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const saveInvoice = async () => {
    if (!invForm.invoiceNo || !invForm.client || !invForm.amount) return showToast('Invoice #, client and amount required', 'error');
    setSaving(true);
    try {
      await api.post('/api/finance/invoices', { ...invForm, amount: +invForm.amount });
      showToast('Invoice created');
      setShowInvModal(false);
      setInvForm(EMPTY_INV);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveExpense = async () => {
    if (!expForm.amount || !expForm.date) return showToast('Amount and date required', 'error');
    setSaving(true);
    try {
      await api.post('/api/finance/expenses', { ...expForm, amount: +expForm.amount });
      showToast('Expense submitted');
      setShowExpModal(false);
      setExpForm(EMPTY_EXP);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveBudget = async () => {
    if (!budgetForm.allocated) return showToast('Allocated amount required', 'error');
    setSaving(true);
    try {
      await api.post('/api/finance/budgets', { ...budgetForm, allocated: +budgetForm.allocated, spent: +budgetForm.spent || 0 });
      showToast('Budget saved');
      setShowBudgetModal(false);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const approveExpense = async (id, status) => {
    try {
      await api.put(`/api/finance/expenses`, { id, status });
      showToast(`Expense ${status}`);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const totalInvoiced = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
  const totalPending = invoices.filter(i => ['pending', 'sent'].includes(i.status)).reduce((s, i) => s + (i.amount || 0), 0);
  const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.amount || 0), 0);

  return (
    <AppShell title="Finance & Invoicing">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Finance & Invoicing</h4><p>Invoices, budgets, and expense management</p></div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline-primary" onClick={() => setShowExpModal(true)}><i className="bi bi-plus-lg me-2" />Expense</button>
            <button className="btn btn-primary" onClick={() => setShowInvModal(true)}><i className="bi bi-plus-lg me-2" />New Invoice</button>
          </div>
        )}
        {!isAdmin && <button className="btn btn-primary" onClick={() => setShowExpModal(true)}><i className="bi bi-plus-lg me-2" />Submit Expense</button>}
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Total Invoiced', value: fmt(totalInvoiced), color: '#3b82f6', icon: 'bi-receipt' },
          { label: 'Collected', value: fmt(totalPaid), color: '#10b981', icon: 'bi-check-circle' },
          { label: 'Pending', value: fmt(totalPending), color: '#f59e0b', icon: 'bi-hourglass-split' },
          { label: 'Overdue', value: fmt(totalOverdue), color: '#ef4444', icon: 'bi-exclamation-circle' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div><div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div></div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['invoices', 'expenses', 'budget'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'invoices' ? 'Invoices' : t === 'expenses' ? 'Expense Claims' : 'Budget Tracking'}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'invoices' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Invoice #</th><th>Client</th><th>Amount</th><th>Issued</th><th>Due Date</th><th>Status</th></tr></thead>
                  <tbody>
                    {invoices.length === 0 ? (
                      <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-receipt" /><h6>No invoices yet</h6></div></td></tr>
                    ) : invoices.map(inv => (
                      <tr key={inv._id}>
                        <td style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>{inv.invoiceNo}</td>
                        <td style={{ fontSize: 13, fontWeight: 600 }}>{inv.client}</td>
                        <td style={{ fontSize: 13, fontWeight: 700 }}>{fmt(inv.amount)}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{inv.issued}</td>
                        <td style={{ fontSize: 12, color: inv.status === 'overdue' ? '#dc2626' : '#64748b', fontWeight: inv.status === 'overdue' ? 700 : 400 }}>{inv.due}</td>
                        <td><span className="badge" style={{ background: INV_STATUS[inv.status]?.bg, color: INV_STATUS[inv.status]?.color, textTransform: 'capitalize' }}>{inv.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'expenses' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Employee</th><th>Category</th><th>Amount</th><th>Date</th><th>Description</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead>
                  <tbody>
                    {expenses.length === 0 ? (
                      <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-receipt" /><h6>No expense claims</h6></div></td></tr>
                    ) : expenses.map(exp => (
                      <tr key={exp._id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{exp.userId?.avatar}</div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{exp.userId?.name}</span>
                          </div>
                        </td>
                        <td><span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>{exp.category}</span></td>
                        <td style={{ fontSize: 13, fontWeight: 700 }}>{fmt(exp.amount)}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{formatDate(exp.date)}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{exp.description}</td>
                        <td><span className={`badge ${exp.status === 'approved' ? 'status-approved' : exp.status === 'rejected' ? 'status-rejected' : 'status-pending'}`}>{exp.status}</span></td>
                        {isAdmin && (
                          <td>
                            {exp.status === 'pending' && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => approveExpense(exp._id, 'approved')}>Approve</button>
                                <button className="btn btn-sm btn-danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => approveExpense(exp._id, 'rejected')}>Reject</button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'budget' && (
            <div className="row g-3">
              {isAdmin && (
                <div className="col-12" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowBudgetModal(true)}><i className="bi bi-plus-lg me-1" />Set Budget</button>
                </div>
              )}
              <div className="col-lg-7">
                <div className="card p-3">
                  <div className="section-title mb-3">Department Budget vs Spend (₹K)</div>
                  <div style={{ height: 280 }}>{budgets.length > 0 ? <BudgetChart budgets={budgets} /> : <div className="empty-state" style={{ padding: 40 }}><i className="bi bi-bar-chart" /><h6>No budget data</h6></div>}</div>
                </div>
              </div>
              <div className="col-lg-5">
                <div className="card p-3">
                  <div className="section-title mb-3">Budget Utilization</div>
                  {budgets.length === 0 && <div className="empty-state" style={{ padding: 20 }}><i className="bi bi-bar-chart" /><h6>No budgets set</h6></div>}
                  {budgets.map(b => {
                    const pct = b.allocated > 0 ? Math.round((b.spent / b.allocated) * 100) : 0;
                    return (
                      <div key={b._id} style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600 }}>{b.department}</span>
                          <span style={{ color: pct >= 90 ? '#ef4444' : '#64748b', fontWeight: 700 }}>{pct}%</span>
                        </div>
                        <div className="progress"><div className="progress-bar" style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981' }} /></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                          <span>Spent: {fmt(b.spent)}</span><span>Budget: {fmt(b.allocated)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showInvModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">New Invoice</h5><button className="btn-close" onClick={() => setShowInvModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  {[['Invoice #', 'invoiceNo', 'text'], ['Client', 'client', 'text'], ['Amount', 'amount', 'number'], ['Issued Date', 'issued', 'date'], ['Due Date', 'due', 'date']].map(([label, key, type]) => (
                    <div key={key} className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label><input type={type} className="form-control" value={invForm[key]} onChange={e => setInvForm(p => ({ ...p, [key]: e.target.value }))} /></div>
                  ))}
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Status</label><select className="form-select" value={invForm.status} onChange={e => setInvForm(p => ({ ...p, status: e.target.value }))}>{['draft', 'sent', 'pending', 'paid', 'overdue'].map(s => <option key={s}>{s}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowInvModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveInvoice} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Create Invoice'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExpModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Submit Expense</h5><button className="btn-close" onClick={() => setShowExpModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category</label><select className="form-select" value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))}>{EXP_CATS.map(c => <option key={c}>{c}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Amount *</label><input type="number" className="form-control" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Date *</label><input type="date" className="form-control" value={expForm.date} onChange={e => setExpForm(p => ({ ...p, date: e.target.value }))} /></div>
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Description</label><input className="form-control" value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowExpModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveExpense} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Submitting...</> : 'Submit'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBudgetModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Set Budget</h5><button className="btn-close" onClick={() => setShowBudgetModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Department</label><select className="form-select" value={budgetForm.department} onChange={e => setBudgetForm(p => ({ ...p, department: e.target.value }))}>{DEPTS.map(d => <option key={d}>{d}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Year</label><input type="number" className="form-control" value={budgetForm.year} onChange={e => setBudgetForm(p => ({ ...p, year: +e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Allocated (₹)</label><input type="number" className="form-control" value={budgetForm.allocated} onChange={e => setBudgetForm(p => ({ ...p, allocated: e.target.value }))} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Spent (₹)</label><input type="number" className="form-control" value={budgetForm.spent} onChange={e => setBudgetForm(p => ({ ...p, spent: e.target.value }))} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowBudgetModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveBudget} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save Budget'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
