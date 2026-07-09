import mongoose from 'mongoose';

const APPROVAL = { type: String, enum: ['pending', 'approved', 'rejected', 'held'], default: 'pending' };

const LeaveSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  typeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', default: null },
  type:    { type: String, required: true }, // kept for backward compatibility; new records use typeId
  from:   { type: String, required: true },
  to:     { type: String, required: true },
  days:   { type: Number, required: true },
  paidDays: { type: Number, default: 0 },
  unpaidDays: { type: Number, default: 0 },
  halfDay:{ type: Boolean, default: false },
  reason: { type: String, required: true },
  documents: [{ type: String }], // file URLs for supporting documents
  policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeavePolicy', default: null },

  // Overall resolved status
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

  // ── Legacy hardcoded approval fields (kept for backward compatibility) ──
  adminApproval:   { ...APPROVAL },
  adminApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  adminApprovedAt: { type: Date, default: null },
  adminHoldReason: { type: String, default: '' },

  teamAdminApproval:   { ...APPROVAL },
  teamAdminApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  teamAdminApprovedAt: { type: Date, default: null },
  teamAdminHoldReason: { type: String, default: '' },

  tlApproval:   { ...APPROVAL },
  tlApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  tlApprovedAt: { type: Date, default: null },
  tlHoldReason: { type: String, default: '' },

  objectionNotified: { type: Boolean, default: false },

  // ── Dynamic workflow approvals (used by policy-driven leaves) ──
  workflowApprovals: [{
    step:      { type: Number, required: true },
    label:     { type: String },
    action:    { type: String, enum: ['pending', 'approved', 'rejected', 'held'], default: 'pending' },
    approvedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt:{ type: Date, default: null },
    holdReason:{ type: String, default: '' },
    actionType:{ type: String, enum: ['approve', 'review'], default: 'approve' },
  }],

  smeId: { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
}, { timestamps: true });

delete mongoose.models.Leave;
export default mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);
