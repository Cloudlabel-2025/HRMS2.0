'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, ROLE_LABELS, ROLE_COLORS, hasAccess, clearImpersonatedUser, isImpersonating } from '@/lib/auth';
import { api } from '@/lib/api';
import {
  cancelWorkProgressExportJob,
  executeWorkProgressExport,
  getWorkProgressExportJob,
  getWorkProgressExportRemaining,
  subscribeWorkProgressExport,
} from '@/lib/work-progress-export';

const formatExportTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const NAV_ITEMS = [
  { module: 'dashboard',     href: '/dashboard',     icon: 'bi-grid-1x2',              label: 'Dashboard',     section: 'MAIN' },
  { module: 'employees',     href: '/employees',     icon: 'bi-people',                label: 'Employees',     section: 'PEOPLE' },
  { module: 'recruitment',   href: '/recruitment',   icon: 'bi-person-plus',           label: 'Recruitment',   section: 'PEOPLE' },
  { module: 'attendance',    href: '/attendance',    icon: 'bi-clock',                 label: 'Attendance',    section: 'TIME' },
  { module: 'absence',       href: '/absence',       icon: 'bi-calendar-x',            label: 'Absence',       section: 'TIME' },
  { module: 'leave',         href: '/leave',         icon: 'bi-calendar-check',        label: 'Leave',         section: 'TIME' },
  { module: 'tasks',         href: '/tasks',         icon: 'bi-check2-square',         label: 'Tasks & Projects',  section: 'WORK' },
  { module: 'monitoring',    href: '/monitoring',    icon: 'bi-activity',              label: 'Monitoring',         section: 'WORK' },
  { module: 'payroll',       href: '/payroll',       icon: 'bi-cash-stack',            label: 'Payroll',            section: 'FINANCE' },
  { module: 'finance',       href: '/finance',       icon: 'bi-bar-chart-line',        label: 'Finance', section: 'FINANCE' },
  { module: 'invoicing',     href: '/invoicing',     icon: 'bi-receipt',               label: 'Invoices', section: 'FINANCE' },
  { module: 'inventory',     href: '/inventory',     icon: 'bi-box-seam',              label: 'Inventory',     section: 'FINANCE' },
  { module: 'performance',   href: '/performance',   icon: 'bi-graph-up-arrow',        label: 'Performance',   section: 'HR' },
  { module: 'documents',     href: '/documents',     icon: 'bi-folder2',               label: 'Documents',     section: 'HR' },
  { module: 'self_service',  href: '/self-service',  icon: 'bi-person-badge',          label: 'My Profile',    section: 'HR' },
  { module: 'core_hr',       href: '/core-hr',          icon: 'bi-diagram-3',             label: 'Core HR',           section: 'HR' },
  { module: 'core_hr',       href: '/core-hr/requests',  icon: 'bi-inbox',                 label: 'HR Requests',       section: 'HR' },
  { module: 'communication', href: '/communication', icon: 'bi-megaphone',             label: 'Announcements', section: 'HR' },
  { module: 'calendar',      href: '/calendar',      icon: 'bi-calendar3',             label: 'Calendar',      section: 'HR' },
  { module: 'reports',       href: '/reports',       icon: 'bi-file-earmark-bar-graph',label: 'Reports',       section: 'ANALYTICS' },
  { module: 'sme',           href: '/sme',           icon: 'bi-person-gear',           label: 'SME Portal',    section: 'ANALYTICS' },
  { module: 'settings',      href: '/settings',         icon: 'bi-gear',                  label: 'Settings',         section: 'SYSTEM' },
  { module: 'notifications', href: '/notifications', icon: 'bi-bell', label: 'Notifications', section: 'SYSTEM' },
  { module: 'settings',      href: '/leave-policies',   icon: 'bi-calendar-check',       label: 'Leave Policies',    section: 'SYSTEM' },
  { module: 'audit',         href: '/audit',             icon: 'bi-shield-check',          label: 'Audit Logs',        section: 'SYSTEM' },
];

const MOBILE_NAV_MODULES = ['dashboard', 'self-service', 'attendance', 'leave', 'settings'];

