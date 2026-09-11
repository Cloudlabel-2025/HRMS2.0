import User from '@/lib/models/User';

/**
 * Returns unique user IDs that should be notified about task changes:
 * the assignee, their team lead, their team admin, and all active super_admin/admin_full users.
 * Excludes the actor (user performing the action) from the list.
 */
export async function getTaskStakeholders(assigneeId, actorId) {
  const [assignee, admins] = await Promise.all([
    User.findById(assigneeId).select('teamLeadId teamAdminId').lean(),
    User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean(),
  ]);
  const ids = [assigneeId, assignee?.teamLeadId, assignee?.teamAdminId, ...admins.map(admin => admin._id)]
    .filter(Boolean)
    .map(id => id.toString());
  return [...new Set(ids)].filter(id => id !== actorId.toString());
}
