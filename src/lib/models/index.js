import mongoose from 'mongoose';

// ── Performance ──────────────────────────────────────────────────────────────
const GoalSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:     { type: String, required: true },
  kpi:       { type: String },
  target:    { type: String },
  progress:  { type: Number, default: 0 },
  status:    { type: String, enum: ['in_progress','achieved','missed'], default: 'in_progress' },
  cycle:     { type: String },
}, { timestamps: true });

const ReviewSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cycle:        { type: String, required: true },
  selfScore:    { type: Number },
  selfComment:  { type: String },
  peerScore:    { type: Number },
  peerComment:  { type: String },
  managerScore: { type: Number },
  managerComment:{ type: String },
  managerBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  overall:      { type: Number },
  status:       { type: String, enum: ['pending','in_review','completed','improvement_plan'], default: 'pending' },
}, { timestamps: true });

// ── Document ─────────────────────────────────────────────────────────────────
const DocumentSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  category:   { type: String, enum: ['Policy','Employee','Contract','HR','Other'], default: 'Other' },
  fileUrl:    { type: String, required: true },
  fileSize:   { type: String },
  fileType:   { type: String },
  access:     { type: String, enum: ['all','admin','employee'], default: 'all' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  expiry:     { type: String, default: null },
  version:    { type: Number, default: 1 },
}, { timestamps: true });

// ── Announcement ─────────────────────────────────────────────────────────────
const AnnouncementSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  body:     { type: String, required: true },
  author:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  audience: { type: String, default: 'Company-wide' },
  tag:      { type: String, default: 'General' },
  tagColor: { type: String, default: '#3b82f6' },
  pinned:   { type: Boolean, default: false },
  likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

// ── Absence ───────────────────────────────────────────────────────────────────
const AbsenceSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:    { type: String, required: true },
  reason:  { type: String, default: 'No notification' },
  flagged: { type: Boolean, default: false },
  smeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
}, { timestamps: true });

// ── Inventory ─────────────────────────────────────────────────────────────────
const AssetSchema = new mongoose.Schema({
  assetId:    { type: String, required: true, unique: true },
  name:       { type: String, required: true },
  category:   { type: String },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedOn: { type: String, default: null },
  status:     { type: String, enum: ['assigned','available','maintenance'], default: 'available' },
  condition:  { type: String, enum: ['good','fair','repair'], default: 'good' },
  value:      { type: Number, default: 0 },
}, { timestamps: true });

const StockSchema = new mongoose.Schema({
  item:       { type: String, required: true },
  category:   { type: String },
  stock:      { type: Number, default: 0 },
  reorderAt:  { type: Number, default: 5 },
  unit:       { type: String, default: 'units' },
}, { timestamps: true });

