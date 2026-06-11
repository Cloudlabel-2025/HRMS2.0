import mongoose from 'mongoose';
import crypto from 'crypto';
import {
  ADDRESS_TYPES,
  GENDER_VALUES,
  IDENTITY_STATUSES,
  MARITAL_STATUS_VALUES,
} from '@/lib/core/constants';

const SensitiveIdentifierSchema = new mongoose.Schema({
  encryptedValue: { type: String, default: null, select: false },
  hashValue:      { type: String, default: '', index: true, select: false },
  maskedValue:    { type: String, default: '' },
  last4:          { type: String, default: '' },
  isVerified:     { type: Boolean, default: false },
  verifiedAt:     { type: Date, default: null },
  source:         { type: String, default: 'manual' },
}, { _id: false });

const AddressHistorySchema = new mongoose.Schema({
  addressType:   { type: String, enum: ADDRESS_TYPES, default: 'current' },
  line1:         { type: String, required: true, trim: true },
  line2:         { type: String, default: '' },
  city:          { type: String, required: true, trim: true },
  state:         { type: String, required: true, trim: true },
  country:       { type: String, required: true, trim: true, default: 'India' },
  postalCode:    { type: String, required: true, trim: true },
  landmark:      { type: String, default: '' },
  isCurrent:     { type: Boolean, default: false },
  effectiveFrom: { type: Date, default: Date.now },
  effectiveTo:   { type: Date, default: null },
  source:        { type: String, default: 'manual' },
}, { _id: false });

const EmergencyContactSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  relation:   { type: String, required: true, trim: true },
  phone:      { type: String, required: true, trim: true },
  email:      { type: String, default: '' },
  isPrimary:  { type: Boolean, default: false },
}, { _id: false });

const UsrIdentitySchema = new mongoose.Schema({
  identityCode:     { type: String, required: true, unique: true, index: true, trim: true },
  authUserId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, unique: true, sparse: true, index: true },

  legalFirstName:   { type: String, required: true, trim: true },
  legalMiddleName:  { type: String, default: '' },
  legalLastName:    { type: String, default: '' },
  legalName:        { type: String, required: true, trim: true },
  preferredName:    { type: String, default: '' },
  displayName:      { type: String, default: '' },

  primaryEmail:     { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
  personalPhone:    { type: String, default: '' },
  secondaryPhone:   { type: String, default: '' },
  dateOfBirth:      { type: Date, default: null },
  gender:           { type: String, enum: GENDER_VALUES, default: 'prefer_not_to_say' },
  maritalStatus:    { type: String, enum: MARITAL_STATUS_VALUES, default: 'prefer_not_to_say' },
  nationality:      { type: String, default: 'Indian' },
  bloodGroup:       { type: String, default: '' },

  identifiers: {
    pan:    { type: SensitiveIdentifierSchema, default: () => ({}) },
    aadhaar:{ type: SensitiveIdentifierSchema, default: () => ({}) },
  },

  addressHistory:   { type: [AddressHistorySchema], default: [] },
  emergencyContacts:{ type: [EmergencyContactSchema], default: [] },

  recordStatus:     { type: String, enum: IDENTITY_STATUSES, default: 'active', index: true },
  sourceSystem:     { type: String, enum: ['manual', 'recruitment', 'migration', 'rehire', 'import'], default: 'manual' },
  notes:            { type: String, default: '' },
}, { timestamps: true, minimize: false, collection: 'usr_identities' });

UsrIdentitySchema.pre('validate', function () {
  const first = String(this.legalFirstName || '').trim();
  const middle = String(this.legalMiddleName || '').trim();
  const last = String(this.legalLastName || '').trim();
  const preferred = String(this.preferredName || '').trim();

  const legalParts = [first, middle, last].filter(Boolean);
  this.legalName = legalParts.join(' ').replace(/\s+/g, ' ').trim();
  this.displayName = preferred || this.legalName;

  if (!this.identityCode) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    this.identityCode = `UID-${Date.now()}-${suffix}`;
  }
});

UsrIdentitySchema.index({ primaryEmail: 1, recordStatus: 1 });

export default mongoose.models.UsrIdentity || mongoose.model('UsrIdentity', UsrIdentitySchema, 'usr_identities');