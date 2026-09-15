const round = n => Math.round(n * 100) / 100;

/** Default rule matching the original hardcoded structure for backward compatibility. */
export const DEFAULT_RULE = {
  name: 'Standard (India)',
  isDefault: true,
  earnings: [
    { code: 'BASIC', label: 'Basic Pay',             type: 'percent_of_gross', value: 50, taxable: true },
    { code: 'HRA',   label: 'HRA',                   type: 'percent_of_gross', value: 20, taxable: true },
    { code: 'DA',    label: 'Dearness Allowance',     type: 'percent_of_gross', value: 15, taxable: true },
    { code: 'CA',    label: 'Conveyance Allowance',   type: 'percent_of_gross', value: 10, taxable: true },
    { code: 'MA',    label: 'Medical Allowance',      type: 'percent_of_gross', value: 5,  taxable: true },
  ],
  deductions: [
    { code: 'PF',  label: 'Provident Fund', type: 'percent_of_basic_da', value: 12, cap: 1800, enabled: true },
    { code: 'ESI', label: 'ESI',            type: 'percent_of_gross',    value: 0.75, eligibilityMaxGross: 21000, enabled: true },
  ],
  lopConfig: { basis: 'working_days', deductFrom: 'gross', countHalfDay: true, graceDays: 0 },
};

/**
 * Rule-driven payroll calculation engine.
 *
 * @param {Object} params
 * @param {Object}  params.rule         - PayrollRule document (or DEFAULT_RULE)
 * @param {number}  params.grossLPA     - Annual gross salary
 * @param {number}  params.workingDays  - Working days in the cycle
 * @param {number}  params.totalDaysInMonth - Calendar days in the month/cycle
 * @param {number}  params.lopDays      - Loss of Pay days
 * @param {number}  params.retroLopDays - Retroactive LOP days from prior locked cycles
 * @param {Array}   params.overrides    - Per-employee overrides from SalaryStructure
 * @param {Array}   params.adhocBonuses - One-time bonuses for this run [{code,label,amount}]
 */
