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
  weeklyUpdates: [{
    weekEnding: { type: String, required: true },
    progress:   { type: Number, min: 0, max: 100, required: true },
    remark:     { type: String, required: true },
    submittedAt:{ type: Date, default: Date.now },
  }],
  validationStatus: { type: String, enum: ['pending', 'validated'], default: 'pending' },
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  validatedAt: { type: Date, default: null },
  validationComment: { type: String, default: '' },
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
}, { timestamps: true });

const ReviewSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cycle:        { type: String, required: true },
  projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  taskId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  selfScore:    { type: Number },
  selfComment:  { type: String },
  peerScore:    { type: Number },
  peerComment:  { type: String },
  peerReviews:  [{
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    score:       { type: Number, min: 0, max: 5, required: true },
    comment:     { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now },
  }],
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
  mimeType:   { type: String, default: '' },
  access:     { type: String, enum: ['all','admin','employee'], default: 'all' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  expiry:     { type: String, default: null },
  version:    { type: Number, default: 1 },
  cloudinaryPublicId: { type: String, default: null },
  deletedAt:  { type: Date, default: null },
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
  departments: [{ type: String }],
  attachment: {
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    type: { type: String, default: '' },
    size: { type: String, default: '' },
  },
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
  stockItem:  { type: mongoose.Schema.Types.ObjectId, ref: 'Stock', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedOn: { type: String, default: null },
  returnedOn: { type: String, default: null },
  returnReason: { type: String, default: '' },
  status:     { type: String, enum: ['assigned','available','maintenance','repair','damaged','retired'], default: 'available' },
  condition:  { type: String, enum: ['New', 'Good', 'Fair', 'Repair', 'Damaged', 'Obsolete', 'In Maintenance'], default: 'New' },
  value:      { type: Number, default: 0 },
}, { timestamps: true });

const StockSchema = new mongoose.Schema({
  item:       { type: String, required: true },
  category:   { type: String },
  stock:      { type: Number, default: 0 },
  reorderAt:  { type: Number, default: 5 },
  unit:       { type: String, default: 'units' },
  unitPrice:  { type: Number, default: 0 },
}, { timestamps: true });