export default function Sidebar({ mobileOpen = false, onMobileClose = () => {} }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [pendingRequests, setPendingRequests] = useState(0);
  const [exportJob, setExportJob] = useState(null);
  const [exportRemaining, setExportRemaining] = useState(0);
  const [employeeProfileId, setEmployeeProfileId] = useState(null);

  useEffect(() => {
    if (!user || !['super_admin', 'admin_full'].includes(user.role)) return;
    const load = () => {
      api.get('/api/core/self-service-requests?status=pending')
        .then(d => setPendingRequests(Array.isArray(d.requests) ? d.requests.length : 0))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.get('/api/employees/me').then(data => setEmployeeProfileId(data?.employeeId || null)).catch(() => {});
  }, [user]);

  useEffect(() => {
    const syncJob = job => {
      setExportJob(job);
      setExportRemaining(getWorkProgressExportRemaining(job));
    };
    syncJob(getWorkProgressExportJob());
    const unsubscribe = subscribeWorkProgressExport(syncJob);
    const interval = setInterval(() => {
      const job = getWorkProgressExportJob();
      const remaining = getWorkProgressExportRemaining(job);
      setExportJob(job);
      setExportRemaining(remaining);
      if (job?.status === 'pending' && remaining === 0) executeWorkProgressExport(job);
    }, 1000);
    return () => { unsubscribe(); clearInterval(interval); };
  }, []);

  if (!user) return null;

  const handleEndImpersonation = () => {
    clearImpersonatedUser();
    window.location.href = '/dashboard';
  };

  const visibleItems = NAV_ITEMS.filter(item => hasAccess(user.role, item.module));
  const sections = [...new Set(visibleItems.map(i => i.section))];
  const mobileNavItems = MOBILE_NAV_MODULES
    .map(module => visibleItems.find(item => item.module === module))
    .filter(Boolean);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  return (
    <>
      {mobileOpen && <div className="sidebar-overlay" onClick={onMobileClose} />}

      <div className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <h5><i className="bi bi-hexagon-fill me-2" style={{ background: 'inherit', WebkitBackgroundClip: 'inherit', WebkitTextFillColor: 'initial', color: '#60a5fa', fontSize: 18 }} />HRMS</h5>
          <button className="sidebar-close d-md-none" onClick={onMobileClose} aria-label="Close navigation">
            <i className="bi bi-x-lg" />
          </button>
        </div>

        {exportJob?.minimized && (
          <div style={{ margin: '0 12px 10px', padding: '9px 10px', borderRadius: 10, background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(96,165,250,0.28)', color: '#dbeafe' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className={`bi ${exportJob.status === 'failed' ? 'bi-exclamation-triangle' : 'bi-file-earmark-excel'}`} style={{ color: exportJob.status === 'failed' ? '#fca5a5' : '#86efac' }} />
              <button onClick={() => router.push(`/employees/${exportJob.employeeId}`)} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', padding: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exportJob.employeeName}</div>
                <div style={{ fontSize: 12, fontFamily: 'monospace', marginTop: 1 }}>{exportJob.status === 'failed' ? 'Export failed' : exportJob.status === 'exporting' ? 'Creating Excel…' : formatExportTime(exportRemaining)}</div>
              </button>
              <button onClick={cancelWorkProgressExportJob} title="Cancel export" style={{ border: 'none', background: 'transparent', color: '#cbd5e1', padding: 2 }}><i className="bi bi-x-lg" /></button>
            </div>
          </div>
        )}

        {/* User profile card */}
        <Link href={employeeProfileId ? `/employees/${employeeProfileId}` : '/profile'} className="sidebar-user" onClick={onMobileClose} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="sidebar-user-avatar" style={{ background: `linear-gradient(135deg, ${ROLE_COLORS[user.role]}, #6366f1)`, overflow: 'hidden' }}>
            {user.profilePhoto ? <img src={user.profilePhoto} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : user.avatar}
          </div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{ROLE_LABELS[user.role]}</div>
          </div>
        </Link>

        <div className="sidebar-nav">
          {sections.map(section => (
            <div key={section}>
              <div className="sidebar-section">{section}</div>
              {visibleItems.filter(i => i.section === section).map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item-link ${pathname.startsWith(item.href) ? 'active' : ''}`}
                  onClick={onMobileClose}
                >
                  <i className={`bi ${item.icon}`} />
                  {item.label}
                  {item.href === '/core-hr/requests' && pendingRequests > 0 && (
                    <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                      {pendingRequests}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="nav-item-link" onClick={handleLogout} style={{ border: 'none', width: '100%', textAlign: 'left' }}>
            <i className="bi bi-box-arrow-right" />
            Logout
          </button>
        </div>
      </div>

      <nav className={`mobile-bottom-nav d-md-none ${mobileOpen ? 'd-none' : ''}`} aria-label="Primary mobile navigation">
        {mobileNavItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-bottom-link ${pathname.startsWith(item.href) ? 'active' : ''}`}
          >
            <i className={`bi ${item.icon}`} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {isImpersonating() && (
        <button data-readonly-allow="true"
          onClick={handleEndImpersonation}
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            padding: '12px 20px',
            borderRadius: 999,
            border: 'none',
            background: '#1e293b',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0f172a'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.transform = 'none'; }}
        >
          <i className="bi bi-house-door-fill" />
          Return Home
        </button>
      )}
    </>
  );
}
