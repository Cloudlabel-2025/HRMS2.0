import mongoose from 'mongoose';

const APPROVAL = { type: String, enum: ['pending', 'approved', 'rejected', 'held'], default: 'pending' };

const LeaveSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    {
    type: String,
    enum: ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave',
           'Paternity Leave', 'Compensatory Leave', 'Loss of Pay'],
    required: true,
  },
  from:   { type: String, required: true },
  to:     { type: String, required: true },
  days:   { type: Number, required: true },
  reason: { type: String, required: true },

  // Overall resolved status
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

  // Step 1 — Admin (super_admin / admin_full) — must act first
  adminApproval:   { ...APPROVAL },
  adminApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  adminApprovedAt: { type: Date, default: null },
  adminHoldReason: { type: String, default: '' },

  // Step 2a — Team Admin (notified after admin approves, optional objection)
  teamAdminApproval:   { ...APPROVAL },
  teamAdminApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  teamAdminApprovedAt: { type: Date, default: null },
  teamAdminHoldReason: { type: String, default: '' },

  // Step 2b — Team Lead (notified after admin approves, optional objection)
  tlApproval:   { ...APPROVAL },
  tlApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  tlApprovedAt: { type: Date, default: null },
  tlHoldReason: { type: String, default: '' },

  // Track if step-2 notifications have been sent
  objectionNotified: { type: Boolean, default: false },

  smeId: { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
}, { timestamps: true });

export default mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);
