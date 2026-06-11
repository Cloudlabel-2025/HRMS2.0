import mongoose from 'mongoose';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  SEPARATION_TYPES,
  SETTLEMENT_STATUSES,
} from '@/lib/core/constants';

const SeparationSchema = new mongoose.Schema({
  separationType:        { type: String, enum: SEPARATION_TYPES, default: 'other' },
  reason:                { type: String, default: '' },
  noticePeriodDays:      { type: Number, default: 0 },
  lastWorkingDate:       { type: Date, default: null },
  settlementStatus:      { type: String, enum: SETTLEMENT_STATUSES, default: 'pending' },
  exitInterviewComplete: { type: Boolean, default: false },
  approvedByUserId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt:            { type: Date, default: null },
  clearedAt:             { type: Date, default: null },
}, { _id: false });

const ReportingLineSchema = new mongoose.Schema({
  managerIdentityId:    { type: mongoose.Schema.Types.ObjectId, ref: 'UsrIdentity', default: null },
  teamLeadIdentityId:   { type: mongoose.Schema.Types.ObjectId, ref: 'UsrIdentity', default: null },
  teamAdminIdentityId:  { type: mongoose.Schema.Types.ObjectId, ref: 'UsrIdentity', default: null },
}, { _id: false });

const CompensationSnapshotSchema = new mongoose.Schema({
  currency:  { type: String, default: 'INR' },
  grade:     { type: String, default: '' },
  payGroup:  { type: String, default: '' },
  band:      { type: String, default: '' },
}, { _id: false });

const EmpProfileSchema = new mongoose.Schema({
  identityId:          { type: mongoose.Schema.Types.ObjectId, ref: 'UsrIdentity', required: true, unique: true, index: true },
  employeeNumber:      { type: String, required: true, unique: true, index: true, trim: true },

  employmentType:      { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
  employmentStatus:    { type: String, enum: EMPLOYMENT_STATUSES, default: 'onboarding', index: true },

  department:          { type: String, required: true, index: true, trim: true },
  designation:         { type: String, required: true, trim: true },
  businessUnit:        { type: String, default: '' },
  workLocation:        { type: String, default: '' },
  shift:               { type: String, default: 'Morning (9AM-6PM)' },

  hireDate:            { type: Date, default: null },
  probationStartDate:   { type: Date, default: null },
  probationEndDate:     { type: Date, default: null },
  confirmationDate:     { type: Date, default: null },
  rehireCount:          { type: Number, default: 0 },
  originalHireDate:     { type: Date, default: null },

  reportingLine:        { type: ReportingLineSchema, default: () => ({}) },
  compensationSnapshot: { type: CompensationSnapshotSchema, default: () => ({}) },

  separation:           { type: SeparationSchema, default: () => ({}) },

  sourceSystem:         { type: String, enum: ['manual', 'recruitment', 'migration', 'rehire', 'import'], default: 'manual' },
  notes:                { type: String, default: '' },
}, { timestamps: true, minimize: false, collection: 'emp_profiles' });

EmpProfileSchema.statics.generateEmployeeNumber = async function (hireDate) {
  const year = hireDate ? new Date(hireDate).getFullYear() : new Date().getFullYear();
  const count = await this.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  return `CHC-${year}-${seq}`;
};

EmpProfileSchema.pre('validate', function () {
  if (!this.originalHireDate && this.hireDate) {
    this.originalHireDate = this.hireDate;
  }
});

EmpProfileSchema.index({ department: 1, employmentStatus: 1 });
EmpProfileSchema.index({ identityId: 1, employmentStatus: 1 });

export default mongoose.models.EmpProfile || mongoose.model('EmpProfile', EmpProfileSchema, 'emp_profiles');