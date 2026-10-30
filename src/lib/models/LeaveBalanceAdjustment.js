import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  typeCode: { type: String, required: true }, days: { type: Number, required: true },
  date: { type: String, required: true }, reason: { type: String, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });
export default mongoose.models.LeaveBalanceAdjustment || mongoose.model('LeaveBalanceAdjustment', schema);
