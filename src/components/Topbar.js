'use client';
import { useState, useEffect } from 'react';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from '@/lib/auth';
import { api } from '@/lib/api';

export default function Topbar({ title, onMenuClick }) {
  const { user } = useAuth();
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    api.get('/api/announcements')
      .then(d => setNotifications((d.announcements || []).slice(0, 4)))
      .catch(() => {});
  }, []);

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
          <button className="topbar-icon-btn" onClick={() => { setShowNotif(p => !p); setShowProfile(false); }}>
            <i className="bi bi-bell" />
            <span className="badge-dot" />
          </button>
          {showNotif && (
            <div className="dropdown-panel" style={{ right: 0, width: 320 }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>Notifications</span>
                <span style={{ fontSize: 11, color: '#3b82f6', cursor: 'pointer' }}>Mark all read</span>
              </div>
              {notifications.length === 0 && <div style={{ padding: '16px', fontSize: 13, color: '#94a3b8', textAlign: 'center' }}>No announcements</div>}
              {notifications.map(n => (
                <div key={n._id} className="notif-item">
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: (n.tagColor || '#3b82f6') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className="bi bi-megaphone" style={{ color: n.tagColor || '#3b82f6', fontSize: 14 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: '#1e293b', lineHeight: 1.4 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{new Date(n.createdAt).toLocaleDateString()}</div>
                  </div>
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
