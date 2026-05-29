'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, ROLE_LABELS, ROLE_COLORS, hasAccess } from '@/lib/auth';

const NAV_ITEMS = [
  { module: 'dashboard',     href: '/dashboard',     icon: 'bi-grid-1x2',              label: 'Dashboard',     section: 'MAIN' },
  { module: 'employees',     href: '/employees',     icon: 'bi-people',                label: 'Employees',     section: 'PEOPLE' },
  { module: 'recruitment',   href: '/recruitment',   icon: 'bi-person-plus',           label: 'Recruitment',   section: 'PEOPLE' },
  { module: 'attendance',    href: '/attendance',    icon: 'bi-clock',                 label: 'Attendance',    section: 'TIME' },
  { module: 'absence',       href: '/absence',       icon: 'bi-calendar-x',            label: 'Absence',       section: 'TIME' },
  { module: 'leave',         href: '/leave',         icon: 'bi-calendar-check',        label: 'Leave',         section: 'TIME' },
  { module: 'tasks',         href: '/tasks',         icon: 'bi-check2-square',         label: 'Tasks',         section: 'WORK' },
  { module: 'projects',      href: '/projects',      icon: 'bi-kanban',                label: 'Projects',      section: 'WORK' },
  { module: 'monitoring',    href: '/monitoring',    icon: 'bi-activity',              label: 'Monitoring',    section: 'WORK' },
  { module: 'payroll',       href: '/payroll',       icon: 'bi-cash-stack',            label: 'Payroll',       section: 'FINANCE' },
  { module: 'finance',       href: '/finance',       icon: 'bi-bar-chart-line',        label: 'Finance',       section: 'FINANCE' },
  { module: 'invoicing',     href: '/invoicing',     icon: 'bi-receipt',               label: 'Invoicing',     section: 'FINANCE' },
  { module: 'inventory',     href: '/inventory',     icon: 'bi-box-seam',              label: 'Inventory',     section: 'FINANCE' },
  { module: 'performance',   href: '/performance',   icon: 'bi-graph-up-arrow',        label: 'Performance',   section: 'HR' },
  { module: 'documents',     href: '/documents',     icon: 'bi-folder2',               label: 'Documents',     section: 'HR' },
  { module: 'communication', href: '/communication', icon: 'bi-megaphone',             label: 'Announcements', section: 'HR' },
  { module: 'calendar',      href: '/calendar',      icon: 'bi-calendar3',             label: 'Calendar',      section: 'HR' },
  { module: 'reports',       href: '/reports',       icon: 'bi-file-earmark-bar-graph',label: 'Reports',       section: 'ANALYTICS' },
  { module: 'sme',           href: '/sme',           icon: 'bi-building',              label: 'SME Portal',    section: 'ANALYTICS' },
  { module: 'settings',      href: '/settings',      icon: 'bi-gear',                  label: 'Settings',      section: 'SYSTEM' },
  { module: 'audit',         href: '/audit',         icon: 'bi-shield-check',          label: 'Audit Logs',    section: 'SYSTEM' },
];

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  if (!user) return null;

  const visibleItems = NAV_ITEMS.filter(item => hasAccess(user.role, item.module));
  const sections = [...new Set(visibleItems.map(i => i.section))];

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  return (
    <>
      {/* Mobile hamburger — rendered outside sidebar so it's always visible */}
      <button
        className="d-md-none"
        onClick={() => setMobileOpen(true)}
        style={{ position: 'fixed', top: 14, left: 14, zIndex: 1100, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <i className="bi bi-list" style={{ fontSize: 20 }} />
      </button>

      {mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}

      <div className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <h5><i className="bi bi-hexagon-fill me-2" style={{ color: '#3b82f6' }} />HRMS Pro</h5>
          <span>Enterprise HR Platform</span>
        </div>

        <div className="sidebar-nav">
          {sections.map(section => (
            <div key={section}>
              <div className="sidebar-section">{section}</div>
              {visibleItems.filter(i => i.section === section).map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item-link ${pathname.startsWith(item.href) ? 'active' : ''}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <i className={`bi ${item.icon}`} />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="nav-item-link" style={{ marginBottom: 4, cursor: 'default' }}>
            <div className="avatar" style={{ width: 28, height: 28, fontSize: 11, background: `linear-gradient(135deg, ${ROLE_COLORS[user.role]}, #1e293b)` }}>
              {user.avatar}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{ROLE_LABELS[user.role]}</div>
            </div>
          </div>
          <button className="nav-item-link" onClick={handleLogout} style={{ color: '#ef4444', background: 'none', border: 'none', width: '100%', textAlign: 'left' }}>
            <i className="bi bi-box-arrow-right" />
            Logout
          </button>
        </div>
      </div>
    </>
  );
}
