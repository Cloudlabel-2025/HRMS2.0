import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { Notification } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const body = await req.json();
    const { date, reason } = body;

    if (!date || !reason || reason.trim().length < 5) {
      return fail('Date and reason (min 5 characters) are required.', 400);
    }

    const trimmedReason = reason.trim();

    // Find and update the attendance record
    const record = await Attendance.findOneAndUpdate(
      { userId: user._id, date, autoLoggedOut: true },
      {
        $set: {
          lateLogoutReason: trimmedReason,
          lateLogoutReasonProvidedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!record) {
      return fail('No auto-logged out attendance record found for the given date.', 404);
    }

    // Send notification to all super admins
    const superAdmins = await User.find({ role: 'super_admin', status: 'active' }).lean();
    const notificationPromises = superAdmins.map(admin =>
      Notification.create({
        userId: admin._id,
        title: 'Late Logout Reason Submitted',
        message: `${user.name} (${user.email}) was auto-logged out on ${date}. Reason: ${trimmedReason}`,
        type: 'attendance',
        refId: record._id,
      })
    );
    await Promise.all(notificationPromises);

    const ip = req.headers.get('x-forwarded-for') || '';
    await auditLog('Late Logout Reason', 'Attendance', user._id,
      `Submitted late logout reason for ${date}: ${trimmedReason}`, 'medium', ip, null, user._id);

    return ok({
      message: 'Late logout reason submitted successfully.',
      record,
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
