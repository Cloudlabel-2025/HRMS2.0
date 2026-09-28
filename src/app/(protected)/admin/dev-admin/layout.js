'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import DevAdminNav, { devNavBtnStyle } from '@/components/dev-admin/DevAdminNav';

const LINKS = [
  { href: '/admin/control-center', label: 'Policy Control & Sandbox', icon: 'bi-sliders' },
  { href: '/admin/dev-admin/leave-bulk', label: 'Leave Bulk Upload', icon: 'bi-upload' },
  { href: '/admin/dev-admin/shift-assign', label: 'Shift Management', icon: 'bi-arrow-repeat' },
  { href: '/admin/dev-admin/shifts', label: 'Shifts', icon: 'bi-clock' },
];

export default function DevAdminLayout({ children }) {
  const pathname = usePathname();
  return (
    <>
      <DevAdminNav
        title="Dev Admin Portal"
        subtitle="Super-admin time & leave operations, reflected as-is for the dev admin."
      >
        {LINKS.map(l => {
          const active = pathname === l.href || pathname.startsWith(l.href + '/');
          return (
            <Link key={l.href} href={l.href} style={devNavBtnStyle(active)}>
              <i className={`bi ${l.icon}`} />
              {l.label}
            </Link>
          );
        })}
      </DevAdminNav>
      {children}
    </>
  );
}
