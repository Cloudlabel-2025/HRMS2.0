import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:       { type: String, required: true },          // 'YYYY-MM-DD'
  clockIn:    { type: String, default: null },           // 'HH:MM'
  clockOut:   { type: String, default: null },
  hoursWorked:{ type: Number, default: 0 },              // in minutes
  baseHoursWorked: { type: Number, default: 0 },
  breakDeduction: { type: Number, default: 0 },
  breaks: [{
    type: { type: String, enum: ['break', 'lunch'], required: true },
    start: { type: String, default: '' },
    end: { type: String, default: null },
  }],
  workProgress: [{
    type: { type: String, enum: ['task', 'break', 'lunch'], default: 'task' },
    taskDetails: { type: String, default: '' },
    startTime: { type: String, default: '' },
    endTime: { type: String, default: null },
    status: { type: String, enum: ['pending', 'work_in_progress', 'completed', 'task_blocked', 'stopped'], default: 'work_in_progress' },
    remarks: { type: String, default: '' },
    feedback: { type: String, default: '' },
  }],
  status:     { type: String, enum: ['present','absent','late','leave','half_day','holiday'], default: 'absent' },
  lateFlag:   { type: Boolean, default: false },
  note:       { type: String, default: '' },
  smeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
}, { timestamps: true });

AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

export default mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
