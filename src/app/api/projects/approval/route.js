import { connectDB } from '@/lib/db';
import { Project } from '@/lib/models/Task';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { getApproverIds } from '@/lib/rbac';
import { Notification } from '@/lib/models/index';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope'); // 'pending' (default) | 'all' (all approval statuses)

    let query;
    if (['super_admin', 'admin_full'].includes(user.role)) {
      query = scope === 'all'
        ? { approvalRequired: true }
        : { approvalRequired: true, approvalStatus: 'pending' };
    } else if (['team_lead', 'team_admin'].includes(user.role)) {
      query = { createdBy: user._id, approvalRequired: true };
    } else {
      return fail('Access denied', 403);
    }

    const projects = await Project.find(query)
      .populate('createdBy', 'name role department')
      .populate('responsibleTo', 'name department role')
      .sort({ createdAt: -1 });

    return ok(projects);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();
    const ip = req.headers.get('x-forwarded-for') || '';
    const body = await req.json();

    if (!body.projectId) return fail('projectId is required', 400);
    if (!['approve', 'reject', 'resubmit'].includes(body.action)) return fail('Invalid action', 400);

    const project = await Project.findById(body.projectId);
    if (!project) return fail('Project not found', 404);

    if (body.action === 'approve' || body.action === 'reject') {
      if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
      if (project.approvalStatus !== 'pending') {
        auditLog(`Project Approval ${body.action} Attempted`, 'Projects', user._id, `Attempted to ${body.action} already-processed project "${project.name}" (status: ${project.approvalStatus})`, 'low', ip, null, project.createdBy);
        return fail('This project request has already been processed', 400);
      }
      const comment = String(body.comment || '').trim();
      const updated = await Project.findOneAndUpdate(
        { _id: body.projectId, approvalStatus: 'pending' },
        body.action === 'approve'
          ? { $set: { approvalStatus: 'approved', approvedBy: user._id, approvedAt: new Date(), rejectionComment: '' } }
          : { $set: { approvalStatus: 'rejected', rejectionComment: comment, approvedBy: null, approvedAt: null } },
        { new: true }
      );
      if (!updated) return fail('This project request has already been processed', 400);

      if (project.createdBy) {
        await Notification.create({
          userId: project.createdBy,
          title: body.action === 'approve' ? 'Project Approval Approved' : 'Project Approval Rejected',
          message: body.action === 'approve'
            ? `Your cross-department project "${project.name}" has been approved by ${user.name}. You can now assign tasks to its departments.`
            : `Your cross-department project "${project.name}" was rejected by ${user.name}.${comment ? ' Reason: ' + comment : ''} You can resubmit it after making changes.`,
          type: 'general',
          refId: project._id,
        });
      }

      await auditLog(`Project Approval ${body.action === 'approve' ? 'Approved' : 'Rejected'}`, 'Projects', user._id, `${body.action === 'approve' ? 'Approved' : 'Rejected'} cross-department project "${project.name}"`, body.action === 'approve' ? 'medium' : 'low', ip, null, project.createdBy);
      return ok(updated);
    }

    if (String(project.createdBy) !== String(user._id)) return fail('Access denied', 403);
    if (project.approvalStatus !== 'rejected') return fail('Only rejected projects can be resubmitted', 400);

    const updated = await Project.findOneAndUpdate(
      { _id: body.projectId, createdBy: user._id, approvalStatus: 'rejected' },
      { $set: { approvalStatus: 'pending', approvalRequestedAt: new Date(), rejectionComment: '', approvedBy: null, approvedAt: null } },
      { new: true }
    );
    if (!updated) return fail('Only rejected projects can be resubmitted', 400);

    const approverIds = await getApproverIds();
    if (approverIds.length) await Notification.insertMany(approverIds.map(userId => ({ userId, title: 'Cross-Department Project Approval Requested', message: `${user.name} resubmitted cross-department project: ${project.name}.`, type: 'general', refId: project._id })));
    await auditLog('Project Approval Resubmitted', 'Projects', user._id, `Resubmitted cross-department project "${project.name}" for approval`, 'low', ip, null, user._id);

    return ok(updated);
  } catch (e) {
    return fail(e.message, 500);
  }
}
