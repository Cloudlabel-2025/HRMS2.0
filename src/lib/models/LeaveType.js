import mongoose from 'mongoose';

const LeaveTypeSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  code:        { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  color:       { type: String, default: '#3b82f6' },
  icon:        { type: String, default: 'bi-calendar-check' },
  sortOrder:   { type: Number, default: 0 },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.models.LeaveType || mongoose.model('LeaveType', LeaveTypeSchema);
