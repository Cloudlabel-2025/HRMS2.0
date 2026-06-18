import { connectDB } from '@/lib/db';
import { Task, Project } from '@/lib/models/Task';
import User from '@/lib/models/User';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess } from '@/lib/rbac';

async function getTeamUserIds(user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return null;
  if (user.role === 'team_lead') {
    const members = await User.find({ teamLeadId: user._id }).select('_id');
    return members.map(m => m._id);
  }
  if (user.role === 'team_admin') {
    const members = await User.find({ teamAdminId: user._id }).select('_id');
    return members.map(m => m._id);
  }
  return [user._id];
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'tasks')) return fail('Access denied', 403);
    await connectDB();

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const scope     = searchParams.get('scope'); // 'my' | 'all'

    const query = {};
    if (projectId) query.projectId = projectId;

    if (scope === 'my' || ['employee', 'intern', 'recruiter'].includes(user.role)) {
      query.assignedTo = user._id;
    } else {
      const ids = await getTeamUserIds(user);
      if (ids) query.assignedTo = { $in: ids };
    }

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name avatar')
      .populate('assignedBy', 'name')
      .populate('projectId', 'name departments')
      .sort({ createdAt: -1 });

    return ok(tasks);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) {
      return fail('Access denied', 403);
    }
    await connectDB();
    const ip = req.headers.get('x-forwarded-for') || '';
    const body = await req.json();

    if (!body.title) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: title is required', 'low', ip, null, user._id);
      return fail('Task title is required', 400);
    }
    if (body.title.length > 30 || !/^[a-zA-Z0-9]+$/.test(body.title)) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: invalid title', 'low', ip, null, user._id);
      return fail('Task title must be at most 30 characters and contain only letters and numbers', 400);
    }
    if (!body.description) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: description is required', 'low', ip, null, user._id);
      return fail('Task description is required', 400);
    }
    if (!body.projectId) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: project is required', 'low', ip, null, user._id);
      return fail('Project is required', 400);
    }
    if (!body.assignedTo) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: assignedTo is required', 'low', ip, null, user._id);
      return fail('Assigned user is required', 400);
    }
    if (!body.priority) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: priority is required', 'low', ip, null, user._id);
      return fail('Priority is required', 400);
    }
    if (!body.status) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: status is required', 'low', ip, null, user._id);
      return fail('Status is required', 400);
    }
    if (!body.due) {
      auditLog('Task Create Failed', 'Tasks', user._id, 'Failed to create task: due date is required', 'low', ip, null, user._id);
      return fail('Due date is required', 400);
    }

    // Validate due date is within project's date range
    const taskProject = await Project.findById(body.projectId).select('startDate endDate').lean();
    if (taskProject) {
      if (body.due < taskProject.startDate) {
        return fail(`Due date cannot be before project start date (${taskProject.startDate})`, 400);
      }
      if (body.due > taskProject.endDate) {
        return fail(`Due date cannot be after project end date (${taskProject.endDate})`, 400);
      }
    }

    if (user.role === 'team_lead') {
      const member = await User.findOne({ _id: body.assignedTo, teamLeadId: user._id });
      if (!member) {
        auditLog('Task Create Failed', 'Tasks', user._id, `Attempted to assign task to non-team member (${body.assignedTo})`, 'low', ip, null, user._id);
        return fail('You can only assign tasks to your team members', 403);
      }
    }

    const task = await Task.create({ ...body, assignedBy: user._id });
    await task.populate('assignedTo', 'name avatar');
    const assignee = await User.findById(body.assignedTo).select('name').catch(() => null);
    auditLog('Task Created', 'Tasks', user._id, `Created task "${body.title}" assigned to ${assignee?.name || 'unknown'}`, 'low', ip, null, body.assignedTo);
    return ok(task, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
