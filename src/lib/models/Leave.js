import mongoose from 'mongoose';

const APPROVAL = { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' };

const LeaveSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    {
    type: String,
    enum: ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Maternity Leave',
           'Paternity Leave', 'Compensatory Leave', 'Loss of Pay'],
    required: true,
  },
  from:   { type: String, required: true },  // 'YYYY-MM-DD'
  to:     { type: String, required: true },
  days:   { type: Number, required: true },
  reason: { type: String, required: true },

  // Overall resolved status
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

  // Level 1 — Team Admin
  teamAdminApproval:   { ...APPROVAL },
  teamAdminApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  teamAdminApprovedAt: { type: Date, default: null },

  // Level 2 — Team Lead
  tlApproval:   { ...APPROVAL },
  tlApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  tlApprovedAt: { type: Date, default: null },

  // Level 3 — Admin Full / Super Admin
  mgmtApproval:   { ...APPROVAL },
  mgmtApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  mgmtApprovedAt: { type: Date, default: null },

  smeId: { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
}, { timestamps: true });

export default mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);
