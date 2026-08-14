export const NOTIF_ICONS = { leave: 'bi-calendar-check', attendance: 'bi-clock', announcement: 'bi-megaphone', general: 'bi-bell', performance: 'bi-graph-up-arrow', self_service: 'bi-person-badge', lifecycle: 'bi-diagram-3', payroll: 'bi-cash-stack', shift: 'bi-arrow-repeat' };

export const NOTIF_COLORS = { leave: '#10b981', attendance: '#f59e0b', announcement: '#2563eb', general: '#3b82f6', performance: '#8b5cf6', self_service: '#8b5cf6', lifecycle: '#06b6d4', payroll: '#f97316', shift: '#0d9488' };

export function getNotifRoute(n, role) {
  if (n.type === 'leave') return '/leave';
  if (n.type === 'attendance') return '/attendance';
  if (n.type === 'self_service') {
    return ['super_admin', 'admin_full'].includes(role) ? '/core-hr/requests' : '/self-service';
  }
  if (n.type === 'lifecycle') return '/core-hr';
  if (n.type === 'payroll') return '/payroll';
  if (n.type === 'performance') return '/performance?tab=reviews';
  if (n.type === 'announcement') return '/communication';
  return null;
}

export const NOTIFICATION_MODULES = [
  { type: 'leave',         label: 'Leave',         icon: 'bi-calendar-check',  color: '#10b981' },
  { type: 'attendance',    label: 'Attendance',    icon: 'bi-clock',           color: '#f59e0b' },
  { type: 'announcement',  label: 'Announcements', icon: 'bi-megaphone',       color: '#2563eb' },
  { type: 'performance',   label: 'Performance',   icon: 'bi-graph-up-arrow',  color: '#8b5cf6' },
  { type: 'lifecycle',     label: 'Core HR',       icon: 'bi-diagram-3',       color: '#06b6d4' },
  { type: 'self_service',  label: 'Self Service',  icon: 'bi-person-badge',    color: '#8b5cf6' },
  { type: 'payroll',       label: 'Payroll',       icon: 'bi-cash-stack',      color: '#f97316' },
  { type: 'shift',         label: 'Shift',         icon: 'bi-arrow-repeat',    color: '#0d9488' },
  { type: 'general',       label: 'General',       icon: 'bi-bell',            color: '#3b82f6' },
];
