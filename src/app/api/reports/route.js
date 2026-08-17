import { connectDB } from '@/lib/db';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Payroll } from '@/lib/models/Payroll';
import { Task } from '@/lib/models/Task';
import User from '@/lib/models/User';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { SelfServiceRequest, Goal, Review, Invoice, Expense } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { hasAccess, getAccessibleDepartments, getManagedUserIds } from '@/lib/rbac';

const REPORT_TYPES = new Set(['attendance', 'leave', 'payroll', 'tasks', 'performance', 'finance', 'lifecycle']);

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

async function getReportUserQuery(user, requestedDepartment) {
  if (['super_admin', 'admin_full'].includes(user.role)) return requestedDepartment ? { department: requestedDepartment } : {};
  if (user.role === 'team_lead') {
    const departments = await getAccessibleDepartments(user);
    return { department: requestedDepartment && departments.includes(requestedDepartment) ? requestedDepartment : { $in: departments } };
  }
  if (user.role === 'team_admin') {
    const base = { _id: { $in: await getManagedUserIds(user) } };
    const departments = await getAccessibleDepartments(user);
    if (requestedDepartment && departments.includes(requestedDepartment)) {
      return { ...base, department: requestedDepartment };
    }
    return base;
  }
  // Limited reporting roles are self-only until a dedicated reporting policy is approved.
  return { _id: user._id };
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!hasAccess(user.role, 'reports')) return fail('Access denied', 403);
    await connectDB();

    const { searchParams } = new URL(req.url);
    const type  = searchParams.get('type') || 'attendance';
    const month = searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const dept  = searchParams.get('dept') || '';
    if (!REPORT_TYPES.has(type)) return fail('Invalid report type', 400);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('Month must be YYYY-MM', 400);
    if (type === 'payroll' && !['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

    const userQuery = await getReportUserQuery(user, dept);
    const users = await User.find({ ...userQuery, role: { $ne: 'super_admin' } }).select('_id name department');
    const userIds = users.map(u => u._id);

    if (type === 'attendance') {
      const records = await Attendance.find({ userId: { $in: userIds }, date: { $regex: `^${month}` } })
        .populate('userId', 'name department');

      const byUser = {};
      for (const r of records) {
        const id = r.userId?._id?.toString();
        if (!id) continue;
        if (!byUser[id]) byUser[id] = { name: r.userId.name, dept: r.userId.department, present: 0, late: 0, absent: 0, leave: 0, halfDay: 0 };
        if (r.status === 'present') byUser[id].present++;
        else if (r.status === 'late') byUser[id].late++;
        else if (r.status === 'leave') byUser[id].leave++;
        else if (r.status === 'half_day') byUser[id].halfDay++;
        else if (r.status !== 'holiday') byUser[id].absent++;
      }

      const rows = Object.values(byUser);
      const totalPresent = rows.reduce((s, r) => s + r.present, 0);
      const totalLate    = rows.reduce((s, r) => s + r.late, 0);
      const totalLeave   = rows.reduce((s, r) => s + r.leave, 0);
      const totalHalfDay = rows.reduce((s, r) => s + r.halfDay, 0);

      return ok({
        summary: [
          { label: 'Total Employees', value: rows.length, color: '#3b82f6' },
          { label: 'Total Present Days', value: totalPresent, color: '#10b981' },
          { label: 'Total Late Days', value: totalLate, color: '#f59e0b' },
          { label: 'Total Leave Days', value: totalLeave, color: '#8b5cf6' },
          { label: 'Total Half Days', value: totalHalfDay, color: '#f97316' },
          { label: 'Avg Present/Employee', value: rows.length ? (totalPresent / rows.length).toFixed(1) : 0, color: '#06b6d4' },
        ],
        chart: {
          type: 'bar', title: 'Attendance by Employee',
          labels: rows.map(r => r.name),
          datasets: [
            { label: 'Present', data: rows.map(r => r.present), backgroundColor: '#10b981' },
            { label: 'Late',    data: rows.map(r => r.late),    backgroundColor: '#f59e0b' },
            { label: 'Leave',   data: rows.map(r => r.leave),   backgroundColor: '#8b5cf6' },
            { label: 'Half Day', data: rows.map(r => r.halfDay), backgroundColor: '#f97316' },
          ],
        },
        columns: ['name', 'dept', 'present', 'late', 'leave', 'halfDay', 'absent'],
        rows: rows.map(r => ({ name: r.name, dept: r.dept, present: r.present, late: r.late, leave: r.leave, halfDay: r.halfDay, absent: r.absent })),
      });
    }

    if (type === 'leave') {
      const leaves = await Leave.find({ userId: { $in: userIds }, from: { $regex: `^${month}` } })
        .populate('userId', 'name department');

      const byType = {};
      for (const l of leaves) {
        byType[l.typeCode || l.type] = (byType[l.typeCode || l.type] || 0) + 1;
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
          Type: l.typeCode || l.type, Start: l.from, End: l.to, Status: l.status,
        })),
      });
    }

    if (type === 'payroll') {
      const payrolls = await Payroll.find({ userId: { $in: userIds }, month })
        .populate('userId', 'name department');

      const totalGross = payrolls.reduce((s, p) => s + (p.monthlyGross || p.grossPay || 0), 0);
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
            { label: 'Gross', data: payrolls.map(p => p.monthlyGross || p.grossPay || 0), backgroundColor: '#8b5cf6' },
            { label: 'Net',   data: payrolls.map(p => p.netPay || 0),   backgroundColor: '#10b981' },
          ],
        },
        columns: ['Employee', 'Department', 'Gross', 'Deductions', 'Net', 'Status'],
        rows: payrolls.map(p => ({
          Employee: p.userId?.name, Department: p.userId?.department,
          Gross: `₹${(p.monthlyGross || p.grossPay || 0).toLocaleString('en-IN')}`,
          Deductions: `₹${(p.totalDeductions||0).toLocaleString('en-IN')}`,
          Net: `₹${(p.netPay||0).toLocaleString('en-IN')}`,
          Status: p.status,
        })),
      });
    }

    if (type === 'tasks') {
      const tasks = await Task.find({ assignedTo: { $in: userIds } })
        .populate('assignedTo', 'name department');

      const done       = tasks.filter(t => t.status === 'Completed').length;
      const inProgress = tasks.filter(t => t.status === 'In Progress').length;
      const overdue    = tasks.filter(t => t.due && t.due < new Date().toISOString().slice(0, 10) && t.status !== 'Completed').length;

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
          Status: t.status, 'Due Date': t.due || '—',
        })),
      });
    }

    if (type === 'performance') {
      const monthStart = new Date(month + '-01');
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
      const reviews = await Review.find({
        userId: { $in: userIds },
        ...(month ? { createdAt: { $gte: monthStart, $lt: monthEnd } } : {}),
      }).populate('userId', 'name department');

      const rated = reviews.filter(r => r.overall != null);
      const avgOverall = rated.length ? (rated.reduce((s, r) => s + r.overall, 0) / rated.length).toFixed(1) : 0;
      const highPerformers = rated.filter(r => r.overall >= 4.5).length;
      const needsImprovement = rated.filter(r => r.overall < 2.5).length;

      const deptRatings = {};
      for (const r of rated) {
        const d = r.userId?.department || 'Unknown';
        if (!deptRatings[d]) deptRatings[d] = { sum: 0, count: 0 };
        deptRatings[d].sum += r.overall;
        deptRatings[d].count++;
      }

      return ok({
        summary: [
          { label: 'Total Reviews', value: reviews.length, color: '#3b82f6' },
          { label: 'Avg Overall', value: avgOverall, color: '#10b981' },
          { label: 'High Performers', value: highPerformers, color: '#8b5cf6' },
          { label: 'Needs Improvement', value: needsImprovement, color: '#ef4444' },
        ],
        chart: {
          type: 'bar', title: 'Rating Distribution',
          labels: ['Excellent (4.5+)', 'Good (3.5-4.4)', 'Average (2.5-3.4)', 'Needs Improvement (<2.5)'],
          datasets: [{
            label: 'Reviews',
            data: [
              rated.filter(r => r.overall >= 4.5).length,
              rated.filter(r => r.overall >= 3.5 && r.overall < 4.5).length,
              rated.filter(r => r.overall >= 2.5 && r.overall < 3.5).length,
              rated.filter(r => r.overall < 2.5).length,
            ],
            backgroundColor: ['#10b981', '#06b6d4', '#f59e0b', '#ef4444'],
          }],
        },
        deptChart: {
          type: 'bar', title: 'Avg Rating by Department',
          labels: Object.keys(deptRatings),
          datasets: [{ label: 'Avg Rating', data: Object.keys(deptRatings).map(d => deptRatings[d].count ? (deptRatings[d].sum / deptRatings[d].count).toFixed(1) : 0), backgroundColor: '#3b82f6' }],
        },
        columns: ['Employee', 'Department', 'Cycle', 'Overall', 'Status'],
        rows: reviews.map(r => ({
          Employee: r.userId?.name,
          Department: r.userId?.department,
          Cycle: r.cycle,
          Overall: r.overall ?? '—',
          Status: r.status,
        })),
      });
    }

    if (type === 'finance') {
      if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

      const invoices = await Invoice.find(month ? { issued: { $regex: '^' + month } } : {});
      const expenses = await Expense.find({
        userId: { $in: userIds },
        ...(month ? { date: { $regex: '^' + month } } : {}),
      }).populate('userId', 'name department');

      const totalInvoiced = invoices.reduce((s, i) => s + (i.amount || 0), 0);
      const collected     = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
      const outstanding   = invoices.filter(i => ['sent', 'pending', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.amount || 0), 0);
      const approvedExpenses = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + (e.amount || 0), 0);

      const expenseByDept = {};
      for (const e of expenses) {
        const d = e.userId?.department || 'Unknown';
        expenseByDept[d] = (expenseByDept[d] || 0) + (e.amount || 0);
      }

      return ok({
        summary: [
          { label: 'Total Invoiced', value: `₹${totalInvoiced.toLocaleString('en-IN')}`, color: '#3b82f6' },
          { label: 'Collected', value: `₹${collected.toLocaleString('en-IN')}`, color: '#10b981' },
          { label: 'Outstanding', value: `₹${outstanding.toLocaleString('en-IN')}`, color: '#f59e0b' },
          { label: 'Approved Expenses', value: `₹${approvedExpenses.toLocaleString('en-IN')}`, color: '#8b5cf6' },
        ],
        chart: {
          type: 'bar', title: 'Invoiced vs Collected',
          labels: ['Paid', 'Outstanding'],
          datasets: [{ label: 'Amount', data: [collected, outstanding], backgroundColor: ['#10b981', '#f59e0b'] }],
        },
        deptChart: {
          type: 'bar', title: 'Expenses by Department',
          labels: Object.keys(expenseByDept),
          datasets: [{ label: 'Amount', data: Object.values(expenseByDept), backgroundColor: '#8b5cf6' }],
        },
        columns: ['Invoice No', 'Client', 'Amount', 'Issued', 'Due', 'Status'],
        rows: invoices.map(i => ({
          'Invoice No': i.invoiceNo,
          Client: i.client,
          Amount: `₹${(i.amount || 0).toLocaleString('en-IN')}`,
          Issued: i.issued || '—',
          Due: i.due || '—',
          Status: i.status,
        })),
      });
    }

    if (type === 'lifecycle') {
      if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);

      const profiles = await EmpProfile.find().populate('identityId', 'legalName primaryEmail');

      const statusCounts = {};
      for (const p of profiles) {
        const s = p.employmentStatus || 'unknown';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      }

      const deptCounts = {};
      for (const p of profiles) {
        const d = p.department || 'Unknown';
        deptCounts[d] = (deptCounts[d] || 0) + 1;
      }

      const pendingOnboarding = profiles.filter(p => p.employmentStatus === 'onboarding').length;
      const pendingProbation  = profiles.filter(p => p.employmentStatus === 'probation').length;
      const rehired           = profiles.filter(p => (p.rehireCount || 0) > 0).length;

      const ssRequests = await SelfServiceRequest.aggregate([
        { $group: { _id: { type: '$requestType', status: '$status' }, count: { $sum: 1 } } },
      ]);
      const ssMap = {};
      for (const r of ssRequests) {
        const key = `${r._id.type}__${r._id.status}`;
        ssMap[key] = r.count;
      }

      const ssTypes = ['profile_update', 'address_update', 'emergency_contact_update', 'resignation', 'permission'];
      const ssRows = ssTypes.map(t => ({
        'Request Type': t.replace(/_/g, ' '),
        Pending:  ssMap[`${t}__pending`]  || 0,
        Approved: ssMap[`${t}__approved`] || 0,
        Rejected: ssMap[`${t}__rejected`] || 0,
      }));

      return ok({
        summary: [
          { label: 'Total Profiles',    value: profiles.length,         color: '#3b82f6' },
          { label: 'Active Employees',  value: statusCounts['active'] || 0, color: '#10b981' },
          { label: 'On Probation',      value: pendingProbation,        color: '#f59e0b' },
          { label: 'Onboarding',        value: pendingOnboarding,       color: '#8b5cf6' },
          { label: 'Suspended',         value: statusCounts['suspended'] || 0, color: '#ef4444' },
          { label: 'Notice Period',     value: statusCounts['notice_period'] || 0, color: '#d97706' },
          { label: 'Separated',         value: (statusCounts['resigned'] || 0) + (statusCounts['terminated'] || 0), color: '#64748b' },
          { label: 'Retired',           value: statusCounts['retired'] || 0, color: '#a78bfa' },
          { label: 'Alumni',            value: statusCounts['alumni'] || 0,   color: '#14b8a6' },
          { label: 'Rehired',           value: rehired,                 color: '#06b6d4' },
        ],
        chart: {
          type: 'bar', title: 'Headcount by Lifecycle Status',
          labels: Object.keys(statusCounts).map(s => s.replace(/_/g, ' ')),
          datasets: [{ label: 'Employees', data: Object.values(statusCounts), backgroundColor: ['#10b981','#f59e0b','#8b5cf6','#3b82f6','#ef4444','#64748b','#06b6d4','#f97316','#a78bfa'] }],
        },
        deptChart: {
          type: 'bar', title: 'Headcount by Department',
          labels: Object.keys(deptCounts),
          datasets: [{ label: 'Employees', data: Object.values(deptCounts), backgroundColor: '#3b82f6' }],
        },
        ssRows,
        ssColumns: ['Request Type', 'Pending', 'Approved', 'Rejected'],
        columns: ['Name', 'Department', 'Designation', 'Status', 'Hire Date', 'Rehire Count'],
        rows: profiles.map(p => ({
          Name:         p.identityId?.legalName || '—',
          Department:   p.department,
          Designation:  p.designation,
          Status:       p.employmentStatus,
          'Hire Date':  fmtDate(p.hireDate),
          'Rehire Count': p.rehireCount || 0,
        })),
      });
    }

    return ok({
      summary: [{ label: 'Report Type', value: type, color: '#3b82f6' }],
      columns: [],
      rows: [],
    });
  } catch (e) {
    console.error(e);
    return fail('Internal server error', 500);
  }
}
