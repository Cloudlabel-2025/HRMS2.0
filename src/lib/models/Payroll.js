import mongoose from 'mongoose';
import './PayrollRule';

const SalaryStructureSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  grossLPA:{ type: Number, required: true },
  ruleId:  { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRule', default: null },
  overrides: [{
    code:      { type: String, required: true },
    label:     { type: String, default: '' },
    type:      { type: String, enum: ['earning', 'deduction', 'bonus'], default: 'bonus' },
    value:     { type: Number, default: 0 },
    recurring: { type: Boolean, default: true },
  }],
}, { timestamps: true });

const PayrollSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month:      { type: String, required: true },

  // Earnings breakdown
  monthlyGross:{ type: Number },
  basicPay:   { type: Number },
  hra:        { type: Number },
  dearnessAllowance:   { type: Number },
  conveyanceAllowance: { type: Number },
  medicalAllowance:    { type: Number },

  // Dynamic component arrays (new rule-driven system)
  earningsArray:   [{ code: String, label: String, amount: Number, _id: false }],
  deductionsArray: [{ code: String, label: String, amount: Number, _id: false }],
  bonuses:         [{ code: String, label: String, amount: Number, _id: false }],
  totalEarnings:   { type: Number, default: 0 },
  totalBonuses:    { type: Number, default: 0 },
  ruleSnapshot:    { name: String, ruleId: { type: mongoose.Schema.Types.ObjectId } },

  // Deductions
  pf:         { type: Number },
  esi:        { type: Number },
  lossOfPay:  { type: Number, default: 0 },

  // Totals
  totalDeductions: { type: Number },
  netPay:     { type: Number },

  // Attendance — explicit day-breakdown from the stored register.
  // lopDays is derived, never gap arithmetic: lopDays = absentDays + unpaidLeaveDays.
  presentDays:{ type: Number },
  // Integer count of working dates actually turned up (clock-in or real
  // bulk-import source). Distinct from presentDays, the fractional payroll
  // credit (half-day leave = 0.5). Same definition as the Team report card.
  daysWorked: { type: Number, default: 0 },
  absentDays: { type: Number, default: 0 },
  paidLeaveDays: { type: Number, default: 0 },
  unpaidLeaveDays: { type: Number, default: 0 },
  holidayDays:{ type: Number, default: 0 },
  weeklyOffDays:{ type: Number, default: 0 },
  lopDays:    { type: Number, default: 0 },
  // Late-arrival LOP, split by tier so the payslip is auditable:
  // lopDays = absentDays + lateLopDays + unpaidLeaveDays
  lateLopDays:           { type: Number, default: 0 },
  // Lates past lateThreshold but within halfDayThreshold (0.5 day each).
  slightLateDays:        { type: Number, default: 0 },
  // Lates at/over halfDayThreshold (1.0 day each).
  pastThresholdLateDays: { type: Number, default: 0 },
  // Overtime from a late clock-out. Placeholder only — always 0 until the
  // overtime rule is defined. Never contributes to net pay.
  overtimeMinutes:       { type: Number, default: 0 },
  effectiveLopDays: { type: Number, default: 0 },
  graceDaysApplied: { type: Number, default: 0 },
  retroLopDays: { type: Number, default: 0 },
  // Working days actually paid for = workingDays − effectiveLopDays −
  // retroLopDays. A paid leave (full or half) never reduces it. Computed once
  // by payroll-calculator so the payslip never re-derives it.
  payableDays: { type: Number, default: 0 },
  // LOP deduction base (monthlyGross / BASIC / BASIC+DA per rule
  // lopConfig.deductFrom) and the derived per-day rate, kept together so the
  // payslip can show the arithmetic: LOP ₹ = lopBaseAmount ÷ divisor.
  lopBaseAmount: { type: Number, default: 0 },
  workingDays:{ type: Number, default: 0 },
  fullCycleWorkingDays: { type: Number, default: 0 },
  salaryPerDay:{ type: Number, default: 0 },
  holidayDates:[{ type: String }],

  // meta
  cycleLabel:{ type: String },
  runId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  status:     { type: String, enum: ['pending','draft','approved','finalized'], default: 'pending' },
  processedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  processedAt:{ type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  finalizedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  finalizedAt:{ type: Date, default: null },
}, { timestamps: true });

PayrollSchema.index({ userId: 1, month: 1 }, { unique: true });

if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.SalaryStructure;
  delete mongoose.models.Payroll;
}

export const SalaryStructure = mongoose.models.SalaryStructure || mongoose.model('SalaryStructure', SalaryStructureSchema);
export const Payroll         = mongoose.models.Payroll         || mongoose.model('Payroll', PayrollSchema);
