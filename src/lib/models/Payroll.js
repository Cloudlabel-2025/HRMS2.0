import mongoose from 'mongoose';

const SalaryStructureSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  // Earnings
  da:      { type: Number, required: true },  // Dearness Allowance
  hra:     { type: Number, required: true },  // House Rent Allowance
  ca:      { type: Number, required: true },  // Conveyance Allowances
  medical: { type: Number, required: true },  // Medical Allowances
  bonus:   { type: Number, default: 0 },      // Bonus (optional)
  // Deductions
  epfo:            { type: Number, required: true },  // EPFO
  esi:             { type: Number, required: true },  // ESI
  professionalTax: { type: Number, default: 0 },  // Professional Tax
  lop:             { type: Number, default: 0 },  // Loss of Pay
  loan:            { type: Number, default: 0 },  // Loan
}, { timestamps: true });

const PayrollSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month:      { type: String, required: true },   // 'YYYY-MM'
  da:         { type: Number },
  hra:        { type: Number },
  ca:         { type: Number },
  medical:    { type: Number },
  bonus:      { type: Number },
  grossPay:   { type: Number },
  epfo:            { type: Number },
  esi:             { type: Number },
  professionalTax: { type: Number },
  lop:             { type: Number },
  loan:            { type: Number },
  totalDeductions: { type: Number },
  netPay:     { type: Number },
  presentDays:{ type: Number },
  cycleLabel:{ type: String },
  lopDays:    { type: Number, default: 0 },
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
