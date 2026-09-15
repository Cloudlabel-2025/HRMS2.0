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

  // Attendance
  presentDays:{ type: Number },
  lopDays:    { type: Number, default: 0 },
  effectiveLopDays: { type: Number, default: 0 },
  graceDaysApplied: { type: Number, default: 0 },
  retroLopDays: { type: Number, default: 0 },
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
