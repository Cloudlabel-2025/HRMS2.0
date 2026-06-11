import { z } from 'zod';
import {
  ADDRESS_TYPES,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPES,
  GENDER_VALUES,
  IDENTITY_STATUSES,
  LIFECYCLE_ENTITY_TYPES,
  LIFECYCLE_EVENT_TYPES,
  MARITAL_STATUS_VALUES,
  SEPARATION_TYPES,
  SETTLEMENT_STATUSES,
  SELF_SERVICE_REQUEST_STATUSES,
  SELF_SERVICE_REQUEST_TYPES,
} from '@/lib/core/constants';

// ────────────────────────────────────────────────────────────────────────────
// SHARED SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

const ObjectIdSchema = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid ID format');
const EmailSchema = z.string().email('Invalid email format').toLowerCase().trim();
const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

// ────────────────────────────────────────────────────────────────────────────
// AUTH SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Password required'),
}).strict();

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(), // Not required on first login
  newPassword: PasswordSchema,
}).strict();

export const ForgotPasswordSchema = z.object({
  email: EmailSchema,
}).strict();

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token required'),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// EMPLOYEE SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

export const CreateEmployeeSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: EmailSchema,
  password: PasswordSchema.optional(),
  phone: z.string().regex(/^[0-9]{10}$/, 'Phone must be 10 digits').optional().or(z.literal('')),
  department: z.string().min(1, 'Department required'),
  designation: z.string().max(100).optional().or(z.literal('')),
  role: z.enum(['employee', 'team_lead', 'recruiter', 'team_admin', 'super_admin', 'admin_full', 'intern']).default('employee'),
  shift: z.string().optional().default('Morning (9AM-6PM)'),
  skills: z.array(z.string().max(50)).optional().default([]),
  joinDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  status: z.enum(['active', 'inactive', 'alumni']).default('active'),
  teamLeadId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  teamAdminId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  smeId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  // Sensitive identifiers — stored encrypted in UsrIdentity, not in Employee
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, 'Invalid PAN format').optional(),
  aadhaarNumber: z.string().regex(/^[0-9]{12}$/, 'Aadhaar must be 12 digits').optional(),
  // Explicitly reject fields that shouldn't be set on create
}).strict().omit({ _id: true, createdAt: true, updatedAt: true, userId: true });

export const UpdateEmployeeSchema = CreateEmployeeSchema.partial();

// ────────────────────────────────────────────────────────────────────────────
// CORE IDENTITY / EMPLOYMENT PROFILE SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

const CoreAddressSchema = z.object({
  addressType: z.enum(ADDRESS_TYPES).default('current'),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional().or(z.literal('')),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  country: z.string().min(2).max(100).default('India'),
  postalCode: z.string().min(4).max(12),
  landmark: z.string().max(120).optional().or(z.literal('')),
  isCurrent: z.boolean().default(false),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
}).strict();

const CoreEmergencyContactSchema = z.object({
  name: z.string().min(2).max(120),
  relation: z.string().min(2).max(60),
  phone: z.string().regex(/^[0-9]{10}$/, 'Phone must be 10 digits'),
  email: EmailSchema.optional().or(z.literal('')),
  isPrimary: z.boolean().default(false),
}).strict();

const CoreSensitiveIdentifiersSchema = z.object({
  panNumber: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, 'Invalid PAN format').optional().or(z.literal('')),
  aadhaarNumber: z.string().regex(/^[0-9]{12}$/, 'Aadhaar must be 12 digits').optional().or(z.literal('')),
}).strict().default({});

