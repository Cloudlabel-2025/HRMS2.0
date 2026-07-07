import mongoose from 'mongoose';

const BalanceEntrySchema = new mongoose.Schema({
  typeId:          { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
  allocated:       { type: Number, default: 0 },
  used:            { type: Number, default: 0 },
  pending:         { type: Number, default: 0 },
  carriedForward:  { type: Number, default: 0 },
  expiryDate:      { type: Date, default: null },
}, { _id: false });

const UserLeaveBalanceSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  policyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'LeavePolicy', required: true },
  cycleStart: { type: Date, required: true },
  cycleEnd:   { type: Date, required: true },
  balances:   [BalanceEntrySchema],
}, { timestamps: true });

UserLeaveBalanceSchema.index({ userId: 1, cycleStart: -1 });

export default mongoose.models.UserLeaveBalance || mongoose.model('UserLeaveBalance', UserLeaveBalanceSchema);
