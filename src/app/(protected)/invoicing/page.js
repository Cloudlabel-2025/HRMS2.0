'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';
import { useSettings } from '@/lib/settings';

const EMPTY_INVOICE = { invoiceNo: '', client: '', amount: '', issued: '', due: '', status: 'draft' };
const EMPTY_CLIENT = { name: '', contactPerson: '', email: '', phone: '', address: '', gstin: '' };
const STATUSES = ['draft', 'sent', 'pending', 'paid', 'overdue'];
const statusStyle = { paid: ['#dcfce7', '#16a34a'], pending: ['#fef3c7', '#d97706'], sent: ['#dbeafe', '#2563eb'], overdue: ['#fee2e2', '#dc2626'], draft: ['#f1f5f9', '#64748b'] };
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;

export default function InvoicingPage() {
  const { user } = useAuth();
  const { formatDate } = useSettings();
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);
  const [tab, setTab] = useState('invoices');
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(EMPTY_INVOICE);
  const [clientForm, setClientForm] = useState(EMPTY_CLIENT);
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const notify = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const [invoiceData, clientData] = await Promise.all([api.get('/api/finance/invoices'), api.get('/api/finance/clients')]);
      setInvoices(Array.isArray(invoiceData?.invoices) ? invoiceData.invoices : []);
      setClients(Array.isArray(clientData?.clients) ? clientData.clients : []);
    } catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => setPage(1), [tab]);

  const saveInvoice = async () => {
    if (!invoiceForm.invoiceNo.trim() || !invoiceForm.client || !invoiceForm.amount) return notify('Invoice number, client, and amount are required', 'error');
    setSaving(true);
    try {
      await api.post('/api/finance/invoices', { ...invoiceForm, amount: Number(invoiceForm.amount) });
      setInvoiceForm(EMPTY_INVOICE); setShowInvoiceModal(false); notify('Invoice created'); load();
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };

  const saveClient = async () => {
    if (!clientForm.name.trim()) return notify('Client name is required', 'error');
    setSaving(true);
    try {
      const response = await api.post('/api/finance/clients', clientForm);
      const client = response?.client;
      if (client) { setClients(items => [...items, client].sort((a, b) => a.name.localeCompare(b.name))); setInvoiceForm(form => ({ ...form, client: client.name })); }
      setClientForm(EMPTY_CLIENT); setShowClientModal(false); notify('Client created');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSaving(false); }
  };

  const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
  const collected = invoices.filter(invoice => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amount, 0);
  const outstanding = invoices.filter(invoice => ['sent', 'pending', 'overdue'].includes(invoice.status)).reduce((sum, invoice) => sum + invoice.amount, 0);

  return <AppShell title="Invoices">
    {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.message}</div></div>}
    <div className="page-header"><div><h4>Invoices</h4><p>Create invoices and maintain your client directory</p></div>{isAdmin && <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-outline-primary" onClick={() => setShowClientModal(true)}><i className="bi bi-building-add me-2" />Add Client</button><button className="btn btn-primary" onClick={() => setShowInvoiceModal(true)}><i className="bi bi-plus-lg me-2" />New Invoice</button></div>}</div>
    <div className="row g-3 mb-4">{[['Total Invoiced', money(total), '#3b82f6', 'bi-receipt'], ['Collected', money(collected), '#10b981', 'bi-check-circle'], ['Outstanding', money(outstanding), '#f59e0b', 'bi-hourglass-split'], ['Clients', clients.length, '#8b5cf6', 'bi-buildings']].map(([label, value, color, icon]) => <div className="col-6 col-xl-3" key={label}><div className="stat-card"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{label}</div><div style={{ fontSize: 21, fontWeight: 800, color }}>{value}</div></div><div className="stat-icon" style={{ background: color + '15' }}><i className={`bi ${icon}`} style={{ color }} /></div></div></div></div>)}</div>
    <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>{[['invoices', 'Invoices'], ['clients', 'Clients']].map(([key, label]) => <button key={key} onClick={() => setTab(key)} style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === key ? '#fff' : 'transparent', color: tab === key ? '#1e293b' : '#64748b', boxShadow: tab === key ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>{label}</button>)}</div>
    {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : tab === 'invoices' ? <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Invoice #</th><th>Client</th><th>Amount</th><th>Issued</th><th>Due Date</th><th>Status</th></tr></thead><tbody>{invoices.length ? invoices.slice((page - 1) * pageSize, page * pageSize).map(invoice => { const colors = statusStyle[invoice.status] || statusStyle.draft; return <tr key={invoice._id}><td style={{ color: '#2563eb', fontWeight: 700 }}>{invoice.invoiceNo}</td><td style={{ fontWeight: 600 }}>{invoice.client}</td><td style={{ fontWeight: 700 }}>{money(invoice.amount)}</td><td>{invoice.issued ? formatDate(invoice.issued) : '—'}</td><td style={{ color: invoice.status === 'overdue' ? '#dc2626' : undefined }}>{invoice.due ? formatDate(invoice.due) : '—'}</td><td><span className="badge" style={{ background: colors[0], color: colors[1], textTransform: 'capitalize' }}>{invoice.status}</span></td></tr>; }) : <tr><td colSpan={6}><div className="empty-state"><i className="bi bi-receipt" /><h6>No invoices yet</h6></div></td></tr>}</tbody></table></div>{invoices.length > pageSize && <Pagination currentPage={page} totalPages={Math.ceil(invoices.length / pageSize)} onPageChange={setPage} totalItems={invoices.length} pageSize={pageSize} />}</div> : <div className="card"><div className="table-responsive"><table className="table mb-0"><thead><tr><th>Client</th><th>Contact Person</th><th>Email</th><th>Phone</th><th>GSTIN</th></tr></thead><tbody>{clients.length ? clients.slice((page - 1) * pageSize, page * pageSize).map(client => <tr key={client._id}><td style={{ fontWeight: 700 }}>{client.name}</td><td>{client.contactPerson || '—'}</td><td>{client.email || '—'}</td><td>{client.phone || '—'}</td><td>{client.gstin || '—'}</td></tr>) : <tr><td colSpan={5}><div className="empty-state"><i className="bi bi-buildings" /><h6>No clients yet</h6></div></td></tr>}</tbody></table></div>{clients.length > pageSize && <Pagination currentPage={page} totalPages={Math.ceil(clients.length / pageSize)} onPageChange={setPage} totalItems={clients.length} pageSize={pageSize} />}</div>}
    {showInvoiceModal && <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title">New Invoice</h5><button className="btn-close" onClick={() => setShowInvoiceModal(false)} /></div><div className="modal-body"><div className="row g-3"><div className="col-6"><label className="form-label">Invoice # *</label><input className="form-control" value={invoiceForm.invoiceNo} onChange={e => setInvoiceForm(form => ({ ...form, invoiceNo: e.target.value }))} /></div><div className="col-6"><label className="form-label">Amount *</label><input type="number" min="0" className="form-control" value={invoiceForm.amount} onChange={e => setInvoiceForm(form => ({ ...form, amount: e.target.value }))} /></div><div className="col-12"><label className="form-label">Client *</label><div style={{ display: 'flex', gap: 6 }}><select className="form-select" value={invoiceForm.client} onChange={e => setInvoiceForm(form => ({ ...form, client: e.target.value }))}><option value="">Select a client</option>{clients.map(client => <option value={client.name} key={client._id}>{client.name}</option>)}</select><button type="button" className="btn btn-outline-primary" title="Add client" onClick={() => setShowClientModal(true)}><i className="bi bi-plus-lg" /></button></div></div><div className="col-6"><label className="form-label">Issued Date</label><input type="date" className="form-control" value={invoiceForm.issued} onChange={e => setInvoiceForm(form => ({ ...form, issued: e.target.value }))} /></div><div className="col-6"><label className="form-label">Due Date</label><input type="date" className="form-control" value={invoiceForm.due} onChange={e => setInvoiceForm(form => ({ ...form, due: e.target.value }))} /></div><div className="col-6"><label className="form-label">Status</label><select className="form-select" value={invoiceForm.status} onChange={e => setInvoiceForm(form => ({ ...form, status: e.target.value }))}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></div></div></div><div className="modal-footer"><button className="btn btn-outline-secondary" onClick={() => setShowInvoiceModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveInvoice} disabled={saving}>{saving ? 'Saving...' : 'Create Invoice'}</button></div></div></div></div>}
    {showClientModal && <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}><div className="modal-dialog modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title">Add Client</h5><button className="btn-close" onClick={() => setShowClientModal(false)} /></div><div className="modal-body"><div className="row g-3">{[['Client Name *', 'name', 'text'], ['Contact Person', 'contactPerson', 'text'], ['Email', 'email', 'email'], ['Phone', 'phone', 'tel'], ['GSTIN', 'gstin', 'text']].map(([label, key, type]) => <div className="col-6" key={key}><label className="form-label">{label}</label><input type={type} className="form-control" value={clientForm[key]} onChange={e => setClientForm(form => ({ ...form, [key]: e.target.value }))} /></div>)}<div className="col-12"><label className="form-label">Address</label><textarea className="form-control" rows="2" value={clientForm.address} onChange={e => setClientForm(form => ({ ...form, address: e.target.value }))} /></div></div></div><div className="modal-footer"><button className="btn btn-outline-secondary" onClick={() => setShowClientModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveClient} disabled={saving}>{saving ? 'Saving...' : 'Save Client'}</button></div></div></div></div>}
  </AppShell>;
}