export const CreateCoreIdentitySchema = z.object({
  authUserId: ObjectIdSchema.optional(),
  legalFirstName: z.string().min(1, 'First name required').max(80),
  legalMiddleName: z.string().max(80).optional().or(z.literal('')),
  legalLastName: z.string().max(80).optional().or(z.literal('')),
  preferredName: z.string().max(120).optional().or(z.literal('')),
  primaryEmail: EmailSchema,
  personalPhone: z.string().regex(/^[0-9]{10}$/, 'Phone must be 10 digits').optional().or(z.literal('')),
  secondaryPhone: z.string().regex(/^[0-9]{10}$/, 'Phone must be 10 digits').optional().or(z.literal('')),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(GENDER_VALUES).default('prefer_not_to_say'),
  maritalStatus: z.enum(MARITAL_STATUS_VALUES).default('prefer_not_to_say'),
  nationality: z.string().max(80).optional().or(z.literal('')),
  bloodGroup: z.string().max(10).optional().or(z.literal('')),
  identifiers: CoreSensitiveIdentifiersSchema,
  addressHistory: z.array(CoreAddressSchema).default([]),
  emergencyContacts: z.array(CoreEmergencyContactSchema).default([]),
  recordStatus: z.enum(IDENTITY_STATUSES).default('active'),
  sourceSystem: z.enum(['manual', 'recruitment', 'migration', 'rehire', 'import']).default('manual'),
  notes: z.string().max(2000).optional().or(z.literal('')),
}).strict();

export const UpdateCoreIdentitySchema = CreateCoreIdentitySchema.partial();

const CoreReportingLineSchema = z.object({
  managerIdentityId: ObjectIdSchema.optional(),
  teamLeadIdentityId: ObjectIdSchema.optional(),
  teamAdminIdentityId: ObjectIdSchema.optional(),
}).strict().default({});

const CoreCompensationSchema = z.object({
  currency: z.string().min(2).max(10).default('INR'),
  grade: z.string().max(50).optional().or(z.literal('')),
  payGroup: z.string().max(80).optional().or(z.literal('')),
  band: z.string().max(50).optional().or(z.literal('')),
}).strict().default({ currency: 'INR', grade: '', payGroup: '', band: '' });

const CoreSeparationSchema = z.object({
  separationType: z.enum(SEPARATION_TYPES).default('other'),
  reason: z.string().max(1000).optional().or(z.literal('')),
  noticePeriodDays: z.number().int().min(0).max(365).default(0),
  lastWorkingDate: z.coerce.date().optional(),
  settlementStatus: z.enum(SETTLEMENT_STATUSES).default('pending'),
  exitInterviewComplete: z.boolean().default(false),
  approvedByUserId: ObjectIdSchema.optional(),
  approvedAt: z.coerce.date().optional(),
  clearedAt: z.coerce.date().optional(),
}).strict();

export const CreateEmploymentProfileSchema = z.object({
  identityId: ObjectIdSchema,
  employeeNumber: z.string().min(4).max(40).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).default('full_time'),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).default('onboarding'),
  department: z.string().min(1, 'Department required').max(120),
  designation: z.string().min(1, 'Designation required').max(120),
  businessUnit: z.string().max(120).optional().or(z.literal('')),
  workLocation: z.string().max(120).optional().or(z.literal('')),
  shift: z.string().max(120).optional().or(z.literal('')),
  hireDate: z.coerce.date().optional(),
  probationStartDate: z.coerce.date().optional(),
  probationEndDate: z.coerce.date().optional(),
  confirmationDate: z.coerce.date().optional(),
  rehireCount: z.number().int().min(0).max(20).default(0),
  originalHireDate: z.coerce.date().optional(),
  reportingLine: CoreReportingLineSchema,
  compensationSnapshot: CoreCompensationSchema,
  separation: CoreSeparationSchema.optional(),
  sourceSystem: z.enum(['manual', 'recruitment', 'migration', 'rehire', 'import']).default('manual'),
  notes: z.string().max(2000).optional().or(z.literal('')),
}).strict();

export const UpdateEmploymentProfileSchema = CreateEmploymentProfileSchema.partial();

const LifecycleProfileStateSchema = z.enum(['onboarding', 'probation', 'active', 'suspended', 'resigned', 'terminated', 'retired', 'alumni', 'rehired']);

export const LifecycleConfirmProbationSchema = z.object({
  profileId: ObjectIdSchema,
  effectiveDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  confirmationNote: z.string().max(500).optional().or(z.literal('')),
}).passthrough();

