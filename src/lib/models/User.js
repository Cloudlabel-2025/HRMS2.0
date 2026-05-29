import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = [
  'super_admin',
  'admin_full',
  'recruiter',
  'team_admin',
  'team_lead',
  'employee',
  'intern',
];

// Roles that can approve / manage others
export const ADMIN_ROLES  = ['super_admin', 'admin_full'];
export const MANAGER_ROLES = ['super_admin', 'admin_full', 'team_admin', 'team_lead'];

const UserSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String, required: true, minlength: 6, select: false },
  role:         { type: String, enum: ROLES, default: 'employee' },

  // Org structure — used for data-scope filtering on every API
  department:   { type: String, default: '' },
  designation:  { type: String, default: '' },
  teamLeadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  teamAdminId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  phone:        { type: String, default: '' },
  shift:        { type: String, default: 'Morning (9AM-6PM)' },
  avatar:       { type: String, default: '' },
  skills:       [{ type: String }],
  joinDate:     { type: Date },
  status:       { type: String, enum: ['active', 'inactive', 'alumni'], default: 'active' },
  smeId:        { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },

  // First-login password reset enforcement
  isFirstLogin: { type: Boolean, default: true },

  // Login lockout
  loginAttempts:  { type: Number, default: 0 },
  lockUntil:      { type: Date, default: null },
}, { timestamps: true });

UserSchema.pre('save', async function () {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  if (!this.avatar && this.name) {
    this.avatar = this.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  }
});

UserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

UserSchema.methods.incrementLoginAttempts = async function () {
  const MAX_ATTEMPTS = 5;
  const LOCK_MINUTES = 30;
  this.loginAttempts += 1;
  if (this.loginAttempts >= MAX_ATTEMPTS) {
    this.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    this.loginAttempts = 0;
  }
  await this.save();
};

UserSchema.methods.resetLoginAttempts = async function () {
  this.loginAttempts = 0;
  this.lockUntil = null;
  await this.save();
};

export default mongoose.models.User || mongoose.model('User', UserSchema);
