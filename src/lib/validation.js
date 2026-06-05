import { z } from 'zod';

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
  joinDate: z.coerce.date().optional(),
  status: z.enum(['active', 'inactive', 'alumni']).default('active'),
  teamLeadId: ObjectIdSchema.optional(),
  teamAdminId: ObjectIdSchema.optional(),
  smeId: ObjectIdSchema.optional(),
  // Explicitly reject fields that shouldn't be set on create
}).strict().omit({ _id: true, createdAt: true, updatedAt: true, userId: true });

export const UpdateEmployeeSchema = CreateEmployeeSchema.partial();

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
