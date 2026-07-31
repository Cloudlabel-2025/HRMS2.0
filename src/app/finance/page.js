'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import DateInput from '@/components/DateInput';
import Pagination from '@/components/Pagination';
import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const EXPENSE_CATEGORIES = ['Travel', 'Software', 'Training', 'Office', 'Hardware', 'Other'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const EMPTY_EXPENSE = { category: 'Travel', amount: '', date: '', description: '' };
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function FinancePage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);
  const [tab, setTab] = useState('overview');
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [accounting, setAccounting] = useState({ journal: [], ledger: [], trialBalance: [], balanceSheet: {}, payroll: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE);
  const [categoryName, setCategoryName] = useState('');
  const [budgetForm, setBudgetForm] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1, allocated: '' });
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const notify = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const [expenseData, budgetData, categoryData, accountingData] = await Promise.all([
        api.get('/api/finance/expenses'),
        api.get(`/api/finance/budgets?year=${new Date().getFullYear()}`),
        api.get('/api/finance/expense-categories'),
        api.get(`/api/finance/accounting?year=${new Date().getFullYear()}`),
      ]);
      setExpenses(Array.isArray(expenseData?.expenses) ? expenseData.expenses : []);
      setBudgets(Array.isArray(budgetData?.budgets) ? budgetData.budgets : []);
      setExpenseCategories(Array.isArray(categoryData?.categories) ? categoryData.categories : []);
      setAccounting(accountingData || { journal: [], ledger: [], trialBalance: [], balanceSheet: {}, payroll: {} });
    } catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => setPage(1), [tab]);

  const saveExpense = async () => {
    if (!expenseForm.amount || !expenseForm.date || !expenseForm.description.trim()) return notify('Amount, date, and description are required', 'error');
    setSaving(true);
    try {
      await api.post('/api/finance/expenses', { ...expenseForm, amount: Number(expenseForm.amount) });
      setExpenseForm(EMPTY_EXPENSE); setShowExpenseModal(false); notify('Expense claim submitted'); load();
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveBudget = async () => {
    if (budgetForm.allocated === '') return notify('Allocated amount is required', 'error');
    setSaving(true);
    try {
      await api.post('/api/finance/budgets', { ...budgetForm, allocated: Number(budgetForm.allocated) });
      setShowBudgetModal(false); notify('Monthly allocation added'); load();
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveCategory = async () => {
    if (!categoryName.trim()) return notify('Category name is required', 'error');
    setSaving(true);
    try {
      const result = await api.post('/api/finance/expense-categories', { name: categoryName });
      if (result?.category) {
        setExpenseCategories(items => [...items, result.category].sort((a, b) => a.name.localeCompare(b.name)));
        setExpenseForm(form => ({ ...form, category: result.category.name }));
      }
      setCategoryName(''); setShowCategoryModal(false); notify('Expense category added');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };

  const reviewExpense = async (id, status) => {
    try { await api.put('/api/finance/expenses', { id, status }); notify(`Expense ${status}`); load(); }
    catch (error) { notify(error.message, 'error'); }
  };

  const approved = expenses.filter(item => item.status === 'approved');
  const pending = expenses.filter(item => item.status === 'pending');
  const approvedTotal = approved.reduce((sum, item) => sum + item.amount, 0);
  const allocatedTotal = budgets.reduce((sum, item) => sum + item.allocated, 0);
  const remaining = allocatedTotal - budgets.reduce((sum, item) => sum + item.spent, 0);
  const categoryTotals = useMemo(() => Object.entries(expenses.reduce((totals, item) => {
    if (item.status === 'approved') totals[item.category] = (totals[item.category] || 0) + item.amount;
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]), [expenses]);
  const availableCategories = [...new Set([...EXPENSE_CATEGORIES, ...expenseCategories.map(category => category.name)])];
  const accountingTabs = ['journal', 'ledger', 'trial', 'balance', 'payroll'];
  const accountingReport = () => {
    if (tab === 'journal') return { title: 'Journal', headers: ['Date', 'Reference', 'Description', 'Debit Account', 'Credit Account', 'Amount'], rows: (accounting.journal || []).map(e => [e.date, e.type === 'expense' ? 'Expense' : 'Budget Allocation', e.description, e.debitAccount, e.creditAccount, e.amount]) };
    if (tab === 'ledger') return { title: 'General Ledger', headers: ['Account', 'Debit', 'Credit', 'Balance'], rows: (accounting.ledger || []).map(e => [e.account, e.debit, e.credit, e.balance]) };
    if (tab === 'trial') return { title: 'Trial Balance', headers: ['Account', 'Debit', 'Credit'], rows: (accounting.trialBalance || []).map(e => [e.account, e.debit, e.credit]) };
    if (tab === 'balance') return { title: 'Balance Sheet', headers: ['Section', 'Account', 'Amount'], rows: [['Assets', 'Cash / Bank', accounting.balanceSheet?.cash || 0], ['Net Organisation Funds', 'Budget Reserve after expenses', accounting.balanceSheet?.budgetReserve || 0]] };
    return { title: 'Payroll Accounts', headers: ['Account', 'Amount'], rows: [['Gross Salary', accounting.payroll?.gross || 0], ['Deductions', accounting.payroll?.deductions || 0], ['Net Payable', accounting.payroll?.netPay || 0], ['Payroll Records', accounting.payroll?.count || 0]] };
  };
  const downloadReport = async format => {
    const report = accountingReport();
    const filename = `${report.title.toLowerCase().replace(/\s+/g, '-')}-${new Date().getFullYear()}`;
    if (format === 'csv') {
      const csv = [report.headers, ...report.rows].map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); link.download = `${filename}.csv`; link.click(); URL.revokeObjectURL(link.href); return;
    }
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet(report.title.slice(0, 31));
      sheet.addRow(report.headers); report.rows.forEach(row => sheet.addRow(row)); sheet.getRow(1).font = { bold: true }; sheet.columns.forEach(column => { column.width = 20; });
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); link.download = `${filename}.xlsx`; link.click(); URL.revokeObjectURL(link.href); return;
    }
    const doc = new jsPDF({ orientation: report.headers.length > 4 ? 'landscape' : 'portrait' }); doc.setFontSize(14); doc.text(report.title, 14, 16); autoTable(doc, { head: [report.headers], body: report.rows.map(row => row.map(String)), startY: 22 }); doc.save(`${filename}.pdf`);
  };

  return <AppShell title="Finance">
    {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.message}</div></div>}
    <div className="page-header">
      <div><h4>Finance</h4><p>Track organisation-wide expenses, approvals, and budget usage</p></div>
      <div style={{ display: 'flex', gap: 8 }}>
        {isAdmin && <button className="btn btn-outline-primary" onClick={() => setShowBudgetModal(true)}><i className="bi bi-plus-lg me-2" />Set Budget</button>}
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowExpenseModal(true)}><i className="bi bi-plus-lg me-2" />Add Expense</button>}
      </div>
    </div>

    <div className="row g-3 mb-4">{[
      ['Approved Expenses', money(approvedTotal), '#3b82f6', 'bi-wallet2'],
      ['Pending Approval', `${pending.length} claim${pending.length === 1 ? '' : 's'}`, '#f59e0b', 'bi-hourglass-split'],
      ['Budget Allocated', money(allocatedTotal), '#8b5cf6', 'bi-pie-chart'],
      ['Budget Remaining', money(remaining), remaining < 0 ? '#ef4444' : '#10b981', 'bi-cash-stack'],
    ].map(([label, value, color, icon]) => <div className="col-6 col-xl-3" key={label}><div className="stat-card"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{label}</div><div style={{ fontSize: 21, fontWeight: 800, color }}>{value}</div></div><div className="stat-icon" style={{ background: color + '15' }}><i className={`bi ${icon}`} style={{ color }} /></div></div></div></div>)}</div>

    <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
      {[['overview', 'Overview'], ['expenses', 'Expenses'], ['budgets', 'Monthly Budget'], ['journal', 'Journal'], ['ledger', 'Ledger'], ['trial', 'Trial Balance'], ['balance', 'Balance Sheet'], ['payroll', 'Payroll Accounts']].map(([key, label]) => <button key={key} onClick={() => setTab(key)} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#1e293b' : '#64748b', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>{label}</button>)}
    </div>
    {accountingTabs.includes(tab) && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: -12, marginBottom: 16 }}><button className="btn btn-sm btn-outline-secondary" onClick={() => downloadReport('csv')}><i className="bi bi-filetype-csv me-1" />CSV</button><button className="btn btn-sm btn-outline-success" onClick={() => downloadReport('excel')}><i className="bi bi-file-earmark-excel me-1" />Excel</button><button className="btn btn-sm btn-outline-danger" onClick={() => downloadReport('pdf')}><i className="bi bi-file-earmark-pdf me-1" />PDF</button></div>}

    {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : <>
      {tab === 'overview' && <div className="row g-3"><div className="col-lg-6"><div className="card p-3"><div className="section-title mb-3">Approved Expense by Category</div>{categoryTotals.length ? categoryTotals.map(([category, total]) => <div key={category} style={{ marginBottom: 15 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}><span style={{ fontWeight: 600 }}>{category}</span><strong>{money(total)}</strong></div><div className="progress"><div className="progress-bar" style={{ width: `${Math.round(total / approvedTotal * 100)}%`, background: '#3b82f6' }} /></div></div>) : <div className="empty-state" style={{ padding: 28 }}><i className="bi bi-wallet2" /><h6>No approved expenses yet</h6></div>}</div></div><div className="col-lg-6"><div className="card p-3"><div className="section-title mb-3">Organisation Budget Health</div>{budgets.length ? budgets.map(budget => { const percent = budget.allocated ? Math.round(budget.spent / budget.allocated * 100) : 0; return <div key={budget._id} style={{ marginBottom: 15 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}><span style={{ fontWeight: 600 }}>Organisation budget</span><strong>{percent}% used</strong></div><div className="progress"><div className="progress-bar" style={{ width: `${Math.min(percent, 100)}%`, background: percent >= 90 ? '#ef4444' : percent >= 70 ? '#f59e0b' : '#10b981' }} /></div><small style={{ color: '#64748b' }}>{money(budget.spent)} of {money(budget.allocated)}</small></div>; }) : <div className="empty-state" style={{ padding: 28 }}><i className="bi bi-pie-chart" /><h6>No organisation budget set</h6></div>}</div></div></div>}
      {tab === 'expenses' && <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Employee</th><th>Category</th><th>Amount</th><th>Date</th><th>Description</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead><tbody>{expenses.length ? expenses.slice((page - 1) * pageSize, page * pageSize).map(expense => <tr key={expense._id}><td style={{ fontWeight: 600, fontSize: 13 }}>{expense.userId?.name || '—'}</td><td><span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>{expense.category}</span></td><td style={{ fontWeight: 700 }}>{money(expense.amount)}</td><td>{formatDate(expense.date)}</td><td>{expense.description}</td><td><span className={`badge ${expense.status === 'approved' ? 'status-approved' : expense.status === 'rejected' ? 'status-rejected' : 'status-pending'}`}>{expense.status}</span></td>{isAdmin && <td>{expense.status === 'pending' && <div style={{ display: 'flex', gap: 4 }}><button className="btn btn-sm btn-success" onClick={() => reviewExpense(expense._id, 'approved')}>Approve</button><button className="btn btn-sm btn-danger" onClick={() => reviewExpense(expense._id, 'rejected')}>Reject</button></div>}</td>}</tr>) : <tr><td colSpan={isAdmin ? 7 : 6}><div className="empty-state"><i className="bi bi-receipt" /><h6>No expense claims</h6></div></td></tr>}</tbody></table></div>{expenses.length > pageSize && <Pagination currentPage={page} totalPages={Math.ceil(expenses.length / pageSize)} onPageChange={setPage} totalItems={expenses.length} pageSize={pageSize} />}</div>}
      {tab === 'budgets' && <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Month</th><th>Year</th><th>Allocated</th><th>Spent</th><th>Available</th><th>Usage</th></tr></thead><tbody>{budgets.length ? budgets.map(budget => { const used = budget.allocated ? Math.round(budget.spent / budget.allocated * 100) : 0; return <tr key={budget._id}><td style={{ fontWeight: 700 }}>{MONTHS[(budget.month || 1) - 1]}</td><td>{budget.year}</td><td>{money(budget.allocated)}</td><td>{money(budget.spent)}</td><td style={{ color: budget.allocated - budget.spent < 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>{money(budget.allocated - budget.spent)}</td><td style={{ minWidth: 140 }}><div className="progress"><div className="progress-bar" style={{ width: `${Math.min(used, 100)}%`, background: used >= 90 ? '#ef4444' : used >= 70 ? '#f59e0b' : '#10b981' }} /></div><small>{used}%</small></td></tr>; }) : <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-pie-chart" /><h6>No monthly allocation set</h6></div></td></tr>}</tbody></table></div></div>}
      {tab === 'journal' && <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Amount</th></tr></thead><tbody>{accounting.journal?.length ? accounting.journal.map((entry, index) => <tr key={index}><td>{entry.date ? formatDate(entry.date) : '—'}</td><td>{entry.type === 'expense' ? 'Expense' : 'Budget Allocation'}</td><td>{entry.description}</td><td>{entry.debitAccount}</td><td>{entry.creditAccount}</td><td style={{ fontWeight: 700 }}>{money(entry.amount)}</td></tr>) : <tr><td colSpan={6}><div className="empty-state"><h6>No accounting entries</h6></div></td></tr>}</tbody></table></div></div>}
      {tab === 'ledger' && <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Account</th><th>Total Debit</th><th>Total Credit</th><th>Balance</th></tr></thead><tbody>{accounting.ledger?.map(item => <tr key={item.account}><td style={{ fontWeight: 700 }}>{item.account}</td><td>{money(item.debit)}</td><td>{money(item.credit)}</td><td>{money(Math.abs(item.balance))} {item.balance < 0 ? 'Cr' : 'Dr'}</td></tr>)}</tbody></table></div></div>}
      {tab === 'trial' && <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{accounting.trialBalance?.map(item => <tr key={item.account}><td>{item.account}</td><td>{money(item.debit)}</td><td>{money(item.credit)}</td></tr>)}</tbody></table></div></div>}
      {tab === 'balance' && <div className="row g-3"><div className="col-md-6"><div className="card p-3"><div className="section-title mb-3">Assets</div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cash / Bank</span><strong>{money(accounting.balanceSheet?.cash)}</strong></div></div></div><div className="col-md-6"><div className="card p-3"><div className="section-title mb-3">Net Organisation Funds</div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Budget reserve after expenses</span><strong>{money(accounting.balanceSheet?.budgetReserve)}</strong></div></div></div></div>}
      {tab === 'payroll' && <div className="card p-3"><div className="section-title mb-3">Standalone Payroll Accounts</div><p style={{ color: '#64748b', fontSize: 13 }}>Payroll is separate from the operating-expense budget.</p><div className="row g-3"><div className="col-4"><strong>Gross Salary</strong><div>{money(accounting.payroll?.gross)}</div></div><div className="col-4"><strong>Deductions</strong><div>{money(accounting.payroll?.deductions)}</div></div><div className="col-4"><strong>Net Payable</strong><div>{money(accounting.payroll?.netPay)}</div></div></div></div>}
    </>}

    {showExpenseModal && <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title">Submit Expense</h5><button className="btn-close" onClick={() => setShowExpenseModal(false)} /></div><div className="modal-body"><div className="row g-3"><div className="col-6"><label className="form-label">Category *</label><div style={{ display: 'flex', gap: 6 }}><select className="form-select" value={expenseForm.category} onChange={e => setExpenseForm(p => ({ ...p, category: e.target.value }))}>{availableCategories.map(category => <option key={category}>{category}</option>)}</select><button type="button" className="btn btn-outline-primary" title="Add expense category" onClick={() => setShowCategoryModal(true)}><i className="bi bi-plus-lg" /></button></div></div><div className="col-6"><label className="form-label">Amount *</label><input type="number" min="0" className="form-control" value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} /></div><div className="col-6"><label className="form-label">Date *</label><DateInput className="form-control" value={expenseForm.date} onChange={e => setExpenseForm(p => ({ ...p, date: e.target.value }))} /></div><div className="col-12"><label className="form-label">Description *</label><textarea className="form-control" rows="3" value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))} /></div></div></div><div className="modal-footer"><button className="btn btn-outline-secondary" onClick={() => setShowExpenseModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveExpense} disabled={saving}>{saving ? 'Saving...' : 'Submit Expense'}</button></div></div></div></div>}
    {showCategoryModal && <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1060 }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title">Add Expense Category</h5><button className="btn-close" onClick={() => setShowCategoryModal(false)} /></div><div className="modal-body"><label className="form-label">Category Name *</label><input className="form-control" value={categoryName} onChange={e => setCategoryName(e.target.value)} maxLength={80} /></div><div className="modal-footer"><button className="btn btn-outline-secondary" onClick={() => setShowCategoryModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveCategory} disabled={saving}>{saving ? 'Saving...' : 'Add Category'}</button></div></div></div></div>}
    {showBudgetModal && <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title">Add Monthly Budget Allocation</h5><button className="btn-close" onClick={() => setShowBudgetModal(false)} /></div><div className="modal-body"><div className="row g-3"><div className="col-6"><label className="form-label">Month</label><select className="form-select" value={budgetForm.month} onChange={e => setBudgetForm(p => ({ ...p, month: Number(e.target.value) }))}>{MONTHS.map((month, index) => <option value={index + 1} key={month}>{month}</option>)}</select></div><div className="col-6"><label className="form-label">Year</label><input type="number" className="form-control" value={budgetForm.year} onChange={e => setBudgetForm(p => ({ ...p, year: Number(e.target.value) }))} /></div><div className="col-12"><label className="form-label">Allocation Amount *</label><input type="number" min="0" className="form-control" value={budgetForm.allocated} onChange={e => setBudgetForm(p => ({ ...p, allocated: e.target.value }))} /><small className="text-muted">You can add partial allocations to the same month; they are added together.</small></div></div></div><div className="modal-footer"><button className="btn btn-outline-secondary" onClick={() => setShowBudgetModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveBudget} disabled={saving}>{saving ? 'Saving...' : 'Add Allocation'}</button></div></div></div></div>}
  </AppShell>;
}
