'use client';
import { useState, useEffect, useRef } from 'react';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';

const NOTIF_ICONS = { leave: 'bi-calendar-check', attendance: 'bi-clock', general: 'bi-bell' };
const NOTIF_COLORS = { leave: '#10b981', attendance: '#f59e0b', general: '#3b82f6' };

export default function Topbar({ title, onMenuClick }) {
  const { user } = useAuth();
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const pollRef = useRef(null);

  const loadNotifs = () => {
    api.get('/api/notifications')
      .then(d => setNotifications(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffect(() => {
    if (!user) return;
    loadNotifs();
    pollRef.current = setInterval(loadNotifs, 10000);
    return () => clearInterval(pollRef.current);
  }, [user]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = async () => {
    await api.patch('/api/notifications', {}).catch(() => {});
    setNotifications(p => p.map(n => ({ ...n, read: true })));
  };

  const markRead = async (id) => {
    await api.patch('/api/notifications', { id }).catch(() => {});
    setNotifications(p => p.map(n => n._id === id ? { ...n, read: true } : n));
  };

  if (!user) return null;

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="topbar-icon-btn d-md-none" onClick={onMenuClick} style={{ border: 'none' }}>
          <i className="bi bi-list" style={{ fontSize: 20 }} />
        </button>
        <span className="topbar-title">{title}</span>
      </div>

      <div className="topbar-right">
        <div className="topbar-search d-none d-md-flex">
          <i className="bi bi-search" style={{ color: '#94a3b8', fontSize: 13 }} />
          <input placeholder="Search..." />
        </div>

        <div style={{ position: 'relative' }}>
          <button className="topbar-icon-btn" onClick={() => { setShowNotif(p => !p); setShowProfile(false); if (!showNotif) loadNotifs(); }}>
            <i className="bi bi-bell" />
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {showNotif && (
            <div className="dropdown-panel" style={{ right: 0, width: 320 }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications {unreadCount > 0 && <span style={{ background: '#ef444420', color: '#ef4444', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>{unreadCount} new</span>}</span>
                {unreadCount > 0 && <span style={{ fontSize: 11, color: '#3b82f6', cursor: 'pointer' }} onClick={markAllRead}>Mark all read</span>}
              </div>
              {notifications.length === 0 && <div style={{ padding: '20px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}><i className="bi bi-bell-slash d-block mb-2" style={{ fontSize: 24 }} />No notifications</div>}
              {notifications.slice(0, 8).map(n => (
                <div key={n._id} className="notif-item" onClick={() => markRead(n._id)}
                  style={{ background: n.read ? 'transparent' : '#f0f9ff', cursor: 'pointer' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: (NOTIF_COLORS[n.type] || '#3b82f6') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className={`bi ${NOTIF_ICONS[n.type] || 'bi-bell'}`} style={{ color: NOTIF_COLORS[n.type] || '#3b82f6', fontSize: 14 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: '#1e293b', fontWeight: n.read ? 400 : 600, lineHeight: 1.4 }}>{n.title}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.message}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
                  </div>
                  {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, marginTop: 4 }} />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <div className="avatar" onClick={() => { setShowProfile(p => !p); setShowNotif(false); }}
            style={{ background: `linear-gradient(135deg, ${ROLE_COLORS[user.role]}, #1e293b)` }}>
            {user.avatar}
          </div>
          {showProfile && (
            <div className="dropdown-panel" style={{ right: 0, width: 220 }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{user.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{user.email}</div>
                <span className="badge mt-1" style={{ background: ROLE_COLORS[user.role] + '20', color: ROLE_COLORS[user.role], fontSize: 10 }}>
                  {ROLE_LABELS[user.role]}
                </span>
              </div>
              <div style={{ padding: '8px' }}>
                <button className="nav-item-link" style={{ color: '#64748b', fontSize: 13 }}>
                  <i className="bi bi-person" /> My Profile
                </button>
                <button className="nav-item-link" style={{ color: '#64748b', fontSize: 13 }}>
                  <i className="bi bi-gear" /> Settings
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
