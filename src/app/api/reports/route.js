import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Payroll } from '@/lib/models/Payroll';
import { Task } from '@/lib/models/Task';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const { searchParams } = new URL(req.url);
    const type  = searchParams.get('type') || 'attendance';
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const dept  = searchParams.get('dept') || '';

    const userQuery = dept ? { department: dept } : {};
    const users = await User.find(userQuery).select('_id name department');
    const userIds = users.map(u => u._id);

    if (type === 'attendance') {
      const records = await Attendance.find({ userId: { $in: userIds }, date: { $regex: `^${month}` } })
        .populate('userId', 'name department');

      const byUser = {};
      for (const r of records) {
        const id = r.userId?._id?.toString();
        if (!id) continue;
        if (!byUser[id]) byUser[id] = { name: r.userId.name, dept: r.userId.department, present: 0, late: 0, absent: 0 };
        if (r.status === 'present') byUser[id].present++;
        else if (r.status === 'late') byUser[id].late++;
        else byUser[id].absent++;
      }

      const rows = Object.values(byUser);
      const totalPresent = rows.reduce((s, r) => s + r.present, 0);
      const totalLate    = rows.reduce((s, r) => s + r.late, 0);

      return ok({
        summary: [
          { label: 'Total Employees', value: rows.length, color: '#3b82f6' },
          { label: 'Total Present Days', value: totalPresent, color: '#10b981' },
          { label: 'Total Late Days', value: totalLate, color: '#f59e0b' },
          { label: 'Avg Present/Employee', value: rows.length ? (totalPresent / rows.length).toFixed(1) : 0, color: '#8b5cf6' },
        ],
        chart: {
          type: 'bar', title: 'Attendance by Employee',
          labels: rows.map(r => r.name),
          datasets: [
            { label: 'Present', data: rows.map(r => r.present), backgroundColor: '#10b981' },
            { label: 'Late',    data: rows.map(r => r.late),    backgroundColor: '#f59e0b' },
          ],
        },
        columns: ['name', 'dept', 'present', 'late', 'absent'],
        rows: rows.map(r => ({ name: r.name, dept: r.dept, present: r.present, late: r.late, absent: r.absent })),
      });
    }

    if (type === 'leave') {
      const leaves = await Leave.find({ userId: { $in: userIds }, from: { $regex: `^${month}` } })
        .populate('userId', 'name department');

      const byType = {};
      for (const l of leaves) {
        byType[l.leaveType] = (byType[l.leaveType] || 0) + 1;
      }

      const approved = leaves.filter(l => l.status === 'approved').length;
      const pending  = leaves.filter(l => l.status === 'pending').length;

      return ok({
        summary: [
          { label: 'Total Requests', value: leaves.length, color: '#3b82f6' },
          { label: 'Approved', value: approved, color: '#10b981' },
          { label: 'Pending', value: pending, color: '#f59e0b' },
          { label: 'Rejected', value: leaves.length - approved - pending, color: '#ef4444' },
        ],
        chart: {
          type: 'bar', title: 'Leave by Type',
          labels: Object.keys(byType),
          datasets: [{ label: 'Count', data: Object.values(byType), backgroundColor: '#3b82f6' }],
        },
        columns: ['Employee', 'Department', 'Type', 'Start', 'End', 'Status'],
        rows: leaves.map(l => ({
          Employee: l.userId?.name, Department: l.userId?.department,
          Type: l.leaveType, Start: l.startDate, End: l.endDate, Status: l.status,
        })),
      });
    }

    if (type === 'payroll') {
      const payrolls = await Payroll.find({ userId: { $in: userIds }, month })
        .populate('userId', 'name department');

      const totalGross = payrolls.reduce((s, p) => s + (p.grossPay || 0), 0);
      const totalNet   = payrolls.reduce((s, p) => s + (p.netPay || 0), 0);
      const totalDeductions = payrolls.reduce((s, p) => s + (p.totalDeductions || 0), 0);

      return ok({
        summary: [
          { label: 'Employees Paid', value: payrolls.length, color: '#3b82f6' },
          { label: 'Total Gross', value: `₹${totalGross.toLocaleString('en-IN')}`, color: '#8b5cf6' },
          { label: 'Total Deductions', value: `₹${totalDeductions.toLocaleString('en-IN')}`, color: '#ef4444' },
          { label: 'Total Net', value: `₹${totalNet.toLocaleString('en-IN')}`, color: '#10b981' },
        ],
        chart: {
          type: 'bar', title: 'Gross vs Net Salary',
          labels: payrolls.map(p => p.userId?.name),
          datasets: [
            { label: 'Gross', data: payrolls.map(p => p.grossPay || 0), backgroundColor: '#8b5cf6' },
            { label: 'Net',   data: payrolls.map(p => p.netPay || 0),   backgroundColor: '#10b981' },
          ],
        },
        columns: ['Employee', 'Department', 'Gross', 'Deductions', 'Net', 'Status'],
        rows: payrolls.map(p => ({
          Employee: p.userId?.name, Department: p.userId?.department,
          Gross: `₹${(p.grossPay||0).toLocaleString('en-IN')}`,
          Deductions: `₹${(p.totalDeductions||0).toLocaleString('en-IN')}`,
          Net: `₹${(p.netPay||0).toLocaleString('en-IN')}`,
          Status: p.status,
        })),
      });
    }

    if (type === 'tasks') {
      const tasks = await Task.find({ assignedTo: { $in: userIds } })
        .populate('assignedTo', 'name department');

      const done       = tasks.filter(t => t.status === 'completed').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      const overdue    = tasks.filter(t => t.status === 'overdue').length;

      return ok({
        summary: [
          { label: 'Total Tasks', value: tasks.length, color: '#3b82f6' },
          { label: 'Completed', value: done, color: '#10b981' },
          { label: 'In Progress', value: inProgress, color: '#f59e0b' },
          { label: 'Overdue', value: overdue, color: '#ef4444' },
        ],
        chart: {
          type: 'bar', title: 'Tasks by Status',
          labels: ['Completed', 'In Progress', 'Overdue', 'Pending'],
          datasets: [{
            label: 'Tasks',
            data: [done, inProgress, overdue, tasks.length - done - inProgress - overdue],
            backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#94a3b8'],
          }],
        },
        columns: ['Task', 'Assigned To', 'Department', 'Priority', 'Status', 'Due Date'],
        rows: tasks.map(t => ({
          Task: t.title, 'Assigned To': t.assignedTo?.name,
          Department: t.assignedTo?.department, Priority: t.priority,
          Status: t.status, 'Due Date': t.dueDate?.toString().slice(0, 10),
        })),
      });
    }

    // performance & finance — summary only
    return ok({
      summary: [{ label: 'Report Type', value: type, color: '#3b82f6' }],
      columns: [],
      rows: [],
    });
  } catch (e) {
    return fail(e.message, 500);
  }
}
