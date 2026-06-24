import mongoose from 'mongoose';

const SalaryStructureSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  grossLPA:{ type: Number, required: true },
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

  // meta
  cycleLabel:{ type: String },
  status:     { type: String, enum: ['pending','draft','approved','finalized'], default: 'pending' },
  processedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  processedAt:{ type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  finalizedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  finalizedAt:{ type: Date, default: null },
}, { timestamps: true });

PayrollSchema.index({ userId: 1, month: 1 }, { unique: true });

export const SalaryStructure = mongoose.models.SalaryStructure || mongoose.model('SalaryStructure', SalaryStructureSchema);
export const Payroll         = mongoose.models.Payroll         || mongoose.model('Payroll', PayrollSchema);
