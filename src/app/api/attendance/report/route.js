import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied', 403);
    }

    await connectDB();
    const { searchParams } = new URL(req.url);
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const department = searchParams.get('department');
    const status = searchParams.get('status');

    if (!fromDate || !toDate) return fail('from and to dates are required', 400);

    const query = { date: { $gte: fromDate, $lte: toDate } };
    if (status) query.status = status;

    let records = await Attendance.find(query)
      .populate('userId', 'name email department designation shift role')
      .sort({ date: -1 })
      .lean();

    records = records.filter(r => r.userId?.role !== 'super_admin');

    if (department) {
      records = records.filter(r => r.userId?.department === department);
    }

    const headers = ['Date', 'Employee', 'Department', 'Shift', 'Clock In', 'Clock Out',
      'Status', 'Hours Worked', 'Break Deduction', 'Late Flag', 'Auto Logged Out'];
    const csvRows = [headers.join(',')];

    records.forEach(r => {
      csvRows.push([
        r.date,
        `"${r.userId?.name || ''}"`,
        r.userId?.department || '',
        r.userId?.shift || '',
        r.clockIn || '',
        r.clockOut || '',
        r.status || '',
        r.hoursWorked ?? '',
        r.breakDeduction ?? '',
        r.lateFlag ? 'Yes' : 'No',
        r.autoLoggedOut ? 'Yes' : 'No',
      ].join(','));
    });

    return new Response('\uFEFF' + csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv;charset=utf-8',
        'Content-Disposition': `attachment; filename="attendance_report_${fromDate}_${toDate}.csv"`,
      },
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
