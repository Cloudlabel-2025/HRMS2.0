import { connectDB } from '@/lib/db';
import { Budget, Expense } from '@/lib/models/index';
import { Payroll } from '@/lib/models/Payroll';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const adminOnly = user => ['super_admin', 'admin_full'].includes(user.role);

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!adminOnly(user)) return fail('Access denied', 403);
    await connectDB();
    const { searchParams } = new URL(req.url);
    const year = Number(searchParams.get('year') || new Date().getFullYear());
    const budgets = await Budget.find({ department: 'Organisation', year, month: { $gte: 1, $lte: 12 } }).lean();
    const expenses = await Expense.find({ status: 'approved', date: { $regex: `^${year}-` } }).lean();
    const payrolls = await Payroll.find({ month: { $regex: `^${year}-` }, status: { $in: ['approved', 'finalized'] } }).lean();
    const journal = [
      ...budgets.map(b => ({ date: `${b.year}-${String(b.month).padStart(2, '0')}-01`, type: 'budget_allocation', description: `Monthly budget allocation`, debitAccount: 'Cash / Bank', creditAccount: 'Budget Reserve', amount: b.allocated })),
      ...expenses.map(e => ({ date: e.date, type: 'expense', description: e.description, debitAccount: `Expense: ${e.category}`, creditAccount: 'Cash / Bank', amount: e.amount })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    const ledgerMap = {};
    for (const entry of journal) {
      for (const [account, debit, credit] of [[entry.debitAccount, entry.amount, 0], [entry.creditAccount, 0, entry.amount]]) {
        if (!ledgerMap[account]) ledgerMap[account] = { account, debit: 0, credit: 0 };
        ledgerMap[account].debit += debit; ledgerMap[account].credit += credit;
      }
    }
    const ledger = Object.values(ledgerMap).map(item => ({ ...item, balance: item.debit - item.credit }));
    const allocated = budgets.reduce((sum, b) => sum + b.allocated, 0);
    const spent = expenses.reduce((sum, e) => sum + e.amount, 0);
    const payroll = { gross: payrolls.reduce((sum, p) => sum + (p.monthlyGross || 0), 0), deductions: payrolls.reduce((sum, p) => sum + (p.totalDeductions || 0), 0), netPay: payrolls.reduce((sum, p) => sum + (p.netPay || 0), 0), count: payrolls.length };
    return ok({ journal, ledger, trialBalance: ledger, balanceSheet: { cash: allocated - spent, budgetReserve: allocated - spent, allocated, spent }, payroll });
  } catch (e) { return fail(e.message, 500); }
}
