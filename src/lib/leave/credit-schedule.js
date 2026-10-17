export const CREDIT_SCHEDULES = [
  { value: 'upfront', label: 'Yearly (upfront)', periods: 1, unit: 'year' },
  { value: 'monthly', label: 'Monthly', periods: 12, unit: 'month' },
  { value: 'quarterly', label: 'Quarterly', periods: 4, unit: 'quarter' },
  { value: 'half_yearly', label: 'Half-yearly', periods: 2, unit: 'half-year' },
];

export function getCreditSchedule(schedule = 'upfront') {
  return CREDIT_SCHEDULES.find(option => option.value === schedule) || CREDIT_SCHEDULES[0];
}

export function getDaysPerCredit(config) {
  if (config.balanceMode === 'linked') return 0;
  return Number((Number(config.annualAllocation || 0) / getCreditSchedule(config.creditSchedule).periods).toFixed(2));
}

export function getAnnualEntitlement(daysPerCredit, schedule) {
  return Number((Number(daysPerCredit || 0) * getCreditSchedule(schedule).periods).toFixed(2));
}