export const LifecycleTransferSchema = z.object({
  profileId: ObjectIdSchema,
  effectiveDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  department: z.string().min(1).max(120),
  designation: z.string().min(1).max(120),
  businessUnit: z.string().max(120).optional().or(z.literal('')),
  workLocation: z.string().max(120).optional().or(z.literal('')),
  shift: z.string().max(120).optional().or(z.literal('')),
  managerIdentityId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  teamLeadIdentityId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  teamAdminIdentityId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  reason: z.string().min(1).max(500),
}).passthrough();

export const LifecyclePromotionSchema = z.object({
  profileId: ObjectIdSchema,
  effectiveDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  designation: z.string().min(1).max(120),
  businessUnit: z.string().max(120).optional().or(z.literal('')),
  grade: z.string().max(50).optional().or(z.literal('')),
  payGroup: z.string().max(80).optional().or(z.literal('')),
  band: z.string().max(50).optional().or(z.literal('')),
  reason: z.string().min(1).max(500),
}).passthrough();

export const LifecycleRehireSchema = z.object({
  profileId: ObjectIdSchema,
  effectiveDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  department: z.string().min(1).max(120),
  designation: z.string().min(1).max(120),
  businessUnit: z.string().max(120).optional().or(z.literal('')),
  workLocation: z.string().max(120).optional().or(z.literal('')),
  shift: z.string().max(120).optional().or(z.literal('')),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern', 'consultant', 'apprentice']).default('full_time'),
  reason: z.string().min(1).max(500),
}).passthrough();

export const LifecycleSuspendSchema = z.object({
  profileId: ObjectIdSchema,
  effectiveDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  reason: z.string().min(1).max(500),
  suspensionUntil: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
}).passthrough();

export const LifecycleSeparationSchema = z.object({
  profileId: ObjectIdSchema,
  effectiveDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  separationType: z.enum(['resignation', 'termination', 'retirement', 'contract_end', 'medical_exit', 'death', 'other']),
  reason: z.string().min(1).max(1000),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).default(0),
  lastWorkingDate: z.preprocess(v => (v === '' || v == null ? undefined : v), z.coerce.date().optional()),
  settlementStatus: z.enum(['pending', 'in_progress', 'settled']).default('pending'),
  exitInterviewComplete: z.boolean().default(false),
  approvedByUserId: ObjectIdSchema.optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
}).passthrough();

export const LifecycleActionSchema = z.union([
  z.object({ action: z.literal('confirm_probation'), data: LifecycleConfirmProbationSchema }),
  z.object({ action: z.literal('transfer'), data: LifecycleTransferSchema }),
  z.object({ action: z.literal('promotion'), data: LifecyclePromotionSchema }),
  z.object({ action: z.literal('rehire'), data: LifecycleRehireSchema }),
  z.object({ action: z.literal('suspend'), data: LifecycleSuspendSchema }),
  z.object({ action: z.literal('separation'), data: LifecycleSeparationSchema }),
]);

export const CreateLifecycleHistorySchema = z.object({
  entityType: z.enum(LIFECYCLE_ENTITY_TYPES),
  entityId: ObjectIdSchema,
  identityId: ObjectIdSchema.optional(),
  profileId: ObjectIdSchema.optional(),
  eventType: z.enum(LIFECYCLE_EVENT_TYPES),
  action: z.string().min(2).max(120),
  fromState: z.string().max(80).optional().or(z.literal('')),
  toState: z.string().max(80).optional().or(z.literal('')),
  changes: z.array(z.object({
    field: z.string().min(1).max(120),
    from: z.any().optional(),
    to: z.any().optional(),
    sensitive: z.boolean().default(false),
  })).default([]),
  reason: z.string().max(1000).optional().or(z.literal('')),
  metadata: z.record(z.any()).default({}),
  requestId: z.string().max(120).optional().or(z.literal('')),
}).strict();

export const CreateSelfServiceRequestSchema = z.object({
  requestType: z.enum(SELF_SERVICE_REQUEST_TYPES),
  reason: z.string().min(10).max(1000),
  payload: z.object({}).passthrough(),
}).strict();

