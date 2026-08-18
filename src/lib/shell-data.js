'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

const ShellDataContext = createContext(null);

export function ShellDataProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [newsAnnouncements, setNewsAnnouncements] = useState([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [employeeProfileId, setEmployeeProfileId] = useState(null);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setNewsAnnouncements([]);
      setPendingRequests(0);
      setEmployeeProfileId(null);
      return;
    }

    let cancelled = false;

    const loadNotifications = () => api.get('/api/notifications')
      .then(data => { if (!cancelled) setNotifications(Array.isArray(data) ? data : []); })
      .catch(() => {});

    const loadPendingRequests = () => {
      if (!['super_admin', 'admin_full'].includes(user.role)) {
        if (!cancelled) setPendingRequests(0);
        return Promise.resolve();
      }
      return api.get('/api/core/self-service-requests?status=pending')
        .then(data => { if (!cancelled) setPendingRequests(Array.isArray(data?.requests) ? data.requests.length : 0); })
        .catch(() => {});
    };

    const loadAnnouncements = () => api.get('/api/announcements')
      .then(data => {
        if (cancelled) return;
        const cutoff = Date.now() - (24 * 60 * 60 * 1000);
        const announcements = Array.isArray(data?.announcements) ? data.announcements : [];
        setNewsAnnouncements(announcements
          .filter(announcement => new Date(announcement.createdAt).getTime() >= cutoff)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      })
      .catch(() => { if (!cancelled) setNewsAnnouncements([]); });

    void Promise.all([loadNotifications(), loadPendingRequests(), loadAnnouncements()]);
    api.get('/api/employees/me')
      .then(data => { if (!cancelled) setEmployeeProfileId(data?.employeeId || null); })
      .catch(() => {});

    const interval = setInterval(() => {
      void Promise.all([loadNotifications(), loadPendingRequests(), loadAnnouncements()]);
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  const value = useMemo(() => ({
    notifications,
    setNotifications,
    newsAnnouncements,
    pendingRequests,
    employeeProfileId,
  }), [notifications, newsAnnouncements, pendingRequests, employeeProfileId]);

  return <ShellDataContext.Provider value={value}>{children}</ShellDataContext.Provider>;
}

export function useShellData() {
  const value = useContext(ShellDataContext);
  if (!value) throw new Error('useShellData must be used inside ShellDataProvider');
  return value;
}
