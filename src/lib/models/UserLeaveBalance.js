import mongoose from 'mongoose';

const PeriodUsageSchema = new mongoose.Schema({
  period:          { type: String, required: true }, // e.g., '2026-Q1', '2026-M04', '2026-H1'
  used:            { type: Number, default: 0 },
  cap:             { type: Number, default: 0 },
}, { _id: false });

const BalanceEntrySchema = new mongoose.Schema({
  typeCode:        { type: String, required: true },
  allocated:       { type: Number, default: 0 },
  used:            { type: Number, default: 0 },
  pending:         { type: Number, default: 0 },
  carriedForward:  { type: Number, default: 0 },
  expiryDate:      { type: Date, default: null },
  periodUsage:     [PeriodUsageSchema],
}, { _id: false });

const UserLeaveBalanceSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  policyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'LeavePolicy', required: true },
  cycleStart: { type: Date, required: true },
  cycleEnd:   { type: Date, required: true },
  balances:   [BalanceEntrySchema],
  lastAccrualMonth: { type: Number, default: -1 }, // month index (0-11) of last accrual run
}, { timestamps: true });

UserLeaveBalanceSchema.index({ userId: 1, cycleStart: -1 });

export default mongoose.models.UserLeaveBalance || mongoose.model('UserLeaveBalance', UserLeaveBalanceSchema);
