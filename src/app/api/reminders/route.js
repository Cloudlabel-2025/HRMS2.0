import { connectDB } from '@/lib/db';
import { Project, Task } from '@/lib/models/Task';
import User from '@/lib/models/User';
import { Announcement, Notification } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export async function POST(req) {
  try {
    const cronSecret = req.headers.get('x-cron-secret');
    const envCronSecret = process.env.CRON_SECRET;

    if (cronSecret !== envCronSecret) {
      const { user, error } = await requireAuth(req);
      if (error) return error;
      if (user.role !== 'super_admin') {
        return fail('Access denied. super_admin role or valid CRON_SECRET required.', 403);
      }
    }

    await connectDB();
    const tomorrow = getTomorrow();
    const today = getToday();
    const results = { projectReminders: 0, taskReminders: 0 };

    // ── Project end-date reminders (one day before) ──
    const projectsEnding = await Project.find({
      endDate: tomorrow,
      reminderSent: { $ne: true },
      status: { $ne: 'completed' },
    }).lean();

    for (const project of projectsEnding) {
      // Skip if all tasks for this project are already completed
      const pendingTaskCount = await Task.countDocuments({
        projectId: project._id,
        status: { $nin: ['Completed'] },
      });

      if (pendingTaskCount === 0) {
        await Project.findByIdAndUpdate(project._id, { reminderSent: true });
        continue;
      }

      const depts = project.departments || [];
      const deptLabel = depts.length > 0 ? depts.join(', ') : 'General';

      // Gather users to notify: team members + department members
      const teamUserIds = (project.team || []).map(id => id.toString());
      const deptUsers = depts.length > 0
        ? await User.find({ department: { $in: depts }, status: 'active' }).select('_id').lean()
        : [];
      const deptUserIds = deptUsers.map(u => u._id.toString());

      const allIds = [...new Set([...teamUserIds, ...deptUserIds])];

      // Create an Announcement visible to the department
      const announcementBody = `Project "${project.name}" is ending tomorrow (${project.endDate}). Please ensure all remaining tasks are completed.`;
      await Announcement.create({
        title: `Project Ending Soon: ${project.name}`,
        body: announcementBody,
        author: project.createdBy || null,
        audience: deptLabel,
        tag: 'Project',
        tagColor: '#f59e0b',
      });

      // Send individual notifications to affected users
      if (allIds.length > 0) {
        const notifDocs = allIds.map(userId => ({
          userId,
          title: `Project ending tomorrow: ${project.name}`,
          message: announcementBody,
          type: 'general',
          refId: project._id,
        }));
        await Notification.insertMany(notifDocs);
      }

      // Mark reminder as sent
      await Project.findByIdAndUpdate(project._id, { reminderSent: true });

      results.projectReminders++;
    }

    // ── Task due-date reminders (due tomorrow or today's overdue) ──
    const tasksDue = await Task.find({
      $or: [
        { due: tomorrow, reminderSent: { $ne: true } },
        { due: today, reminderSent: { $ne: true } },
      ],
      status: { $nin: ['Completed', 'Blocked'] },
    }).lean();

    for (const task of tasksDue) {
      if (!task.assignedTo) continue;

      const label = task.due === today ? 'is due today' : 'is due tomorrow';
      await Notification.create({
        userId: task.assignedTo,
        title: `Task ${label}: ${task.title}`,
        message: `Task "${task.title}" ${label}. Please complete it on time.`,
        type: 'general',
        refId: task._id,
      });

      await Task.findByIdAndUpdate(task._id, { reminderSent: true });
      results.taskReminders++;
    }

    return ok({
      message: `Reminders processed. ${results.projectReminders} project reminder(s) and ${results.taskReminders} task reminder(s) sent.`,
      ...results,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