const AssetAssignmentSchema = new mongoose.Schema({
  asset:      { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
  employee:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action:     { type: String, enum: ['assigned', 'returned', 'replaced', 'maintenance', 'repaired', 'retired'], required: true },
  assignedOn: { type: String, default: null },
  returnedOn: { type: String, default: null },
  reason:     { type: String, default: '' },
  condition:  { type: String, default: '' },
  status:     { type: String, default: '' },
  performedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const StockMovementSchema = new mongoose.Schema({
  stockItem:    { type: mongoose.Schema.Types.ObjectId, ref: 'Stock', required: true },
  asset:        { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', default: null },
  employee:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type:         { type: String, enum: ['stock_added', 'assigned', 'returned'], required: true },
  quantity:     { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  unitPrice:    { type: Number, default: 0 },
  note:         { type: String, default: '' },
  performedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

// ── Finance ───────────────────────────────────────────────────────────────────
const ClientSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true, unique: true },
  contactPerson: { type: String, default: '', trim: true },
  email:         { type: String, default: '', trim: true, lowercase: true },
  phone:         { type: String, default: '', trim: true },
  address:       { type: String, default: '', trim: true },
  gstin:         { type: String, default: '', trim: true, uppercase: true },
  createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

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

const ExpenseCategorySchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const BudgetSchema = new mongoose.Schema({
  department: { type: String, required: true },
  year:       { type: Number, required: true },
  month:      { type: Number, min: 1, max: 12, default: null },
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
  shiftId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
  avatar:       { type: String, default: '' },
  skills:       [{ type: String }],
  joinDate:     { type: Date },
  status:       { type: String, enum: ['active', 'inactive', 'alumni'], default: 'active' },
  teamLeadId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  teamAdminId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  smeId:        { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
  leaveBalance: { type: Number, default: 24 },
}, { timestamps: true });

// ── SME (Subject Matter Expert) ────────────────────────────────────────────────
const SMESchema = new mongoose.Schema({
  name:           { type: String, required: true },
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:          { type: String, default: '' },
  dob:            { type: Date },
  pan:            { type: String, default: '' },
  expertise:      [{ type: String }],
  departments:    [{ type: String }],
  accountDetails: {
    bankName:      { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    ifscCode:      { type: String, default: '' },
    accountHolder: { type: String, default: '' },
  },
  rate: {
    amount:        { type: Number, default: 0 },
    type:          { type: String, enum: ['hourly', 'daily', 'fixed'], default: 'hourly' },
  },
  contractStart:  { type: Date },
  contractEnd:    { type: Date },
  status:         { type: String, enum: ['active', 'inactive'], default: 'active' },
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

// ── Recruitment ───────────────────────────────────────────────────────────────
const JobSchema = new mongoose.Schema({
  // Auto-generated
  jobCode:       { type: String, unique: true, sparse: true },

  // Basic Information
  title:         { type: String, required: true, trim: true },
  department:    { type: String, default: '' },
  designation:   { type: String, default: '' },
  type:          { type: String, enum: ['Full-time','Part-time','Contract','Intern'], default: 'Full-time' },
  employmentMode:{ type: String, enum: ['Remote','Hybrid','Onsite'], default: 'Onsite' },
  location:      { type: String, default: '' },
  openings:      { type: Number, default: 1, min: 1 },
  status:        { type: String, enum: ['draft','active','paused','closed','archived'], default: 'draft' },

  // Job Requirements
  experienceLevel: { type: String, enum: ['fresher','experienced'], default: 'fresher' },
  minExperience:   { type: Number, default: null },
  maxExperience:   { type: Number, default: null },
  qualifications:  [{ type: String }],
  requiredSkills:  [{ type: String }],
  preferredSkills: [{ type: String }],
  description:     { type: String, default: '' },

  // Compensation
  salaryType:    { type: String, enum: ['fixed','range','not_disclosed'], default: 'not_disclosed' },
  fixedSalary:   { type: Number, default: null },
  minSalary:     { type: Number, default: null },
  maxSalary:     { type: Number, default: null },
  salaryCurrency:{ type: String, enum: ['INR','USD','EUR','GBP'], default: 'INR' },
  salaryPeriod:  { type: String, enum: ['monthly','annual'], default: 'annual' },
  benefits:      [{ type: String }],
  salaryRange:   { type: String, default: '' }, // legacy display field

  // Recruitment Process
  hiringManagerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recruiterId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  applicationDeadline:{ type: Date, default: null },
  interviewRounds:    { type: Number, default: 1, min: 1 },
  assessmentRequired: { type: Boolean, default: false },

  // Screening Questions
  screeningQuestions: [{
    question: { type: String },
    type:     { type: String, enum: ['text','yes_no','multiple_choice'], default: 'text' },
    options:  [{ type: String }],
    required: { type: Boolean, default: false },
  }],

  // Publishing
  isInternal: { type: Boolean, default: false },
  autoClose:  { type: Boolean, default: false },
  publishedAt:{ type: Date, default: null },

  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

const ApplicantSchema = new mongoose.Schema({
  jobId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  name:    { type: String, required: true },
  email:   { type: String, required: true },
  phone:   { type: String, default: '' },
  stage:   { type: String, enum: ['Applied','Screening','Interview','Offer','Hired','Rejected'], default: 'Applied' },
  score:   { type: Number, default: 0 },
  resume:  { type: String, default: '' },
  qualification: { type: String, default: '' },
  skills: [{ type: String }],
  isFresher: { type: Boolean, default: true },
  experienceYears: { type: Number, default: 0 },
  referralName: { type: String, default: '' },
  referralFromOffice: { type: Boolean, default: false },
  referralEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  rejectionReason: { type: String, default: '' },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  previousRejection: {
    matchedBy: { type: String, enum: ['email', 'phone', 'email_phone', ''], default: '' },
    applicantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Applicant', default: null },
    reason: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },
  },
  onboardedAt: { type: Date, default: null },
  onboardedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
}, { timestamps: true });

// ── Attendance Regularization ────────────────────────────────────────────────
const AttendanceRegularizationSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:        { type: String, required: true },
  requestedIn: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: null },
  requestedOut:{ type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: null },
  requestedOutNotYet:{ type: Boolean, default: false },
  requestedOutTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/, default: null },
  requestedBreaks: [{
    type: { type: String, required: true },
    name: { type: String, default: '' },
    ruleIdx: { type: Number, default: null },
    idx: { type: Number, default: null },
    start: { type: String, default: '' },
    end: { type: String, default: null },
    notYet: { type: Boolean, default: false },
  }],
  reason:      { type: String, required: true },
  status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:  { type: Date, default: null },
}, { timestamps: true });

// Indexes for AttendanceRegularization
AttendanceRegularizationSchema.index({ userId: 1, date: 1 });
AttendanceRegularizationSchema.index({ status: 1 });

// ── Role & Designation ───────────────────────────────────────────────────────
const RoleSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
}, { timestamps: true });

const DesignationSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  department:  { type: String, default: '' },
  description: { type: String, default: '' },
}, { timestamps: true });

// ── Asset Category ────────────────────────────────────────────────────────────
const AssetCategorySchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
}, { timestamps: true });

// ── Notification ─────────────────────────────────────────────────────────────
const NotificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:   { type: String, required: true },
  message: { type: String, required: true },
  type:    { type: String, enum: ['leave','attendance','announcement','general','performance','lifecycle','self_service','payroll','viewing','shift'], default: 'general' },
  attachment: {
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    type: { type: String, default: '' },
    size: { type: String, default: '' },
  },
  read:    { type: Boolean, default: false },
  refId:   { type: mongoose.Schema.Types.ObjectId, default: null }, // leave/request id
}, { timestamps: true });

