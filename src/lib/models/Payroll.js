import mongoose from 'mongoose';

const SalaryStructureSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  basic:      { type: Number, required: true },
  hra:        { type: Number, default: 0 },
  allowances: { type: Number, default: 0 },
  pf:         { type: Number, default: 0 },
  esi:        { type: Number, default: 0 },
  tds:        { type: Number, default: 0 },
}, { timestamps: true });

const PayrollSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month:      { type: String, required: true },   // 'YYYY-MM'
  basic:      { type: Number },
  hra:        { type: Number },
  allowances: { type: Number },
  grossPay:   { type: Number },
  pf:         { type: Number },
  esi:        { type: Number },
  tds:        { type: Number },
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
