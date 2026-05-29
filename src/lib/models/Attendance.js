import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:       { type: String, required: true },          // 'YYYY-MM-DD'
  clockIn:    { type: String, default: null },           // 'HH:MM'
  clockOut:   { type: String, default: null },
  hoursWorked:{ type: Number, default: 0 },              // in minutes
  status:     { type: String, enum: ['present','absent','late','leave','holiday'], default: 'absent' },
  lateFlag:   { type: Boolean, default: false },
  note:       { type: String, default: '' },
  smeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
}, { timestamps: true });

AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
