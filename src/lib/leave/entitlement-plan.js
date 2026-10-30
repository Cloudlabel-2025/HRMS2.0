import { payrollPeriod, normalizeEntitlementType } from '../payroll-periods.js';
const round = n => Math.round(n * 100) / 100;
const dateString = value => value ? new Date(value).toISOString().slice(0, 10) : '';

// Rebuild from approved/pending requests in leave-date order. Rejected and
// cancelled requests never consume quota. Per-date splits survive cycle edges.
export function buildEntitlementPlan({ leaves, policy, config, today, joined, isChargeDate, adjustments = [] }) {
  const types = (policy.leaveTypeConfigs || []).map(normalizeEntitlementType);
  const byCode = new Map(types.map(type => [type.code, type]));
  const active = leaves.filter(leave => ['approved', 'pending'].includes(leave.status) && (leave.status === 'approved' || !leave.classificationRequired || leave.classifiedAt));
  const result = new Map(), events = [];
  for (const leave of active) {
    const type = byCode.get(leave.typeCode);
    if (!type || type.balanceMode === 'linked') continue;
    const dates = [];
    for (let cursor = new Date(`${leave.from}T12:00:00Z`), end = new Date(`${leave.to}T12:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      if (isChargeDate(date, policy)) dates.push(date);
    }
    // A historical one-day approval remains one day even if the calendar
    // policy was subsequently changed. Multi-day mismatches require review.
    if (leave.from === leave.to) dates.splice(0, dates.length, leave.from);
    // Legacy approvals may predate a change to working Saturdays. When the
    // stored duration exactly matches weekdays, preserve that approved count.
    if (!leave.halfDay && dates.length !== Number(leave.days)) {
      const weekdays = dates.filter(date => ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()));
      if (weekdays.length === Number(leave.days)) dates.splice(0, dates.length, ...weekdays);
    }
    if (Math.abs(dates.length - Number(leave.days)) > 0.001 && !(leave.halfDay && Number(leave.days) === 0.5 && dates.length === 1)) {
      throw new Error(`Leave ${leave._id} (${leave.from}–${leave.to}) has ${leave.days} stored days but ${dates.length} chargeable dates. Review its dates before recalculation.`);
    }
    result.set(String(leave._id), { leave, paidDays: 0, unpaidDays: 0, payrollDaySplit: [] });
    for (const date of dates) events.push({ date, amount: leave.halfDay ? 0.5 : 1, leave, type });
  }
  for (const adjustment of adjustments) {
    const type = byCode.get(adjustment.typeCode);
    if (type) events.push({ date: adjustment.date, adjustment, type, leave: { _id: adjustment._id } });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || Number(!!b.adjustment) - Number(!!a.adjustment) || String(a.leave.createdAt || '').localeCompare(String(b.leave.createdAt || '')) || String(a.leave._id).localeCompare(String(b.leave._id)));
  const entitlementStart = [dateString(joined), dateString(policy.effectiveFrom)].filter(Boolean).sort().at(-1);
  const firstDate = [entitlementStart, ...events.map(row => row.date), today].filter(Boolean).sort()[0];
  const firstPeriod = payrollPeriod(firstDate, config), nowPeriod = payrollPeriod(today, config);
  const banks = new Map(), usage = new Map();
  const snapshots = new Map();
  function advance(type, date) {
    const period = payrollPeriod(date, config);
    const periodSize = type.usagePeriod === 'monthly' ? 1 : type.usagePeriod === 'quarterly' ? 3 : type.usagePeriod === 'half_yearly' ? 6 : 12;
    const index = period.year * 12 + Math.floor(period.month / periodSize) * periodSize;
    const initial = firstPeriod.year * 12 + Math.floor(firstPeriod.month / periodSize) * periodSize;
    let bank = banks.get(type.code);
    if (!bank) { bank = { index: initial - periodSize, available: 0 }; banks.set(type.code, bank); }
    const cap = Number(type.maxUsagePerPeriod) > 0 ? Number(type.maxUsagePerPeriod) : Number(type.annualAllocation || 0) / (12 / periodSize);
    while (bank.index < index) {
      const next = bank.index + periodSize;
      const yearChanged = Math.floor(next / 12) !== Math.floor(bank.index / 12);
      if (!type.unusedPeriodRollover || (yearChanged && !type.carryForwardAllowed)) bank.available = 0;
      if (yearChanged && type.carryForwardMaxDays > 0) bank.available = Math.min(bank.available, type.carryForwardMaxDays);
      bank.available = round(bank.available + (type.isPaid === false ? 0 : cap));
      bank.index = next;
    }
    return bank;
  }
  function captureCurrent() {
    for (const type of types.filter(t => t.balanceMode !== 'linked')) {
      const bank = advance(type, today);
      snapshots.set(type.code, round(bank.available));
    }
  }
  let captured = false;
  for (const event of events) {
    if (!captured && event.date > today) { captureCurrent(); captured = true; }
    const bank = advance(event.type, event.date);
    if (event.adjustment) { bank.available = round(bank.available + Number(event.adjustment.days)); continue; }
    const paid = event.type.isPaid === false ? 0 : round(Math.min(event.amount, Math.max(0, bank.available)));
    bank.available = round(bank.available - paid);
    const unpaid = round(event.amount - paid);
    const row = result.get(String(event.leave._id));
    row.paidDays = round(row.paidDays + paid); row.unpaidDays = round(row.unpaidDays + unpaid);
    row.payrollDaySplit.push({ date: event.date, paidDays: paid, unpaidDays: unpaid });
    const p = payrollPeriod(event.date, config), key = `${p.year}|${event.type.code}`;
    if (!usage.has(key)) usage.set(key, { used: 0, pending: 0, periodUsage: [] });
    const u = usage.get(key), field = event.leave.status === 'approved' ? 'used' : 'pending';
    u[field] = round(u[field] + paid);
    let q = u.periodUsage.find(q => q.period === `Q${p.quarter}`);
    if (!q) { q = { period: `Q${p.quarter}`, used: 0, cap: Number(event.type.maxUsagePerPeriod || 0) }; u.periodUsage.push(q); }
    q.used = round(q.used + paid);
    if (captured && p.year === nowPeriod.year && p.quarter === nowPeriod.quarter) snapshots.set(event.type.code, round(Math.max(0, (snapshots.get(event.type.code) || 0) - paid)));
  }
  if (!captured) captureCurrent();
  const balances = types.filter(t => t.balanceMode !== 'linked').map(type => {
    const u = usage.get(`${nowPeriod.year}|${type.code}`) || { used: 0, pending: 0, periodUsage: [] };
    return { typeCode: type.code, ...u, allocated: round(u.used + u.pending + (snapshots.get(type.code) || 0)), carriedForward: 0 };
  });
  return { leaves: [...result.values()], balances, cycleStart: nowPeriod.yearStart, cycleEnd: nowPeriod.yearEnd,
    quarterStart: nowPeriod.quarterStart, quarterEnd: nowPeriod.quarterEnd };
}
