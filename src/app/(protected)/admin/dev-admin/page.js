'use client';
import Link from 'next/link';
import AppShell from '@/components/AppShell';

const MODULES = [
  {
    href: '/admin/control-center',
    icon: 'bi-sliders',
    title: 'Policy Control & Sandbox',
    desc: 'Leave policy configuration, rules engine and the live what-if simulation console.',
  },
  {
    href: '/admin/dev-admin/leave-bulk',
    icon: 'bi-upload',
    title: 'Leave Bulk Upload',
    desc: 'Import leave balances or leave history from Excel — same screen as Leave → Bulk Import.',
  },
  {
    href: '/admin/dev-admin/shift-assign',
    icon: 'bi-arrow-repeat',
    title: 'Shift Management',
    desc: 'Assign or schedule shift changes by department, role or employee — same screen as Core HR → Shifts.',
  },
  {
    href: '/admin/dev-admin/shifts',
    icon: 'bi-clock',
    title: 'Shifts',
    desc: 'Create or edit shift definitions, work-hour policy and breaks — same master as Settings → Shifts.',
  },
];

export default function DevAdminHubPage() {
  return (
    <AppShell title="Dev Admin Portal">
      <div className="row g-3">
        {MODULES.map(m => (
          <div key={m.href} className="col-12 col-md-6">
            <div className="card h-100" style={{ borderRadius: 14 }}>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <i className={`bi ${m.icon}`} style={{ fontSize: 20, color: '#4f46e5' }} />
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{m.title}</div>
                </div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>{m.desc}</div>
                <Link href={m.href} className="btn btn-primary btn-sm" style={{ borderRadius: 8 }}>
                  Open <i className="bi bi-arrow-right ms-1" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
