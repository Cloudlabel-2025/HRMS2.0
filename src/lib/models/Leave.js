import mongoose from 'mongoose';

const APPROVAL = { type: String, enum: ['pending', 'approved', 'rejected', 'held'], default: 'pending' };

const LeaveSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  typeCode: { type: String, required: true, default: 'CL' },
  type:    { type: String, required: true }, // kept for backward compatibility; stores leave type name
  from:   { type: String, required: true },
  to:     { type: String, required: true },
  days:   { type: Number, required: true },
  paidDays: { type: Number, default: 0 },
  unpaidDays: { type: Number, default: 0 },
  halfDay:{ type: Boolean, default: false },
  halfDayType:{ type: String, enum: ['first_half', 'second_half'], default: null },
  reason: { type: String, required: true },
  documents: [{ type: String }], // file URLs for supporting documents
  policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'LeavePolicy', default: null },

  // Overall resolved status
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  // Guards balance movement against repeat approvals in legacy and policy workflows.
  balanceApplied: { type: Boolean, default: false },

  // Retroactive Payroll Auto-Adjustment Flags
  isRetroactive: { type: Boolean, default: false },
  retroAdjustedInPayroll: { type: Boolean, default: false },
  retroPayrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', default: null },

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

LeaveSchema.pre('validate', function() {
  if (!this.typeCode) {
    if (this.type) {
      const t = this.type.toLowerCase();
      if (t.includes('casual')) this.typeCode = 'CL';
      else if (t.includes('sick')) this.typeCode = 'SL';
      else if (t.includes('privilege') || t.includes('earned')) this.typeCode = 'PL';
      else if (t.includes('loss') || t.includes('unpaid') || t === 'lop') this.typeCode = 'LOP';
      else if (t.includes('maternity')) this.typeCode = 'ML';
      else if (t.includes('paternity')) this.typeCode = 'PATL';
      else this.typeCode = this.type;
    } else {
      this.typeCode = 'CL';
    }
  }
});

delete mongoose.models.Leave;
export default mongoose.models.Leave || mongoose.model('Leave', LeaveSchema);
