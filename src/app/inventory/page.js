'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';

const STATUS_STYLE = {
  assigned: { bg: '#dbeafe', color: '#2563eb' },
  available: { bg: '#dcfce7', color: '#16a34a' },
  maintenance: { bg: '#fef3c7', color: '#d97706' },
};
const CATS = ['Laptop', 'Mobile', 'Monitor', 'Printer', 'Tablet', 'Peripheral', 'Furniture', 'Other'];
const EMPTY_ASSET = { assetId: '', name: '', category: 'Laptop', status: 'available', condition: 'good', value: '' };
const EMPTY_STOCK = { item: '', category: 'Stationery', stock: '', reorderAt: '5', unit: 'units' };

export default function InventoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('assets');
  const [assets, setAssets] = useState([]);
  const [stock, setStock] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(null);
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET);
  const [stockForm, setStockForm] = useState(EMPTY_STOCK);
  const [assignTo, setAssignTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const [a, s, e] = await Promise.all([
        api.get('/api/inventory?type=assets'),
        api.get('/api/inventory?type=stock'),
        isAdmin ? api.get('/api/employees') : Promise.resolve([]),
      ]);
      setAssets(Array.isArray(a?.assets) ? a.assets : []);
      setStock(Array.isArray(s?.stock) ? s.stock : []);
      setEmployees(Array.isArray(e) ? e : []);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const saveAsset = async () => {
    if (!assetForm.assetId || !assetForm.name) return showToast('Asset ID and name required', 'error');
    setSaving(true);
    try {
      await api.post('/api/inventory', { ...assetForm, value: +assetForm.value || 0 });
      showToast('Asset added');
      setShowAssetModal(false);
      setAssetForm(EMPTY_ASSET);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveStock = async () => {
    if (!stockForm.item) return showToast('Item name required', 'error');
    setSaving(true);
    try {
      await api.post('/api/inventory', { ...stockForm, type: 'stock', stock: +stockForm.stock || 0, reorderAt: +stockForm.reorderAt || 5 });
      showToast('Stock item added');
      setShowStockModal(false);
      setStockForm(EMPTY_STOCK);
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const assignAsset = async () => {
    setSaving(true);
    try {
      await api.put('/api/inventory', { id: showAssignModal._id, assignedTo: assignTo || null, status: assignTo ? 'assigned' : 'available', assignedOn: assignTo ? new Date().toISOString().split('T')[0] : null });
      showToast('Asset updated');
      setShowAssignModal(null);
      setAssignTo('');
      load();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = assets.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.category?.toLowerCase().includes(search.toLowerCase()) ||
    (a.assignedTo?.name || '').toLowerCase().includes(search.toLowerCase())
  );

  const lowStock = stock.filter(s => s.stock <= s.reorderAt);

  return (
    <AppShell title="Inventory">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className={`bi ${toast.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'} me-2`} />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Inventory Management</h4><p>Assets, stock levels, and assignment tracking</p></div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline-primary" onClick={() => setShowStockModal(true)}><i className="bi bi-plus-lg me-2" />Add Stock</button>
            <button className="btn btn-primary" onClick={() => setShowAssetModal(true)}><i className="bi bi-plus-lg me-2" />Add Asset</button>
          </div>
        )}
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Total Assets', value: assets.length, color: '#3b82f6', icon: 'bi-box-seam' },
          { label: 'Assigned', value: assets.filter(a => a.status === 'assigned').length, color: '#10b981', icon: 'bi-person-check' },
          { label: 'Available', value: assets.filter(a => a.status === 'available').length, color: '#f59e0b', icon: 'bi-check-circle' },
          { label: 'Low Stock Items', value: lowStock.length, color: '#ef4444', icon: 'bi-exclamation-triangle' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-3">
            <div className="stat-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{s.label}</div><div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div></div>
                <div className="stat-icon" style={{ background: s.color + '15' }}><i className={`bi ${s.icon}`} style={{ color: s.color }} /></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {lowStock.length > 0 && (
        <div className="alert d-flex align-items-center gap-2 mb-3" style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10, fontSize: 13 }}>
          <i className="bi bi-exclamation-triangle text-danger" />
          <span><strong>{lowStock.length} item(s)</strong> at or below reorder level: {lowStock.map(s => s.item).join(', ')}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {['assets', 'stock'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#1e293b' : '#64748b', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {t === 'assets' ? 'Asset Register' : 'Stock Levels'}
          </button>
        ))}
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner-border text-primary" /></div> : (
        <>
          {tab === 'assets' && (
            <>
              <div className="mb-3">
                <div style={{ position: 'relative', width: 280 }}>
                  <i className="bi bi-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13 }} />
                  <input className="form-control" placeholder="Search assets..." style={{ paddingLeft: 32, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="card">
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr><th>Asset ID</th><th>Name</th><th>Category</th><th>Assigned To</th><th>Status</th><th>Value</th>{isAdmin && <th>Actions</th>}</tr></thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-box-seam" /><h6>No assets found</h6></div></td></tr>
                      ) : filtered.map(a => (
                        <tr key={a._id}>
                          <td style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6' }}>{a.assetId}</td>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</td>
                          <td><span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>{a.category}</span></td>
                          <td>
                            {a.assignedTo
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>{a.assignedTo.avatar}</div>
                                  <span style={{ fontSize: 12 }}>{a.assignedTo.name}</span>
                                </div>
                              : <span style={{ fontSize: 12, color: '#94a3b8' }}>Unassigned</span>}
                          </td>
                          <td><span className="badge" style={{ background: STATUS_STYLE[a.status]?.bg, color: STATUS_STYLE[a.status]?.color, textTransform: 'capitalize' }}>{a.status}</span></td>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>₹{(a.value || 0).toLocaleString('en-IN')}</td>
                          {isAdmin && <td><button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setShowAssignModal(a); setAssignTo(a.assignedTo?._id || ''); }}>{a.status === 'available' ? 'Assign' : 'Manage'}</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === 'stock' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Item</th><th>Category</th><th>Current Stock</th><th>Reorder Level</th><th>Status</th></tr></thead>
                  <tbody>
                    {stock.length === 0 ? (
                      <tr><td colSpan={5}><div className="empty-state"><i className="bi bi-box-seam" /><h6>No stock items</h6></div></td></tr>
                    ) : stock.map(s => {
                      const low = s.stock <= s.reorderAt;
                      return (
                        <tr key={s._id}>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>{s.item}</td>
                          <td><span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>{s.category}</span></td>
                          <td><span style={{ fontSize: 14, fontWeight: 800, color: low ? '#ef4444' : '#10b981' }}>{s.stock}</span><span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>{s.unit}</span></td>
                          <td style={{ fontSize: 13, color: '#64748b' }}>{s.reorderAt} {s.unit}</td>
                          <td>{low ? <span className="badge status-rejected"><i className="bi bi-exclamation-triangle me-1" />Reorder</span> : <span className="badge status-approved">OK</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showAssetModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Asset</h5><button className="btn-close" onClick={() => setShowAssetModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  {[['Asset ID *', 'assetId', 'text'], ['Name *', 'name', 'text'], ['Value (₹)', 'value', 'number']].map(([label, key, type]) => (
                    <div key={key} className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label><input type={type} className="form-control" value={assetForm[key]} onChange={e => setAssetForm(p => ({ ...p, [key]: e.target.value }))} /></div>
                  ))}
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category</label><select className="form-select" value={assetForm.category} onChange={e => setAssetForm(p => ({ ...p, category: e.target.value }))}>{CATS.map(c => <option key={c}>{c}</option>)}</select></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Condition</label><select className="form-select" value={assetForm.condition} onChange={e => setAssetForm(p => ({ ...p, condition: e.target.value }))}>{['good', 'fair', 'repair'].map(c => <option key={c}>{c}</option>)}</select></div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowAssetModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveAsset} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Add Asset'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showStockModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Stock Item</h5><button className="btn-close" onClick={() => setShowStockModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Item Name *</label><input className="form-control" value={stockForm.item} onChange={e => setStockForm(p => ({ ...p, item: e.target.value }))} /></div>
                  {[['Current Stock', 'stock', 'number'], ['Reorder At', 'reorderAt', 'number'], ['Unit', 'unit', 'text']].map(([label, key, type]) => (
                    <div key={key} className="col-4"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label><input type={type} className="form-control" value={stockForm[key]} onChange={e => setStockForm(p => ({ ...p, [key]: e.target.value }))} /></div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowStockModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveStock} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Add Item'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Manage Asset — {showAssignModal.name}</h5><button className="btn-close" onClick={() => setShowAssignModal(null)} /></div>
              <div className="modal-body">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Assign To (leave blank to unassign)</label>
                <select className="form-select" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                  <option value="">Unassigned</option>
                  {employees.map(e => <option key={e._id} value={e._id}>{e.name}</option>)}
                </select>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowAssignModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={assignAsset} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
