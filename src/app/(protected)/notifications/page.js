'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, hasAccess } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import AppShell from '@/components/AppShell';
import Pagination from '@/components/Pagination';
import ConfirmModal from '@/components/ConfirmModal';
import DateInput from '@/components/DateInput';
import { NOTIF_ICONS, NOTIF_COLORS, getNotifRoute, NOTIFICATION_MODULES } from '@/lib/notifications-constants';

const MODULE_META = NOTIFICATION_MODULES.reduce((acc, m) => { acc[m.type] = m; return acc; }, {});

export default function NotificationsPage() {
  const { user } = useAuth();
  const { formatDateTime } = useSettings();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [debouncedFrom, setDebouncedFrom] = useState('');
  const [debouncedTo, setDebouncedTo] = useState('');
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const pageSize = 20;

  useEffect(() => { setCurrentPage(1); }, [filterFrom, filterTo, filterModule]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedFrom(filterFrom);
      setDebouncedTo(filterTo);
    }, 300);
    return () => clearTimeout(t);
  }, [filterFrom, filterTo]);

  const showToast = (msg, type = 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedFrom) params.set('from', debouncedFrom);
      if (debouncedTo) params.set('to', debouncedTo);
      if (filterModule) params.set('module', filterModule);
      params.set('page', currentPage);
      params.set('limit', pageSize);
      const d = await api.get(`/api/notifications?${params}`);
      if (d && Array.isArray(d.notifications)) {
        setNotifications(d.notifications);
        setTotal(d.total);
        setPages(d.pages);
      } else {
        setNotifications(Array.isArray(d) ? d : []);
        setTotal(Array.isArray(d) ? d.length : 0);
        setPages(1);
      }
    } catch (e) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user, debouncedFrom, debouncedTo, filterModule, currentPage]);

  const handleRowClick = async (n) => {
    if (!n.read) {
      setNotifications(prev => prev.map(item => item._id === n._id ? { ...item, read: true } : item));
      await api.patch('/api/notifications', { id: n._id }).catch(() => {});
    }
    const route = getNotifRoute(n, user?.role);
    if (route) router.push(route);
  };

  const markAllRead = async () => {
    await api.patch('/api/notifications', {}).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete('/api/notifications', { id: deleteTarget._id });
      const newTotal = Math.max(0, total - 1);
      setNotifications(prev => prev.filter(n => n._id !== deleteTarget._id));
      setTotal(newTotal);
      setPages(Math.max(1, Math.ceil(newTotal / pageSize)));
      showToast('Notification deleted', 'success');
      setDeleteTarget(null);
    } catch (e) {
      showToast(e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (user && !hasAccess(user.role, 'notifications')) return (
    <AppShell title="Notifications">
      <div className="empty-state"><i className="bi bi-lock" /><h6>Access Restricted</h6><p style={{ fontSize: 13, color: '#94a3b8' }}>You do not have access to notifications.</p></div>
    </AppShell>
  );

  const unreadCount = notifications.filter(n => !n.read).length;
  const readCount = notifications.filter(n => n.read).length;

  return (
    <AppShell title="Notifications">
      {toast && <div className="toast-container-custom"><div className={`toast-custom ${toast.type}`}><i className="bi bi-exclamation-circle me-2" />{toast.msg}</div></div>}

      <div className="page-header">
        <div><h4>Notifications</h4><p>Stay updated with alerts across all HRMS modules</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline-secondary" onClick={load}><i className="bi bi-arrow-clockwise me-2" />Refresh</button>
          <button className="btn btn-primary" onClick={markAllRead}><i className="bi bi-check2-all me-2" />Mark all read</button>
        </div>
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Total', value: total, color: '#3b82f6' },
          { label: 'Unread', value: unreadCount, color: '#ef4444' },
          { label: 'Read', value: readCount, color: '#10b981' },
        ].map((s, i) => (
          <div key={i} className="col-6 col-xl-4">
            <div className="stat-card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-3 mb-3">
        <div className="row g-2">
          <div className="col-md-3">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>From</label>
            <DateInput value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
          </div>
          <div className="col-md-3">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>To</label>
            <DateInput value={filterTo} onChange={e => setFilterTo(e.target.value)} min={filterFrom || undefined} />
          </div>
          <div className="col-md-4">
            <label className="form-label" style={{ fontSize: 12, fontWeight: 600 }}>Module</label>
            <select className="form-select" style={{ fontSize: 13 }} value={filterModule} onChange={e => setFilterModule(e.target.value)}>
              <option value="">All Modules</option>
              {NOTIFICATION_MODULES.map(m => <option key={m.type} value={m.type}>{m.label}</option>)}
            </select>
          </div>
          <div className="col-md-2 d-flex align-items-end">
            <button className="btn btn-outline-secondary w-100" style={{ fontSize: 13 }} onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterModule(''); }}>Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner-border text-primary" /></div>
        ) : notifications.length === 0 ? (
          <div className="empty-state"><i className="bi bi-bell-slash" /><h6>No notifications found</h6></div>
        ) : (
          <>
            <div className="table-responsive d-none d-md-block">
              <table className="table mb-0">
                <thead><tr><th>Type</th><th>Title / Message</th><th>Module</th><th>When</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                <tbody>
                  {notifications.map(n => {
                    const meta = MODULE_META[n.type];
                    const icon = NOTIF_ICONS[n.type] || 'bi-bell';
                    const color = NOTIF_COLORS[n.type] || '#3b82f6';
                    return (
                      <tr key={n._id} onClick={() => handleRowClick(n)} style={{ cursor: getNotifRoute(n, user?.role) ? 'pointer' : 'default' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <i className={`bi ${icon}`} style={{ color, fontSize: 14 }} />
                            </div>
                            {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 700 }}>{n.title}</div>
                          <div style={{ fontSize: 12, color: '#64748b', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                        </td>
                        <td><span className="badge" style={{ background: (meta?.color || '#64748b') + '20', color: meta?.color || '#64748b' }}>{meta?.label || n.type}</span></td>
                        <td style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{formatDateTime(n.createdAt)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-sm btn-outline-danger" onClick={e => { e.stopPropagation(); setDeleteTarget(n); }} style={{ padding: '4px 8px', fontSize: 12 }} title="Delete">
                            <i className="bi bi-trash" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="d-md-none">
              {notifications.map(n => {
                const meta = MODULE_META[n.type];
                const icon = NOTIF_ICONS[n.type] || 'bi-bell';
                const color = NOTIF_COLORS[n.type] || '#3b82f6';
                return (
                  <div key={n._id} className="p-3" style={{ borderBottom: '1px solid #f1f5f9', background: n.read ? 'transparent' : '#f0f9ff', cursor: getNotifRoute(n, user?.role) ? 'pointer' : 'default' }} onClick={() => handleRowClick(n)}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={`bi ${icon}`} style={{ color, fontSize: 14 }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 700 }}>{n.title}</div>
                          {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: 4 }} />}
                        </div>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{n.message}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                          <span className="badge" style={{ background: (meta?.color || '#64748b') + '20', color: meta?.color || '#64748b' }}>{meta?.label || n.type}</span>
                          <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{formatDateTime(n.createdAt)}</span>
                        </div>
                      </div>
                      <button className="btn btn-sm btn-outline-danger" onClick={e => { e.stopPropagation(); setDeleteTarget(n); }} style={{ padding: '3px 7px', fontSize: 11, flexShrink: 0 }} title="Delete">
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <Pagination currentPage={currentPage} totalPages={pages} onPageChange={setCurrentPage} totalItems={total} pageSize={pageSize} />
          </>
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Notification"
        confirmText="Delete"
        variant="danger"
        confirming={deleting}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      >
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Are you sure you want to delete this notification? This action cannot be undone.</p>
      </ConfirmModal>
    </AppShell>
  );
}
