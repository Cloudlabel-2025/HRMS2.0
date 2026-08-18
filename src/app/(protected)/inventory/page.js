'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';

const STATUS_STYLE = {
  assigned: { bg: '#dbeafe', color: '#2563eb' },
  available: { bg: '#dcfce7', color: '#16a34a' },
  maintenance: { bg: '#fef3c7', color: '#d97706' },
  repair: { bg: '#fef3c7', color: '#d97706' },
  damaged: { bg: '#fee2e2', color: '#dc2626' },
  retired: { bg: '#f1f5f9', color: '#64748b' },
};
const CONDITIONS = ['New', 'Good', 'Fair', 'Repair', 'Damaged', 'Obsolete', 'In Maintenance'];
const EMPTY_STOCK = { item: '', category: '', stock: '', reorderAt: '5', unit: 'PCS', unitPrice: '' };
const RETURN_STATUSES = ['available', 'maintenance', 'repair', 'damaged', 'retired'];

export default function InventoryPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('assets');
  const [assets, setAssets] = useState([]);
  const [stock, setStock] = useState([]);
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(null);
  const [editingCondition, setEditingCondition] = useState(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [stockForm, setStockForm] = useState(EMPTY_STOCK);
  const [assignTo, setAssignTo] = useState('');
  const [assignStockId, setAssignStockId] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnStatus, setReturnStatus] = useState('available');
  const [returnCondition, setReturnCondition] = useState('Good');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [assetsPage, setAssetsPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setAssetsPage(1);
    setStockPage(1);
  }, [tab, search]);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const isAdmin = ['super_admin', 'admin_full'].includes(user?.role);

  const loadCategories = async () => {
    try {
      const cat = await api.get('/api/settings?type=categories');
      setCategories(Array.isArray(cat) ? cat : []);
    } catch {}
  };

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

  useEffect(() => { if (user) { load(); loadCategories(); } }, [user]);

  const saveStock = async () => {
    if (!stockForm.item) return showToast('Item name required', 'error');
    if (!stockForm.stock) return showToast('Current stock required', 'error');
    if (!stockForm.reorderAt) return showToast('Reorder at required', 'error');
    if (stockForm.unitPrice === '') return showToast('Unit price required', 'error');
    setSaving(true);
    try {
      await api.post('/api/inventory', { ...stockForm, type: 'stock', stock: +stockForm.stock, reorderAt: +stockForm.reorderAt, unitPrice: +stockForm.unitPrice });
      showToast('Stock updated');
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
    if (!showAssignModal) return;
    if (showAssignModal.mode === 'assign' && (!assignTo || !assignStockId)) return showToast('Select an employee and stock item', 'error');
    if (showAssignModal.mode === 'reassign' && !assignTo) return showToast('Select an employee', 'error');
    if (['return', 'replace'].includes(showAssignModal.mode) && !returnReason.trim()) return showToast('Return reason is required', 'error');
    if (showAssignModal.mode === 'replace' && !assignStockId) return showToast('Select the replacement stock item', 'error');
    setSaving(true);
    try {
      if (showAssignModal.mode === 'assign') {
        await api.post('/api/inventory', { action: 'assign', stockId: assignStockId, employeeId: assignTo });
        showToast('Asset assigned and asset ID created');
      } else if (showAssignModal.mode === 'reassign') {
        await api.put('/api/inventory', { action: 'reassign', assetId: showAssignModal.asset._id, employeeId: assignTo });
        showToast(`Asset ${showAssignModal.asset.assetId} assigned`);
      } else if (showAssignModal.mode === 'make_available') {
        await api.put('/api/inventory', { action: 'make_available', assetId: showAssignModal.asset._id, condition: returnCondition });
        showToast('Asset is now available for assignment');
      } else if (showAssignModal.mode === 'return') {
        await api.put('/api/inventory', { action: 'return', assetId: showAssignModal.asset._id, returnReason, condition: returnCondition, status: returnStatus });
        showToast('Asset returned');
      } else if (showAssignModal.mode === 'replace') {
        await api.put('/api/inventory', { action: 'replace', oldAssetId: showAssignModal.asset._id, stockId: assignStockId, returnReason, condition: returnCondition, status: returnStatus });
        showToast('Asset replaced and new asset ID created');
      }
      setShowAssignModal(null);
      setAssignTo('');
      setAssignStockId('');
      setReturnReason('');
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
            <button className="btn btn-primary" onClick={() => { setShowAssignModal({ mode: 'assign' }); setAssignTo(''); setAssignStockId(''); }}><i className="bi bi-person-plus me-2" />Assign Item</button>
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
                    <thead><tr><th>Asset ID</th><th>Name</th><th>Category</th><th>Assigned To</th><th>Status</th><th>Condition</th><th>Unit Cost</th>{isAdmin && <th>Actions</th>}</tr></thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={7}><div className="empty-state"><i className="bi bi-box-seam" /><h6>No assets found</h6></div></td></tr>
                      ) : filtered.slice((assetsPage - 1) * pageSize, assetsPage * pageSize).map(a => (
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
                          <td>{editingCondition?.id === a._id ? (
                            <select className="form-select" style={{ fontSize: 12, padding: '2px 6px', width: 140 }} defaultValue={a.condition} autoFocus
                              onBlur={e => {
                                const val = e.target.value;
                                if (val !== editingCondition.original) {
                                  api.put('/api/inventory', { id: a._id, condition: val }).then(() => {
                                    setAssets(prev => prev.map(x => x._id === a._id ? { ...x, condition: val } : x));
                                  }).catch(() => {});
                                }
                                setEditingCondition(null);
                              }}
                              onKeyDown={e => e.key === 'Enter' && e.target.blur()}>
                              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (
                            <span className="badge" style={{ background: '#f0fdf4', color: '#16a34a', textTransform: 'capitalize', cursor: isAdmin ? 'pointer' : 'default' }}
                              onClick={() => isAdmin && setEditingCondition({ id: a._id, original: a.condition })}>
                              {a.condition}
                            </span>
                          )}</td>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>₹{(a.value || 0).toLocaleString('en-IN')}</td>
                          {isAdmin && <td>{a.status === 'assigned' ? <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setShowAssignModal({ mode: 'manage', asset: a })}>Manage</button> : a.status === 'available' ? <button className="btn btn-sm btn-outline-primary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setAssignTo(''); setShowAssignModal({ mode: 'reassign', asset: a }); }}>Assign</button> : ['maintenance', 'repair'].includes(a.status) ? <button className="btn btn-sm btn-outline-success" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setReturnCondition('Good'); setShowAssignModal({ mode: 'make_available', asset: a }); }}>Mark Available</button> : <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 0 && (
                  <Pagination
                    currentPage={assetsPage}
                    totalPages={Math.ceil(filtered.length / pageSize)}
                    onPageChange={setAssetsPage}
                    totalItems={filtered.length}
                    pageSize={pageSize}
                  />
                )}
              </div>
            </>
          )}

          {tab === 'stock' && (
            <div className="card">
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead><tr><th>Item</th><th>Category</th><th>Available Stock</th><th>Unit Price</th><th>Total Value</th><th>Reorder Level</th><th>UOM</th><th>Status</th></tr></thead>
                  <tbody>
                    {stock.length === 0 ? (
                      <tr><td colSpan={5}><div className="empty-state"><i className="bi bi-box-seam" /><h6>No stock items</h6></div></td></tr>
                    ) : stock.slice((stockPage - 1) * pageSize, stockPage * pageSize).map(s => {
                      const low = s.stock <= s.reorderAt;
                      return (
                        <tr key={s._id}>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>{s.item}</td>
                          <td><span className="badge" style={{ background: '#f1f5f9', color: '#64748b' }}>{s.category}</span></td>
                          <td><span style={{ fontSize: 14, fontWeight: 800, color: low ? '#ef4444' : '#10b981' }}>{s.stock}</span></td>
                          <td style={{ fontSize: 13, fontWeight: 600 }}>₹{(s.unitPrice || 0).toLocaleString('en-IN')}</td>
                          <td style={{ fontSize: 13, fontWeight: 700 }}>₹{((s.stock || 0) * (s.unitPrice || 0)).toLocaleString('en-IN')}</td>
                          <td style={{ fontSize: 13, color: '#64748b' }}>{s.reorderAt}</td>
                          <td><span className="badge" style={{ background: '#f0fdf4', color: '#16a34a', fontSize: 11 }}>{s.unit}</span></td>
                          <td>{low ? <span className="badge status-rejected"><i className="bi bi-exclamation-triangle me-1" />Reorder</span> : <span className="badge status-approved">OK</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {stock.length > 0 && (
                <Pagination
                  currentPage={stockPage}
                  totalPages={Math.ceil(stock.length / pageSize)}
                  onPageChange={setStockPage}
                  totalItems={stock.length}
                  pageSize={pageSize}
                />
              )}
            </div>
          )}
        </>
      )}

      {false && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Asset</h5><button className="btn-close" onClick={() => setShowAssetModal(false)} /></div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Asset ID</label><input className="form-control" value={assetForm.assetId} disabled style={{ background: '#f1f5f9' }} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Name *</label><input className="form-control" value={assetForm.name} onChange={e => {
                    const v = e.target.value.slice(0, 30);
                    setAssetForm(p => ({ ...p, name: v }));
                  }} /><div style={{ fontSize: 11, color: assetForm.name.length >= 25 ? '#dc2626' : '#94a3b8', textAlign: 'right', marginTop: 2 }}>{assetForm.name.length}/30</div></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Value (₹)</label><input type="text" inputMode="numeric" className="form-control" value={assetForm.value} onChange={e => {
                    const raw = e.target.value;
                    if (raw === '' || (/^\d{1,6}$/.test(raw))) setAssetForm(p => ({ ...p, value: raw }));
                  }} /></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category</label><div style={{ display: 'flex', gap: 6 }}><select className="form-select" value={assetForm.category} onChange={e => setAssetForm(p => ({ ...p, category: e.target.value }))}><option value="">— Select —</option>{categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}</select><button type="button" className="btn btn-outline-secondary" style={{ flexShrink: 0, padding: '6px 10px' }} onClick={() => { setNewCategoryName(''); setShowCategoryModal(true); }} title="Add category"><i className="bi bi-plus-lg" /></button></div></div>
                  <div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Condition</label><select className="form-select" value={assetForm.condition} onChange={e => setAssetForm(p => ({ ...p, condition: e.target.value }))}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div>
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
                  <div className="col-12">
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Item Name *</label>
                    <input className="form-control" value={stockForm.item} onChange={e => {
                      const v = e.target.value.slice(0, 30);
                      setStockForm(p => ({ ...p, item: v }));
                    }} />
                    <div style={{ fontSize: 11, color: stockForm.item.length >= 25 ? '#dc2626' : '#94a3b8', textAlign: 'right', marginTop: 2 }}>{stockForm.item.length}/30</div>
                  </div>
                  <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category</label><div style={{ display: 'flex', gap: 6 }}><select className="form-select" value={stockForm.category} onChange={e => setStockForm(p => ({ ...p, category: e.target.value }))}><option value="">Uncategorized</option>{categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}</select><button type="button" className="btn btn-outline-secondary" style={{ flexShrink: 0, padding: '6px 10px' }} onClick={() => { setNewCategoryName(''); setShowCategoryModal(true); }} title="Add category"><i className="bi bi-plus-lg" /></button></div></div>
                  {[['Current Stock', 'stock'], ['Reorder At', 'reorderAt']].map(([label, key]) => (
                    <div key={key} className="col-4"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{label}</label><input type="text" inputMode="numeric" className="form-control" value={stockForm[key]} onChange={e => {
                      const raw = e.target.value;
                      if (raw === '' || (/^\d{1,3}$/.test(raw) && parseInt(raw, 10) <= 999)) setStockForm(p => ({ ...p, [key]: raw }));
                    }} /></div>
                  ))}
                  <div className="col-4"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Unit Price (₹)</label><input type="number" min="0" className="form-control" value={stockForm.unitPrice} onChange={e => setStockForm(p => ({ ...p, unitPrice: e.target.value }))} /></div>
                  <div className="col-12" style={{ fontSize: 13, color: '#475569' }}>Total purchase value: <strong>₹{((Number(stockForm.stock) || 0) * (Number(stockForm.unitPrice) || 0)).toLocaleString('en-IN')}</strong></div>
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

      {showCategoryModal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-sm">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">Add Category</h5><button className="btn-close" onClick={() => setShowCategoryModal(false)} /></div>
              <div className="modal-body">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Category Name</label>
                <input className="form-control" placeholder="e.g. Laptop" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowCategoryModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => {
                  if (!newCategoryName.trim()) return;
                  setSaving(true);
                  try {
                    const cat = await api.post('/api/settings', { type: 'categories', name: newCategoryName.trim() });
                    setCategories(prev => [...prev, cat]);
                    setStockForm(p => ({ ...p, category: cat.name }));
                    setShowCategoryModal(false);
                    setNewCategoryName('');
                    showToast('Category added');
                  } catch (e) {
                    showToast(e.message, 'error');
                  } finally {
                    setSaving(false);
                  }
                }} disabled={saving || !newCategoryName.trim()}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-2" />Adding...</> : 'Add'}
                </button>
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
                {showAssignModal.mode === 'manage' ? <div className="d-flex gap-2"><button className="btn btn-outline-primary flex-fill" onClick={() => { setReturnReason(''); setReturnStatus('available'); setReturnCondition(showAssignModal.asset.condition || 'Good'); setShowAssignModal({ mode: 'return', asset: showAssignModal.asset }); }}>Return</button><button className="btn btn-primary flex-fill" onClick={() => { setReturnReason(''); setReturnStatus('available'); setReturnCondition(showAssignModal.asset.condition || 'Good'); setAssignStockId(''); setShowAssignModal({ mode: 'replace', asset: showAssignModal.asset }); }}>Replace</button></div> : <div className="row g-3">
                  {['assign', 'reassign'].includes(showAssignModal.mode) && <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Employee</label><select className="form-select" value={assignTo} onChange={e => setAssignTo(e.target.value)}><option value="">Select employee</option>{employees.filter(e => e.userId).map(e => <option key={e._id} value={e.userId}>{e.name}</option>)}</select></div>}
                  {['assign', 'replace'].includes(showAssignModal.mode) && <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>{showAssignModal.mode === 'replace' ? 'Replacement item' : 'Stock item'}</label><select className="form-select" value={assignStockId} onChange={e => setAssignStockId(e.target.value)}><option value="">Select available stock</option>{stock.filter(s => s.stock > 0).map(s => <option key={s._id} value={s._id}>{s.item} — {s.stock} available — ₹{(s.unitPrice || 0).toLocaleString('en-IN')} each</option>)}</select></div>}
                  {['return', 'replace'].includes(showAssignModal.mode) && <><div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Return reason</label><textarea className="form-control" rows="2" value={returnReason} onChange={e => setReturnReason(e.target.value)} /></div><div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Condition</label><select className="form-select" value={returnCondition} onChange={e => setReturnCondition(e.target.value)}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div><div className="col-6"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Next status</label><select className="form-select" value={returnStatus} onChange={e => setReturnStatus(e.target.value)}>{RETURN_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</select><div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Only Available adds one unit back to stock.</div></div></>}
                  {showAssignModal.mode === 'make_available' && <div className="col-12"><label className="form-label" style={{ fontSize: 13, fontWeight: 600 }}>Condition after repair</label><select className="form-select" value={returnCondition} onChange={e => setReturnCondition(e.target.value)}>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div>}
                </div>}
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline-secondary" onClick={() => setShowAssignModal(null)}>Cancel</button>
                {showAssignModal.mode !== 'manage' && <button className="btn btn-primary" onClick={assignAsset} disabled={saving}>{saving ? <><span className="spinner-border spinner-border-sm me-2" />Saving...</> : showAssignModal.mode === 'assign' || showAssignModal.mode === 'reassign' ? 'Assign' : showAssignModal.mode === 'replace' ? 'Replace' : showAssignModal.mode === 'make_available' ? 'Mark Available' : 'Return'}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
