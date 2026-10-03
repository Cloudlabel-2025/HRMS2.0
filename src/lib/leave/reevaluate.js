// Retroactive leave re-evaluation for a date whose working-day status changed
// (compensated Saturday override). Pure-calendar recompute plus balance delta.
//
// Idempotent by construction: everything keys off the stored `days`, so
// re-running — or reversing the override — converges instead of compounding.
// Payroll itself is never re-run here; approved leaves whose paid/unpaid
// split moved are flagged with the existing retro machinery
// (isRetroactive / retroAdjustedInPayroll) and the next payroll run of that
// cycle folds the delta in automatically.
import { Leave, LeavePolicy, UserLeaveBalance, Holiday, Payroll } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { getGlobalConfig, getPayrollDay, getCycleMonth, countWorkingDaysInRange } from '@/lib/payroll-cycle';
import { calculatePeriodAllowance, getRelativePeriod } from '@/lib/leave/accrual';
import { syncCalendarRowsForUsers } from '@/lib/attendance-sync';

export function assertSaturdayDate(dateStr) {
  const d = new Date(String(dateStr || '') + 'T00:00:00');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '')) || Number.isNaN(d.getTime()) || d.getDay() !== 6) {
    const err = new Error('Re-evaluation applies to Saturdays only (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }
}

const yearStart = (d) => new Date(new Date(d).getFullYear(), 0, 1);

async function loadPolicyForLeave(leave) {
  if (!leave.policyId) return null;
  return LeavePolicy.findById(leave.policyId).lean().catch(() => null);
}

// The deduction lives in the leave-year cycle; fall back to the live
// current-year cycle (approval-time behaviour) if that doc is gone.
async function loadBalanceForLeave(userId, leave) {
  const years = [...new Set([new Date(leave.createdAt).getFullYear(), new Date().getFullYear()])];
  for (const y of years) {
    const b = await UserLeaveBalance.findOne({ userId, cycleStart: new Date(y, 0, 1) });
    if (b) return b;
  }
  return null;
}

// Paid/unpaid split, mirroring leave creation (leave/route.js) EXACTLY — the
// two must never disagree or a re-evaluation would reintroduce LOP that the
// creation path refuses to apply.
//
// A PAID leave type is always paid in full. The balance is an administrative
// flag: it still moves `used`/`pending` (so over-consumption stays visible) but
// it never clamps payable days. Only an explicitly unpaid type creates LOP.
//
// `available` is returned for reporting/warnings only. The leave's own prior
// reservation is restored into a working copy first — into `used` for approved
// leaves, `pending` for pending ones — so availability does not double-count
// its current deduction. Exported for unit tests.
export function recomputePaidSplit(typeConfig, balanceEntry, balance, days, fromDate, restorePaidDays, restoreField = 'used') {
  if (!typeConfig?.isPaid) return { paidDays: 0, unpaidDays: days, available: 0 };
  const restored = {
    ...balanceEntry,
    [restoreField]: Math.max(0, Number(balanceEntry?.[restoreField] || 0) - Number(restorePaidDays || 0)),
  };
  const periodAllowed = Math.max(0, calculatePeriodAllowance(typeConfig, restored, balance.cycleStart, new Date(fromDate)));
  const overallAvailable = Math.max(0,
    Number(restored.allocated || 0) + Number(restored.carriedForward || 0)
    - Number(restored.used || 0) - Number(restored.pending || 0));
  const available = Number(Math.min(overallAvailable, periodAllowed).toFixed(2));
  return { paidDays: days, unpaidDays: 0, available };
}

// Delta twin of recordPeriodUsageSplit: same date enumeration and per-day
// shares, so the adjustment lands in exactly the buckets the original
// recording used. Decrements clamp at 0 and never invent negative buckets
// (the old recording may be absent for pre-fix rows). Exported for tests.
export function adjustPeriodUsage(balanceEntry, usagePeriod, cycleStart, fromStr, toStr, delta) {
  const total = Number(delta || 0);
  if (!(Math.abs(total) > 0)) return [];
  if (!balanceEntry.periodUsage) balanceEntry.periodUsage = [];
  const dates = [];
  const f = new Date(`${fromStr}T00:00:00`);
  const t = new Date(`${toStr}T00:00:00`);
  for (let cur = new Date(f); cur <= t; cur.setDate(cur.getDate() + 1)) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`);
  }
  if (!dates.length) dates.push(fromStr);
  const perDay = Number((total / dates.length).toFixed(2));
  let assigned = 0;
  const out = [];
  dates.forEach((ds, i) => {
    const amt = i === dates.length - 1 ? Number((total - assigned).toFixed(2)) : perDay;
    assigned = Number((assigned + amt).toFixed(2));
    const { code } = getRelativePeriod(usagePeriod, cycleStart, new Date(`${ds}T00:00:00`));
    let row = balanceEntry.periodUsage.find(pu => (pu.period || pu.periodCode) === code);
    if (!row) {
      if (amt <= 0) { out.push({ code, days: 0, skipped: true }); return; }
      row = { period: code, used: 0, cap: 0 };
      balanceEntry.periodUsage.push(row);
    }
    row.used = Math.max(0, Number(((row.used || 0) + amt).toFixed(2)));
    out.push({ code, days: amt });
  });
  return out;
}

function payrollMonthKey(dateStr, config) {
  const startDay = getPayrollDay(config?.payrollStartDay, 26);
  const { year, month } = getCycleMonth(dateStr, startDay);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

async function evaluateLeave(leave, config, holidays) {
  const base = {
    leaveId: String(leave._id),
    userId: String(leave.userId),
    type: leave.type,
    typeCode: leave.typeCode,
    from: leave.from,
    to: leave.to,
    status: leave.status,
  };
  const policy = await loadPolicyForLeave(leave);
  if (!policy) return { ...base, skipped: true, reason: 'Leave policy not found' };
  const typeConfig = policy.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
  if (!typeConfig) return { ...base, skipped: true, reason: 'Leave type config not found' };

  const newDays = countWorkingDaysInRange(leave.from, leave.to, config, holidays, {
    countWeekends: !!policy.countWeekends,
    countHolidays: !!policy.countHolidays,
  });
  if (newDays === leave.days) return { ...base, unchanged: true, days: leave.days };

  const balance = await loadBalanceForLeave(leave.userId, leave);
  if (!balance) return { ...base, skipped: true, reason: 'Leave balance record not found' };
  const entry = balance.balances.find(b => b.typeCode === leave.typeCode);
  if (!entry) return { ...base, skipped: true, reason: 'Balance entry not found' };

  const oldPaidDays = leave.paidDays ?? leave.days;
  // Restore this leave's own recordings into a working copy before
  // recomputing, so neither the overall availability nor the period cap
  // double-counts its current deduction. (The apply path performs the same
  // restore-then-add on the live entry; the stored delta stays identical.)
  const restoredEntry = JSON.parse(JSON.stringify(entry));
  if (typeConfig.maxUsagePerPeriod > 0) {
    adjustPeriodUsage(restoredEntry, typeConfig.usagePeriod, balance.cycleStart, leave.from, leave.to, -oldPaidDays);
  }
  const { paidDays: newPaidDays, unpaidDays: newUnpaidDays } = recomputePaidSplit(
    typeConfig, restoredEntry, balance, newDays, leave.from, oldPaidDays,
    leave.status === 'approved' ? 'used' : 'pending');
  const delta = Number((newPaidDays - oldPaidDays).toFixed(2));

  // Payroll visibility: is the owning cycle already closed? The money itself
  // moves via retro flags, never by touching the closed run.
  const monthKey = payrollMonthKey(leave.from, config);
  const payroll = await Payroll.findOne({ userId: leave.userId, month: monthKey }).select('status').lean().catch(() => null);

  return {
    ...base,
    oldDays: leave.days,
    newDays,
    oldPaidDays,
    newPaidDays,
    oldUnpaidDays: leave.unpaidDays ?? 0,
    newUnpaidDays,
    balanceDelta: delta,
    balanceField: leave.status === 'approved' ? 'used' : 'pending',
    payrollMonth: monthKey,
    payrollStatus: payroll?.status || null,
    payrollClosed: ['approved', 'finalized'].includes(payroll?.status),
  };
}

export async function previewLeaveDateImpact(dateStr) {
  assertSaturdayDate(dateStr);
  const config = await getGlobalConfig();
  const holidays = await Holiday.find({}).lean().catch(() => []);

  // Half-day leaves carry a fixed 0.5 — a calendar flip never changes them.
  const leaves = await Leave.find({
    status: { $in: ['approved', 'pending'] },
    halfDay: { $ne: true },
    from: { $lte: dateStr },
    to: { $gte: dateStr },
  }).lean();

  const changed = [];
  const skipped = [];
  let unchanged = 0;
  for (const leave of leaves) {
    const r = await evaluateLeave(leave, config, holidays);
    if (r.skipped) skipped.push(r);
    else if (r.unchanged) unchanged += 1;
    else changed.push(r);
  }

  // Attendance consequence preview (same shape as the holiday-undo preview):
  // past non-worked rows on a newly-working date flip to absent on apply.
  const rows = await Attendance
    .find({ date: dateStr }).select('status clockIn importedPresence').lean().catch(() => []);
  const worked = rows.filter(r => r.clockIn || r.importedPresence?.source).length;
  const onLeave = rows.filter(r => !r.clockIn && !r.importedPresence?.source && (r.status === 'leave' || r.status === 'half_day')).length;

  return {
    date: dateStr,
    changed,
    skipped,
    unchanged,
    totals: {
      leavesChanged: changed.length,
      dayDelta: Number(changed.reduce((s, c) => s + (c.newDays - c.oldDays), 0).toFixed(2)),
      balanceDelta: Number(changed.reduce((s, c) => s + (c.balanceDelta || 0), 0).toFixed(2)),
      closedCycles: [...new Set(changed.filter(c => c.payrollClosed).map(c => c.payrollMonth))],
    },
    attendance: { total: rows.length, worked, onLeave, nonWorked: rows.length - worked - onLeave },
  };
}

export async function applyLeaveDateImpact(dateStr, actor, ip = '') {
  const preview = await previewLeaveDateImpact(dateStr);
  const applied = [];
  const skipped = [...preview.skipped];
  const conflicts = [];

  for (const change of preview.changed) {
    try {
      const leave = await Leave.findById(change.leaveId);
      const policy = await loadPolicyForLeave(leave);
      const typeConfig = policy?.leaveTypeConfigs?.find(c => c.code === leave.typeCode);
      const balance = await loadBalanceForLeave(leave.userId, leave);
      const entry = balance?.balances.find(b => b.typeCode === leave.typeCode);
      if (!leave || !typeConfig || !balance || !entry) {
        skipped.push({ ...change, skipped: true, reason: 'Record changed during preview' });
        continue;
      }
      // Recompute against live state (idempotent: converges even if the
      // preview is stale, because the delta keys off stored days).
      const delta = Number((change.newPaidDays - (leave.paidDays ?? leave.days)).toFixed(2));
      if (leave.status === 'approved') {
        entry.used = Math.max(0, Number(((entry.used || 0) + delta).toFixed(2)));
      } else {
        entry.pending = Math.max(0, Number(((entry.pending || 0) + delta).toFixed(2)));
      }
      if (typeConfig.maxUsagePerPeriod > 0) {
        adjustPeriodUsage(entry, typeConfig.usagePeriod, balance.cycleStart, leave.from, leave.to, delta);
      }
      try {
        await balance.save();
      } catch (e) {
        if (e?.name === 'VersionError') { conflicts.push({ ...change, reason: 'Balance changed concurrently' }); continue; }
        throw e;
      }
      leave.days = change.newDays;
      leave.paidDays = change.newPaidDays;
      leave.unpaidDays = change.newUnpaidDays;
      if (leave.status === 'approved' && (change.newPaidDays !== change.oldPaidDays || change.newUnpaidDays !== change.oldUnpaidDays)) {
        leave.isRetroactive = true;
        leave.retroAdjustedInPayroll = false;
        leave.retroPayrollRunId = null;
      }
      await leave.save();
      applied.push(change);
    } catch (e) {
      skipped.push({ ...change, skipped: true, reason: e?.message || 'Apply failed' });
    }
  }

  // Flip attendance for the date the same way a deleted holiday does: past
  // non-worked rows may become absent, today/future never do.
  const n = new Date();
  const todayStr = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  let synced = null;
  try {
    const config = await getGlobalConfig();
    const holidays = await Holiday.find({}).select('date workingDayOverride').lean().catch(() => []);
    const users = await User.find({ status: 'active' }).select('_id').lean().catch(() => []);
    synced = await syncCalendarRowsForUsers({
      userIds: users.map(u => u._id),
      fromDate: dateStr,
      toDate: dateStr,
      config,
      holidays,
      todayStr: null,
      allowTodayAbsent: dateStr <= todayStr,
    });
  } catch (e) { console.error('Leave re-evaluation sync failed:', e?.message || e); }

  try {
    // Lazy import: middleware pulls the DB client, which must not load in
    // unit tests that only exercise the pure recompute helpers below.
    const { auditLog } = await import('@/lib/middleware');
    await auditLog('Leave Re-evaluated (Working Saturday)', 'Leave', actor?._id || null,
      `Re-evaluated leave overlapping ${dateStr}: ${applied.length} updated, ${skipped.length} skipped, ${conflicts.length} conflicts`,
      'medium', ip, null, null);
  } catch { /* non-fatal */ }

  return { date: dateStr, applied, skipped, conflicts, synced, totals: preview.totals };
}
