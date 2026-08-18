import mongoose from 'mongoose';

const ShiftSchema = new mongoose.Schema({
  name:             { type: String, required: true },
  startTime:        { type: String, required: true },
  endTime:          { type: String, required: true },
  days:             [{ type: String }],
  expectedHours:    { type: Number, default: 480 },
  absentThreshold:  { type: Number, default: 240 },
  lateThreshold:    { type: Number, default: 15 },
  earlyLoginWindow: { type: Number, default: 120 },
  breaks: [{
    name:        { type: String, default: 'Break' },
    type:        { type: String, required: true },
    maxDuration: { type: Number, required: true },
    maxCount:    { type: Number, default: 1 },
  }],
  autoLogoutAfterShiftEnd: { type: Number, default: 360 },
  halfDayThreshold:        { type: Number, default: 180 },
}, { timestamps: true });

ShiftSchema.index({ name: 1 });

export default mongoose.models.Shift || mongoose.model('Shift', ShiftSchema);