// ── Settings ──────────────────────────────────────────────────────────────────
// ── Scheduled / Bulk Shift Assignment ────────────────────────────────────────
const ShiftChangeSchema = new mongoose.Schema({
  targetShiftId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  targetShiftName: { type: String, required: true },
  fromShiftId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
  departments:     { type: String, default: '' },
  roles:           { type: String, default: '' },
  userIds:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  exactUserIds:    { type: Boolean, default: false },
  effectiveDate:   { type: String, required: true },
  reason:          { type: String, required: true, trim: true },
  status:          { type: String, enum: ['pending', 'applied', 'cancelled'], default: 'pending', index: true },
  appliedAt:       { type: Date, default: null },
  appliedCount:    { type: Number, default: 0 },
  createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

ShiftChangeSchema.index({ status: 1, effectiveDate: 1 });

const HolidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: String, required: true },
  type: { type: String, enum: ['National','Optional','Company'], default: 'National' },
}, { timestamps: true });

const SmeExpertiseSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
}, { timestamps: true });

// Re-export models from separate files
export { Task, Project } from './Task';
export { Payroll, SalaryStructure } from './Payroll';

// ── Exports ───────────────────────────────────────────────────────────────────
if (mongoose.models.Goal) delete mongoose.models.Goal;
export const Goal = mongoose.model('Goal', GoalSchema);
if (mongoose.models.Review) delete mongoose.models.Review;
export const Review = mongoose.model('Review', ReviewSchema);
export const Document    = mongoose.models.Document    || mongoose.model('Document', DocumentSchema);
if (mongoose.models.Announcement) delete mongoose.models.Announcement;
export const Announcement = mongoose.model('Announcement', AnnouncementSchema);
export const Absence     = mongoose.models.Absence     || mongoose.model('Absence', AbsenceSchema);
if (mongoose.models.Asset) delete mongoose.models.Asset;
export const Asset       = mongoose.model('Asset', AssetSchema);
if (mongoose.models.Stock) delete mongoose.models.Stock;
export const Stock       = mongoose.model('Stock', StockSchema);
if (mongoose.models.AssetAssignment) delete mongoose.models.AssetAssignment;
export const AssetAssignment = mongoose.model('AssetAssignment', AssetAssignmentSchema);
export const StockMovement   = mongoose.models.StockMovement   || mongoose.model('StockMovement', StockMovementSchema);
export const Counter         = mongoose.models.Counter         || mongoose.model('Counter', CounterSchema);
export const Client      = mongoose.models.Client      || mongoose.model('Client', ClientSchema);
export const Invoice     = mongoose.models.Invoice     || mongoose.model('Invoice', InvoiceSchema);
export const Expense     = mongoose.models.Expense     || mongoose.model('Expense', ExpenseSchema);
export const ExpenseCategory = mongoose.models.ExpenseCategory || mongoose.model('ExpenseCategory', ExpenseCategorySchema);
if (mongoose.models.Budget) delete mongoose.models.Budget;
export const Budget      = mongoose.model('Budget', BudgetSchema);
export { default as AuditLog } from './AuditLog';
export const Employee    = mongoose.models.Employee    || mongoose.model('Employee', EmployeeSchema);
if (process.env.NODE_ENV === 'development' && mongoose.models.SME) { delete mongoose.models.SME; }
export const SME         = mongoose.models.SME         || mongoose.model('SME', SMESchema);
export const JobPosting   = mongoose.models.Job         || mongoose.model('Job', JobSchema);
export const Applicant   = mongoose.models.Applicant   || mongoose.model('Applicant', ApplicantSchema);
export { default as Department } from './Department';
export { default as Shift } from './Shift';
if (process.env.NODE_ENV === 'development' && mongoose.models.ShiftChange) delete mongoose.models.ShiftChange;
export const ShiftChange = mongoose.models.ShiftChange || mongoose.model('ShiftChange', ShiftChangeSchema);
export const Holiday     = mongoose.models.Holiday     || mongoose.model('Holiday', HolidaySchema);
export { default as SystemConfig } from './SystemConfig';
if (mongoose.models.AttendanceRegularization) delete mongoose.models.AttendanceRegularization;
export const AttendanceRegularization = mongoose.model('AttendanceRegularization', AttendanceRegularizationSchema);
export { default as TokenBlacklist } from './TokenBlacklist';
export const Role          = mongoose.models.Role          || mongoose.model('Role', RoleSchema);
export const Designation   = mongoose.models.Designation   || mongoose.model('Designation', DesignationSchema);
export const AssetCategory = mongoose.models.AssetCategory || mongoose.model('AssetCategory', AssetCategorySchema);
if (mongoose.models.Notification) delete mongoose.models.Notification;
export const Notification = mongoose.model('Notification', NotificationSchema);
export const SmeExpertise= mongoose.models.SmeExpertise|| mongoose.model('SmeExpertise', SmeExpertiseSchema);

// Re-import Leave model here to ensure the updated schema is always used
export { default as Leave } from './Leave';
export { default as UsrIdentity } from './Identity';
export { default as EmpProfile } from './EmploymentProfile';
export { default as EmpLifecycleHistory } from './LifecycleHistory';
export { default as SelfServiceRequest } from './SelfServiceRequest';

// Leave Policy models
export { default as LeavePolicy } from './LeavePolicy';
export { default as UserLeaveBalance } from './UserLeaveBalance';
