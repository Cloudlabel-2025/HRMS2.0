import { connectDB } from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin','admin_full'].includes(user.role)) return fail('Access denied', 403);

    await connectDB();
    const { month } = await req.json();
    if (!month) return fail('Month is required (YYYY-MM)');

    const employees = await User.find({ status: 'active' });
    const results = [];

    for (const emp of employees) {
      const existing = await Payroll.findOne({ userId: emp._id, month });
      if (existing?.status === 'finalized') continue;

      const structure = await SalaryStructure.findOne({ userId: emp._id });
      if (!structure) continue;

      const records = await Attendance.find({ userId: emp._id, date: { $regex: `^${month}` } });
      const presentDays = records.filter(r => ['present','late'].includes(r.status)).length;
      
      const { default: Leave } = await import('@/lib/models/Leave');
      const approvedLeaves = await Leave.find({ 
        userId: emp._id, 
        status: 'approved',
        from: { $regex: `^${month}` }
      });
      
      const paidLeaveDays = approvedLeaves
        .filter(l => l.type !== 'Loss of Pay')
        .reduce((sum, l) => sum + l.days, 0);

      const workingDays = 26;
      const lopDays = Math.max(0, workingDays - (presentDays + paidLeaveDays));
      const lopDeduction = lopDays > 0 ? Math.round((structure.basic / workingDays) * lopDays) : 0;
      const grossPay = structure.basic + structure.hra + structure.allowances - lopDeduction;
      const totalDeductions = structure.pf + structure.esi + structure.tds;
      const netPay = grossPay - totalDeductions;

      const payroll = await Payroll.findOneAndUpdate(
        { userId: emp._id, month },
        {
          basic: structure.basic, hra: structure.hra, allowances: structure.allowances,
          grossPay, pf: structure.pf, esi: structure.esi, tds: structure.tds,
          totalDeductions, netPay, presentDays, lopDays,
          status: 'draft', processedBy: user._id, processedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      results.push(payroll);
    }

    await AuditLog.create({
      action: 'Payroll Run', module: 'Payroll', userId: user._id,
      details: `Payroll draft generated for ${month} — ${results.length} employees`,
      severity: 'high',
    });

    return ok({ processed: results.length, month });
  } catch (e) {
    return fail(e.message, 500);
  }
}