export const ReviewSelfServiceRequestSchema = z.object({
  id: ObjectIdSchema,
  action: z.enum(['approved', 'rejected', 'cancelled']),
  reviewNote: z.string().max(1000).optional().or(z.literal('')),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// LEAVE SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

export const CreateLeaveSchema = z.object({
  type: z.enum([
    'Casual Leave',
    'Sick Leave',
    'Earned Leave',
    'Maternity Leave',
    'Paternity Leave',
    'Compensatory Leave',
    'Loss of Pay'
  ]),
  from: DateSchema,
  to: DateSchema,
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500),
}).strict().refine(
  (data) => new Date(data.to) >= new Date(data.from),
  { message: 'End date must be after start date', path: ['to'] }
).refine(
  (data) => new Date(data.from) >= new Date(),
  { message: 'Leave date cannot be in the past', path: ['from'] }
);

export const ApproveLeaveSchema = z.object({
  action: z.enum(['approved', 'rejected', 'held']),
  holdReason: z.string().min(1).max(500).optional(),
}).strict().refine(
  data => data.action !== 'held' || !!data.holdReason,
  { message: 'holdReason is required when action is held', path: ['holdReason'] }
);

// ────────────────────────────────────────────────────────────────────────────
// ATTENDANCE SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

export const ClockInOutSchema = z.object({
  action: z.enum(['in', 'out']),
}).strict();

export const AttendanceRegularizeSchema = z.object({
  date: DateSchema,
  requestedIn: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM').optional(),
  requestedOut: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM').optional(),
  reason: z.string().min(20, 'Reason must be detailed (min 20 chars)').max(1000),
}).strict().refine(
  (data) => data.requestedIn || data.requestedOut,
  { message: 'At least one of requestedIn or requestedOut is required' }
);

export const ApproveRegularizationSchema = z.object({
  action: z.enum(['approved', 'rejected']),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// SETTINGS SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

export const CreateDepartmentSchema = z.object({
  name: z.string().min(2).max(100),
  head: z.string().max(100).optional().or(z.literal('')),
  members: z.number().int().min(0).optional(),
}).strict();

export const CreateShiftSchema = z.object({
  name: z.string().min(2).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Start time must be HH:MM'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'End time must be HH:MM'),
  days: z.array(z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])).optional(),
}).strict();

export const CreateHolidaySchema = z.object({
  name: z.string().min(2).max(100),
  date: DateSchema,
  type: z.enum(['National', 'Optional', 'Company']).default('Company'),
}).strict();

export const CreateConfigSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(1000),
}).strict();

// ────────────────────────────────────────────────────────────────────────────
// DOCUMENT SCHEMAS
// ────────────────────────────────────────────────────────────────────────────

export const CreateDocumentSchema = z.object({
  name: z.string().min(2).max(255),
  category: z.enum(['Policy', 'Employee', 'Contract', 'HR', 'Other']).default('Other'),
  fileUrl: z.string().url('Invalid file URL'),
  fileSize: z.string().optional(),
  fileType: z.string().max(50).optional(),
  access: z.enum(['all', 'admin', 'employee']).default('all'),
  employeeId: ObjectIdSchema.optional(),
  expiry: DateSchema.optional(),
}).strict().omit({ uploadedBy: true, _id: true, createdAt: true, updatedAt: true });

// ────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse and validate request data
 * Returns { valid: true, data } or { valid: false, error: string }
 */
export function validateRequest(schema, data) {
  try {
    const result = schema.safeParse(data);
    if (result.success) {
      return { valid: true, data: result.data };
    }
    const errors = result.error.issues.map(issue => 
      `${issue.path.join('.')}: ${issue.message}`
    ).join('; ');
    return { valid: false, error: errors };
  } catch (e) {
    return { valid: false, error: 'Validation error: ' + e.message };
  }
}

/**
 * Middleware helper to validate request in route handlers
 */
export async function validateRequestBody(req, schema) {
  try {
    const body = await req.json();
    return validateRequest(schema, body);
  } catch (e) {
    return { valid: false, error: 'Invalid JSON: ' + e.message };
  }
}
