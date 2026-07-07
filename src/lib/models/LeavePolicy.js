import mongoose from 'mongoose';

const LeaveTypeConfigSchema = new mongoose.Schema({
  typeId:               { type: mongoose.Schema.Types.ObjectId, ref: 'LeaveType', required: true },
  enabled:              { type: Boolean, default: true },
  annualAllocation:     { type: Number, default: 0 },
  isPaid:               { type: Boolean, default: true },
  maxConsecutiveDays:   { type: Number, default: 0 },
  minGapDays:           { type: Number, default: 0 },
  requiresDocuments:    { type: Boolean, default: false },
  allowHalfDay:         { type: Boolean, default: false },
  genderRestriction:    { type: String, enum: ['all', 'male', 'female', 'maternity', 'paternity'], default: 'all' },
  carryForwardAllowed:  { type: Boolean, default: false },
  carryForwardMaxDays:  { type: Number, default: 0 },
  carryForwardExpiryMonths: { type: Number, default: 0 },
  encashmentAllowed:    { type: Boolean, default: false },
  encashmentMaxDays:    { type: Number, default: 0 },
  encashmentRatePercent:{ type: Number, default: 100 },
  probationAllowed:     { type: Boolean, default: true },
  probationAllocation:  { type: Number, default: 0 },
  accrualMode:          { type: String, enum: ['upfront', 'monthly'], default: 'upfront' },
  prorateForNewJoiners: { type: Boolean, default: false },
  noticePeriodDays:     { type: Number, default: 0 },
  requireDocsIfConsecutiveDays: { type: Number, default: 0 },
}, { _id: false });

const WorkflowStepSchema = new mongoose.Schema({
  step:               { type: Number, required: true },
  label:              { type: String, required: true },
  approverRoles:      [{ type: String }],
  actionType:         { type: String, enum: ['approve', 'review'], default: 'approve' },
  required:           { type: Boolean, default: true },
  escalateAfterHours: { type: Number, default: 0 },
}, { _id: false });

const LeavePolicySchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  isDefault:   { type: Boolean, default: false },
  status:      { type: String, enum: ['active', 'archived'], default: 'active' },
  effectiveFrom: { type: Date, required: true },
  effectiveTo:   { type: Date, default: null },

  applicableRoles:         [{ type: String }],
  applicableDepartments:   [{ type: String }],
  applicableEmploymentTypes: [{ type: String }],
  requireProbationCompletion: { type: Boolean, default: false },
  genderRestriction:       { type: String, enum: ['all', 'male', 'female'], default: 'all' },

  leaveTypeConfigs: [LeaveTypeConfigSchema],

  approvalWorkflow: [WorkflowStepSchema],

  maxPendingApplications: { type: Number, default: 1 },
  countWeekends:          { type: Boolean, default: false },
  countHolidays:          { type: Boolean, default: false },
}, { timestamps: true });

LeavePolicySchema.pre('save', async function (next) {
  if (this.isDefault) {
    await mongoose.model('LeavePolicy').updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { isDefault: false }
    );
  }
  next();
});

export default mongoose.models.LeavePolicy || mongoose.model('LeavePolicy', LeavePolicySchema);