// ── Finance ───────────────────────────────────────────────────────────────────
const InvoiceSchema = new mongoose.Schema({
  invoiceNo:  { type: String, required: true, unique: true },
  client:     { type: String, required: true },
  amount:     { type: Number, required: true },
  issued:     { type: String },
  due:        { type: String },
  status:     { type: String, enum: ['draft','sent','pending','paid','overdue'], default: 'draft' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const ExpenseSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category:   { type: String },
  amount:     { type: Number, required: true },
  date:       { type: String },
  description:{ type: String },
  status:     { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

const BudgetSchema = new mongoose.Schema({
  department: { type: String, required: true },
  year:       { type: Number, required: true },
  allocated:  { type: Number, default: 0 },
  spent:      { type: Number, default: 0 },
}, { timestamps: true });

// ── Employee (separate from User auth) ───────────────────────────────────────
const EmployeeSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, lowercase: true, trim: true },
  phone:        { type: String, default: '' },
  department:   { type: String, required: true, index: true },
  designation:  { type: String, default: '' },
  role:         { type: String, default: 'employee' },
  shift:        { type: String, default: 'Morning (9AM-6PM)' },
  avatar:       { type: String, default: '' },
  skills:       [{ type: String }],
  joinDate:     { type: Date },
  status:       { type: String, enum: ['active', 'inactive', 'alumni'], default: 'active' },
  teamLeadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  teamAdminId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  smeId:        { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
  leaveBalance: { type: Number, default: 24 },
}, { timestamps: true });

// ── Audit Log ─────────────────────────────────────────────────────────────────
const AuditLogSchema = new mongoose.Schema({
  action:   { type: String, required: true },
  module:   { type: String, required: true },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  details:  { type: String },
  severity: { type: String, enum: ['low','medium','high'], default: 'low' },
  ip:       { type: String, default: '' },
}, { timestamps: true });

// ── SME ───────────────────────────────────────────────────────────────────────
const SMESchema = new mongoose.Schema({
  name:           { type: String, required: true },
  contact:        { type: String },
  plan:           { type: String, enum: ['Basic','Pro','Enterprise'], default: 'Basic' },
  status:         { type: String, enum: ['active','trial','inactive'], default: 'trial' },
  saturdayConfig: { type: String, enum: ['all','alternate','none'], default: 'alternate' },
  payrollStart:   { type: Number, default: 1 },
  attendanceStart:{ type: Number, default: 1 },
  defaultShift:   { type: String, default: 'Morning (9AM-6PM)' },
}, { timestamps: true });

// ── Recruitment ───────────────────────────────────────────────────────────────
const JobSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  department: { type: String },
  type:       { type: String, enum: ['Full-time','Part-time','Contract','Intern'], default: 'Full-time' },
  status:     { type: String, enum: ['active','closed'], default: 'active' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const ApplicantSchema = new mongoose.Schema({
  jobId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  name:    { type: String, required: true },
  email:   { type: String, required: true },
  stage:   { type: String, enum: ['Applied','Screening','Interview','Offer','Hired','Rejected'], default: 'Applied' },
  score:   { type: Number, default: 0 },
  resume:  { type: String, default: '' },
}, { timestamps: true });

// ── Attendance Regularization ────────────────────────────────────────────────
const AttendanceRegularizationSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:        { type: String, required: true },
  requestedIn: { type: String },
  requestedOut:{ type: String },
  reason:      { type: String, required: true },
  status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:  { type: Date, default: null },
}, { timestamps: true });

// ── Settings ──────────────────────────────────────────────────────────────────
const DepartmentSchema = new mongoose.Schema({
  name:    { type: String, required: true, unique: true },
  head:    { type: String, default: '' },
  members: { type: Number, default: 0 },
}, { timestamps: true });

const ShiftSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  startTime: { type: String, required: true },
  endTime:   { type: String, required: true },
  days:      [{ type: String }],
}, { timestamps: true });

const HolidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  type: { type: String, enum: ['National','Optional','Company'], default: 'National' },
}, { timestamps: true });

const SystemConfigSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

const SettingsSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

// Re-export models from separate files
export { Task, Project } from './Task';
export { Payroll, SalaryStructure } from './Payroll';

// ── Exports ───────────────────────────────────────────────────────────────────
export const Goal        = mongoose.models.Goal        || mongoose.model('Goal', GoalSchema);
export const Review      = mongoose.models.Review      || mongoose.model('Review', ReviewSchema);
export const Document    = mongoose.models.Document    || mongoose.model('Document', DocumentSchema);
export const Announcement= mongoose.models.Announcement|| mongoose.model('Announcement', AnnouncementSchema);
export const Absence     = mongoose.models.Absence     || mongoose.model('Absence', AbsenceSchema);
export const Asset       = mongoose.models.Asset       || mongoose.model('Asset', AssetSchema);
export const Stock       = mongoose.models.Stock       || mongoose.model('Stock', StockSchema);
export const Invoice     = mongoose.models.Invoice     || mongoose.model('Invoice', InvoiceSchema);
export const Expense     = mongoose.models.Expense     || mongoose.model('Expense', ExpenseSchema);
export const Budget      = mongoose.models.Budget      || mongoose.model('Budget', BudgetSchema);
export const AuditLog    = mongoose.models.AuditLog    || mongoose.model('AuditLog', AuditLogSchema);
export const Employee    = mongoose.models.Employee    || mongoose.model('Employee', EmployeeSchema);
export const SME         = mongoose.models.SME         || mongoose.model('SME', SMESchema);
export const JobPosting   = mongoose.models.Job         || mongoose.model('Job', JobSchema);
export const Applicant   = mongoose.models.Applicant   || mongoose.model('Applicant', ApplicantSchema);
export const Department  = mongoose.models.Department  || mongoose.model('Department', DepartmentSchema);
export const Shift       = mongoose.models.Shift       || mongoose.model('Shift', ShiftSchema);
export const Holiday     = mongoose.models.Holiday     || mongoose.model('Holiday', HolidaySchema);
export const SystemConfig= mongoose.models.SystemConfig|| mongoose.model('SystemConfig', SystemConfigSchema);
export const Settings    = mongoose.models.Settings    || mongoose.model('Settings', SettingsSchema);
export const AttendanceRegularization = mongoose.models.AttendanceRegularization || mongoose.model('AttendanceRegularization', AttendanceRegularizationSchema);