export function calculatePayroll({
  rule,
  grossLPA,
  workingDays,
  totalDaysInMonth,
  lopDays = 0,
  retroLopDays = 0,
  overrides = [],
  adhocBonuses = [],
}) {
  const activeRule = rule && rule.earnings?.length ? rule : DEFAULT_RULE;
  const monthlyGross = round(grossLPA / 12);

  // ── Earnings ────────────────────────────────────────────────────────────────
  const earningsMap = {};
  const earningsList = [];
  let computedEarningsSum = 0;

  // Pass 1: percent_of_gross and fixed
  for (const comp of activeRule.earnings) {
    if (comp.type === 'remainder' || comp.type === 'percent_of_basic') continue;
    let amount = 0;
    if (comp.type === 'percent_of_gross') amount = round(monthlyGross * comp.value / 100);
    else if (comp.type === 'fixed') amount = round(comp.value);
    earningsMap[comp.code] = amount;
    earningsList.push({ code: comp.code, label: comp.label, amount });
    computedEarningsSum += amount;
  }

  // Pass 2: percent_of_basic (needs BASIC resolved first)
  const basicAmount = earningsMap['BASIC'] || 0;
  for (const comp of activeRule.earnings) {
    if (comp.type !== 'percent_of_basic') continue;
    const amount = round(basicAmount * comp.value / 100);
    earningsMap[comp.code] = amount;
    earningsList.push({ code: comp.code, label: comp.label, amount });
    computedEarningsSum += amount;
  }

  // Pass 3: remainder (auto-balancing component)
  for (const comp of activeRule.earnings) {
    if (comp.type !== 'remainder') continue;
    const amount = round(Math.max(0, monthlyGross - computedEarningsSum));
    earningsMap[comp.code] = amount;
    earningsList.push({ code: comp.code, label: comp.label, amount });
    computedEarningsSum += amount;
  }

  // ── Deductions ──────────────────────────────────────────────────────────────
  const deductionsList = [];
  let totalDeductions = 0;
  const daAmount = earningsMap['DA'] || 0;

  for (const comp of activeRule.deductions) {
    if (comp.enabled === false) continue;
    if (comp.eligibilityMaxGross && monthlyGross > comp.eligibilityMaxGross) continue;

    let amount = 0;
    if (comp.type === 'percent_of_basic_da') {
      amount = round((basicAmount + daAmount) * comp.value / 100);
    } else if (comp.type === 'percent_of_gross') {
      amount = round(monthlyGross * comp.value / 100);
    } else if (comp.type === 'fixed') {
      amount = round(comp.value);
    }
    if (comp.cap) amount = Math.min(amount, comp.cap);

    deductionsList.push({ code: comp.code, label: comp.label, amount });
    totalDeductions += amount;
  }

  // ── LOP ─────────────────────────────────────────────────────────────────────
  const lopCfg = activeRule.lopConfig || DEFAULT_RULE.lopConfig;

  // LOP Base amount calculation
  let lopBase = monthlyGross;
  if (lopCfg.deductFrom === 'basic') {
    lopBase = basicAmount;
  } else if (lopCfg.deductFrom === 'basic_da') {
    lopBase = basicAmount + daAmount;
  }

  // LOP Divisor calculation
  let divisor = workingDays;
  if (lopCfg.basis === 'calendar_days') {
    divisor = totalDaysInMonth || 30;
  } else if (lopCfg.basis === 'fixed_26') {
    divisor = 26;
  } else if (lopCfg.basis === 'fixed_30') {
    divisor = 30;
  }

  const salaryPerDay = divisor > 0 ? round(lopBase / divisor) : 0;

  // Apply grace days if configured
  const graceDays = Number(lopCfg.graceDays) || 0;
  const effectiveLopDays = Math.max(0, lopDays - graceDays);
  const lossOfPayDeduction = round(salaryPerDay * effectiveLopDays);

  if (lossOfPayDeduction > 0) {
    deductionsList.push({ code: 'LOP', label: 'Loss of Pay', amount: lossOfPayDeduction });
    totalDeductions += lossOfPayDeduction;
  }

  // Retroactive LOP Auto-Adjustment
  const retroDays = Number(retroLopDays) || 0;
  const retroLopDeduction = round(salaryPerDay * retroDays);

  if (retroLopDeduction > 0) {
    deductionsList.push({ code: 'RETRO_LOP_ADJ', label: 'Retroactive Loss of Pay Adjustment', amount: retroLopDeduction });
    totalDeductions += retroLopDeduction;
  }

  totalDeductions = round(totalDeductions);

  // ── Bonuses ─────────────────────────────────────────────────────────────────
  const bonusList = [];
  let totalBonuses = 0;

  for (const ovr of overrides) {
    if (ovr.type === 'bonus' && ovr.value > 0) {
      bonusList.push({ code: ovr.code, label: ovr.label || ovr.code, amount: round(ovr.value) });
      totalBonuses += round(ovr.value);
    }
  }
  for (const b of adhocBonuses) {
    if (b.amount > 0) {
      bonusList.push({ code: b.code || 'ADHOC', label: b.label || 'Adhoc Bonus', amount: round(b.amount) });
      totalBonuses += round(b.amount);
    }
  }
  totalBonuses = round(totalBonuses);

  // ── Net Pay ─────────────────────────────────────────────────────────────────
  const netPay = round(monthlyGross + totalBonuses - totalDeductions);

  // ── Legacy flat fields (backward compatibility) ─────────────────────────────
  const legacy = {
    monthlyGross,
    basicPay:            earningsMap['BASIC'] || 0,
    hra:                 earningsMap['HRA']   || 0,
    dearnessAllowance:   earningsMap['DA']    || 0,
    conveyanceAllowance: earningsMap['CA']    || 0,
    medicalAllowance:    earningsMap['MA']    || 0,
    pf:                  deductionsList.find(d => d.code === 'PF')?.amount  || 0,
    esi:                 deductionsList.find(d => d.code === 'ESI')?.amount || 0,
    lossOfPay:           lossOfPayDeduction,
    totalDeductions,
  };

  return {
    monthlyGross,
    earnings:         earningsList,
    deductions:       deductionsList,
    bonuses:          bonusList,
    totalEarnings:    round(computedEarningsSum),
    totalDeductions,
    totalBonuses,
    netPay,
    workingDays,
    salaryPerDay,
    lopDays,
    lossOfPayDeduction,
    legacy,
  };
}
