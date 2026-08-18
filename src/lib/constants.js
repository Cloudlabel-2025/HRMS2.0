export const STATUS_STYLE = {
  present: { bg: '#dcfce7', color: '#16a34a', label: 'Present' },
  absent:  { bg: '#fee2e2', color: '#dc2626', label: 'Absent' },
  late:    { bg: '#fef3c7', color: '#d97706', label: 'Late' },
  half_day:{ bg: '#ffedd5', color: '#ea580c', label: 'Half Day' },
  leave:   { bg: '#dbeafe', color: '#2563eb', label: 'Leave' },
  holiday: { bg: '#f1f5f9', color: '#64748b', label: 'Holiday' },
  sunday:  { bg: '#f8fafc', color: '#94a3b8', label: 'Sunday' },
};

export const WP_STATUS_STYLE = {
  pending:         { bg: '#f1f5f9', color: '#64748b', label: 'Pending' },
  work_in_progress:{ bg: '#dbeafe', color: '#2563eb', label: 'Work in Progress' },
  completed:       { bg: '#dcfce7', color: '#16a34a', label: 'Completed' },
  task_blocked:    { bg: '#fee2e2', color: '#dc2626', label: 'Task Blocked' },
  stopped:         { bg: '#fef3c7', color: '#d97706', label: 'Stopped' },
};

export const MANAGER_ROLES = ['super_admin', 'admin_full', 'team_lead', 'team_admin'];
