import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  timezone: { type: String, required: true },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  revision: { type: Number, default: 1 },
  reason: { type: String, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  history: [{ revision: Number, action: String, reason: String,
    snapshot: mongoose.Schema.Types.Mixed, actor: mongoose.Schema.Types.ObjectId, at: Date,
    attendanceBefore: mongoose.Schema.Types.Mixed, attendanceAfter: mongoose.Schema.Types.Mixed,
    payrollBefore: [mongoose.Schema.Types.Mixed] }],
}, { timestamps: true });
schema.index({ userId: 1, date: 1 }, { unique: true });
if (mongoose.models.ShiftDayOverride && !mongoose.models.ShiftDayOverride.schema.path('history').schema.path('payrollBefore')) {
  delete mongoose.models.ShiftDayOverride;
  delete mongoose.connection.models.ShiftDayOverride;
}
export default mongoose.models.ShiftDayOverride || mongoose.model('ShiftDayOverride', schema);
