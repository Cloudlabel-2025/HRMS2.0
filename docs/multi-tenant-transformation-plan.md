# HRMS Multi-Tenant Transformation Plan

> **Document Version:** 1.0  
> **Date:** June 26, 2026  
> **Project:** HRMS2.0  
> **Status:** Draft for Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision: Multi-Tenancy Strategy](#2-architecture-decision-multi-tenancy-strategy)
3. [Phase 1: Foundation Changes](#3-phase-1-foundation-changes)
4. [Phase 2: Data Scoping](#4-phase-2-data-scoping)
5. [Phase 3: Configurable Methodologies](#5-phase-3-configurable-methodologies)
6. [Phase 4: White-Labeling & Branding](#6-phase-4-white-labeling--branding)
7. [Phase 5: Super Admin Portal](#7-phase-5-super-admin-portal)
8. [Phase 6: New Module Suggestions](#8-phase-6-new-module-suggestions)
9. [CMS Conversion Analysis](#9-cms-conversion-analysis)
10. [Migration Strategy](#10-migration-strategy)
11. [Implementation Estimates](#11-implementation-estimates)
12. [Appendix: Code Change Examples](#12-appendix-code-change-examples)

---

## 1. Executive Summary

### Business Goal

Transform the existing single-tenant HRMS2.0 application into a multi-tenant SaaS platform that can be sold to multiple organizations. Each organization will have:

- Complete data isolation from other organizations
- Configurable HR methodologies, rules, and workflows tailored to their unique processes
- Ability to enable/disable specific modules based on their subscription
- White-labeled experience with their own branding
- Self-service administration of their org-specific settings

### Current State

| Aspect | Current |
|--------|---------|
| Architecture | Single-tenant |
| Data isolation | None (all users share same namespace) |
| Organization concept | None |
| Employee numbering | Hardcoded `CHC-YYYY-NNNN` format |
| Methodologies | Global, hardcoded rules (attendance, leave, payroll, etc.) |
| Branding | Single company identity |
| Module availability | All modules for all users |

### Target State

| Aspect | Target |
|--------|--------|
| Architecture | Multi-tenant SaaS |
| Data isolation | `organizationId` on every document |
| Organization concept | `Organization` model with full lifecycle |
| Employee numbering | Configurable per-org format |
| Methodologies | Per-org configuration engine for every module |
| Branding | White-labeling with custom domain, logo, colors |
| Module availability | Per-org subscription-based enablement |

---

## 2. Architecture Decision: Multi-Tenancy Strategy

### Strategy Comparison

Three common approaches exist for multi-tenancy in MongoDB:

| Approach | Data Isolation | Schema Migration | Query Complexity | Operational Cost | Risk |
|----------|---------------|-----------------|------------------|-----------------|------|
| **1. Separate Database per Tenant** | Strongest | Per-database | None (no orgId needed) | High (many connections, backups) | Low |
| **2. Separate Collection per Tenant** | Strong | Per-collection | Moderate (dynamic collection names) | Medium (collection explosion) | Medium |
| **3. Shared Collection + organizationId** | Good (with proper middleware) | Single deployment | Low (add `{ organizationId }` filter) | Low (single connection pool) | Medium (query leak risk) |

### Chosen Approach: Shared Collection with `organizationId`

We recommend **Strategy 3** — shared collections with a `organizationId` discriminator field on every document. This is the best fit for HRMS2.0 because:

1. **Single MongoDB connection** — no connection pool per tenant, no connection management overhead
2. **Schema evolution** — one schema change affects all orgs instantly; no per-tenant migrations
3. **Simplified operations** — single backup/restore, single index rebuild, single monitoring
4. **Existing code compatibility** — minimal changes to the Mongoose query patterns already in use
5. **Scalability** — one large database is more manageable than N small databases

### Data Isolation Mechanism

Data isolation is enforced at **three layers**:

```
Layer 1 — Database:  organizationId field on every document
                     Compound indexes with orgId as prefix
                     
Layer 2 — Backend:   requireAuth injects orgId into request context
                     scopeFilter() automatically appends orgId to every query
                     All API routes use scoped query helpers
                     
Layer 3 — Frontend:  Auth context provides orgId
                     API client includes org context in all requests
                     UI conditionally renders org-specific data
```

### Security Guarantees

- **No cross-org data leaks** — every query includes `{ organizationId: user.orgId }`
- **Super admin can only cross-org via explicit bypass** — logged and audited
- **Impersonation preserves org boundary** — impersonated user stays in their org
- **Index enforcement** — compound unique indexes prevent duplicate emails across orgs

---

## 3. Phase 1: Foundation Changes

### 3.1 Organization Model

```javascript
// src/lib/models/Organization.js
const OrganizationSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  slug:          { type: String, required: true, unique: true, lowercase: true },
  domain:        { type: String, default: null, unique: true, sparse: true }, // custom domain
  logo:          { type: String, default: '' },  // URL or file path
  favicon:       { type: String, default: '' },
  companyName:   { type: String, default: '' },
  status:        { type: String, enum: ['active', 'suspended', 'trial'], default: 'active' },

  // Subscription / Plan
  plan:          { type: String, enum: ['starter', 'professional', 'enterprise'], default: 'starter' },
  modulesEnabled: [{ type: String }],  // e.g. ['attendance', 'leave', 'payroll', ...]

  // Branding
  primaryColor:  { type: String, default: '#3b82f6' },
  secondaryColor:{ type: String, default: '#1e40af' },

  // Defaults
  defaultTimezone:  { type: String, default: 'Asia/Kolkata' },
  defaultDateFormat:{ type: String, default: 'YYYY-MM-DD' },
  defaultCurrency:  { type: String, default: 'INR' },

  // Billing
  billingEmail:     { type: String, default: '' },
  subscriptionId:   { type: String, default: null },

  // Metadata
  employeeCount:    { type: Number, default: 0 },
  maxEmployees:     { type: Number, default: 50 },

}, { timestamps: true });
```

### 3.2 User Model Changes

```javascript
// Add to existing User schema
const UserSchema = new mongoose.Schema({
  // ... existing fields ...
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  orgRole:        { type: String, enum: ['org_admin', 'org_manager', 'org_user', 'org_viewer'], default: 'org_user' },
  // NOTE: Change email unique to compound unique: { organizationId: 1, email: 1 }
});

// Update compound indexes
UserSchema.index({ organizationId: 1, email: 1 }, { unique: true });
UserSchema.index({ organizationId: 1, department: 1 });
UserSchema.index({ organizationId: 1, status: 1 });
```

### 3.3 JWT Changes

```javascript
// Token payload — include org context
const token = signToken({
  id:     user._id,
  role:   user.role,
  orgId:  user.organizationId,
  orgSlug: organization.slug,
});

// Decoded token now available in every request
// req.orgId, req.orgSlug
```

### 3.4 Login Flow Changes

```
Current flow:
  Email + Password → Find User globally → Validate → Return Token

New flow:
  [Org Slug / Domain +] Email + Password
  → Determine orgId (from subdomain, path, or explicit field)
  → Find User by { email, organizationId: orgId }
  → Validate org status (active/suspended)
  → Validate user + org membership
  → Return Token with orgId in payload
```

**Client login strategies:**
- **Subdomain approach:** `orgname.hrms.com/login` — middleware extracts subdomain
- **Path approach:** `hrms.com/login?org=orgname` — explicit org selection
- **Multi-org user:** After login, if user belongs to multiple orgs, show org selector

### 3.5 requireAuth Middleware Changes

```javascript
export async function requireAuth(req) {
  // ... existing token validation ...
  const decoded = verifyToken(token);

  // New: Validate org membership
  const orgId = decoded.orgId;
  const user = await User.findOne({ _id: decoded.id, organizationId: orgId });

  if (!user || user.status !== 'active') {
    return { error: fail('User not found or inactive in this organization', 401) };
  }

  // Inject orgId into response
  return { user: { ...user.toObject(), orgId } };
}

// New helper for super admin bypass
export async function requireSuperAdmin(req) {
  const { user, error } = await requireAuth(req);
  if (error) return { error };
  if (user.role !== 'super_admin') {
    return { error: fail('Super admin access required', 403) };
  }
  return { user, __isSuperAdmin: true }; // caller can bypass org scoping
}
```

### 3.6 Subdomain Routing

```
Request flow:
  https://acmecorp.hrms.com/attendance
  └── DNS resolves wildcard *.hrms.com → Next.js app
  └── Next.js middleware (edge) reads Host header
  └── Extracts subdomain "acmecorp" from "acmecorp.hrms.com"
  └── Resolves org by slug "acmecorp"
  └── Sets x-org-id and x-org-slug headers
  └── Page/API reads headers → scopes all data

For custom domains:
  https://hrms.acmecorp.com
  └── DNS CNAME → hrms.com
  └── Middleware reads Host header "hrms.acmecorp.com"
  └── Looks up Organization by { domain: "hrms.acmecorp.com" }
  └── Same header injection
```

### 3.7 Super Admin Bypass

```javascript
// Super admins have a special cross-org role
// They can:
// 1. Impersonate org admins (existing mechanism, enhanced)
// 2. View cross-org dashboard
// 3. Access any org's data via explicit orgId parameter

// In requireAuth — super admin context:
if (user.role === 'super_admin' && !req.headers.get('x-org-id')) {
  // No specific org context → super admin global view
  return { user, __superAdmin: true };
}

// Super admin can specify org context:
if (user.role === 'super_admin' && req.headers.get('x-org-id')) {
  const targetOrg = req.headers.get('x-org-id');
  return { user: { ...user.toObject(), orgId: targetOrg }, __impersonating: true };
}
```

---

## 4. Phase 2: Data Scoping

### 4.1 Core Change: Add organizationId to Every Schema

Every Mongoose schema in the project must gain an `organizationId` field. Below is the comprehensive list of all 30+ schemas requiring this change:

| Schema File | Current Field Count | New Field | Impact |
|-------------|-------------------|-----------|--------|
| User.js | 20 fields | `organizationId` | Auth & search changes |
| Identity.js (UsrIdentity) | ~15 fields | `organizationId` | Core HR scoping |
| EmploymentProfile.js (EmpProfile) | ~20 fields | `organizationId` | Employment data scoping |
| Attendance.js | ~12 fields | `organizationId` | Attendance scoping |
| Leave.js | ~10 fields | `organizationId` | Leave scoping |
| Payroll.js | ~15 fields | `organizationId` | Payroll scoping |
| SalaryStructure.js | ~10 fields | `organizationId` | Salary config scoping |
| Task.js | ~12 fields | `organizationId` | Task scoping |
| Project.js | ~10 fields | `organizationId` | Project scoping |
| Goal.js (in index.js) | 8 fields | `organizationId` | Performance scoping |
| Review.js (in index.js) | 14 fields | `organizationId` | Performance scoping |
| Document.js (in index.js) | 11 fields | `organizationId` | Document scoping |
| Announcement.js (in index.js) | 10 fields | `organizationId` | Communication scoping |
| Absence.js (in index.js) | 6 fields | `organizationId` | Absence scoping |
| Asset.js (in index.js) | 8 fields | `organizationId` | Inventory scoping |
| Stock.js (in index.js) | 6 fields | `organizationId` | Inventory scoping |
| Invoice.js (in index.js) | 8 fields | `organizationId` | Finance scoping |
| Expense.js (in index.js) | 8 fields | `organizationId` | Finance scoping |
| Budget.js (in index.js) | 5 fields | `organizationId` | Finance scoping |
| Employee.js (in index.js) | 16 fields | `organizationId` | Legacy employee scoping |
| AuditLog.js (in index.js) | 8 fields | `organizationId` | Audit scoping |
| SME.js (in index.js) | 14 fields | `organizationId` | SME scoping |
| Job.js (in index.js) | ~25 fields | `organizationId` | Recruitment scoping |
| Applicant.js (in index.js) | ~18 fields | `organizationId` | Recruitment scoping |
| AttendanceRegularization.js | 8 fields | `organizationId` | Regularization scoping |
| Department.js | 4 fields | `organizationId` | Settings scoping |
| Shift.js | 5 fields | `organizationId` | Settings scoping |
| Holiday.js | 4 fields | `organizationId` | Settings scoping |
| Role.js | 3 fields | `organizationId` | Settings scoping |
| Designation.js | 4 fields | `organizationId` | Settings scoping |
| AssetCategory.js | 3 fields | `organizationId` | Settings scoping |
| Notification.js | 7 fields | `organizationId` | Notification scoping |
| TokenBlacklist.js | 5 fields | `organizationId` | Security scoping |
| SystemConfig.js | 3 fields | `organizationId` | Config scoping |
| Settings.js | 3 fields | `organizationId` | Settings scoping |
| SmeExpertise.js | 2 fields | `organizationId` | SME scoping |
| SelfServiceRequest.js | ~8 fields | `organizationId` | Self-service scoping |
| LifecycleHistory.js | ~12 fields | `organizationId` | Core HR scoping |
| ProjectDocument.js | ~6 fields | `organizationId` | Project docs scoping |

### 4.2 Compound Indexes

Every existing index must be updated to include `organizationId` as a prefix:

```javascript
// Before
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ department: 1 });

// After
UserSchema.index({ organizationId: 1, email: 1 }, { unique: true });
UserSchema.index({ organizationId: 1, department: 1 });
```

**Critical index changes:**

| Collection | Current Unique Index | New Compound Unique Index |
|------------|---------------------|---------------------------|
| users | `{ email: 1 }` | `{ organizationId: 1, email: 1 }` |
| employees | `{ email: 1 }` | `{ organizationId: 1, email: 1 }` |
| sme | `{ email: 1 }` | `{ organizationId: 1, email: 1 }` |
| jobs | `{ jobCode: 1 }` | `{ organizationId: 1, jobCode: 1 }` |
| invoices | `{ invoiceNo: 1 }` | `{ organizationId: 1, invoiceNo: 1 }` |
| departments | `{ name: 1 }` | `{ organizationId: 1, name: 1 }` |
| roles | `{ name: 1 }` | `{ organizationId: 1, name: 1 }` |
| designations | `{ name: 1 }` | `{ organizationId: 1, name: 1 }` |
| asset_categories | `{ name: 1 }` | `{ organizationId: 1, name: 1 }` |
| sme_expertise | `{ name: 1 }` | `{ organizationId: 1, name: 1 }` |

### 4.3 RBAC Scope Filter Changes

```javascript
// src/lib/rbac.js

export function scopeFilter(user, {
  userIdField   = 'userId',
  deptField     = 'department',
  teamLeadField = 'teamLeadId',
} = {}) {
  // ALWAYS scope to the user's organization first
  const baseFilter = { organizationId: user.orgId };

  if (['super_admin', 'admin_full'].includes(user.role)) {
    return baseFilter;  // see everything in their org
  }

  if (role === 'recruiter') return { ...baseFilter, [userIdField]: user._id };
  if (role === 'team_lead') return { ...baseFilter, [teamLeadField]: user._id };
  if (role === 'team_admin') return { ...baseFilter, [teamLeadField]: user._id };

  return { ...baseFilter, [userIdField]: user._id };
}

export function employeeScopeFilter(user) {
  const baseFilter = { organizationId: user.orgId };

  if (['super_admin', 'admin_full'].includes(user.role)) return baseFilter;
  if (role === 'recruiter') return baseFilter;
  if (role === 'team_lead')  return { ...baseFilter, teamLeadId: user._id };
  if (role === 'team_admin') return { ...baseFilter, teamAdminId: user._id };
  return { ...baseFilter, _id: user._id };
}
```

### 4.4 API Route Changes — Pattern

Every API route must be updated. The standard pattern becomes:

```javascript
// Before
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await connectDB();

  const query = {};
  if (!['super_admin', 'admin_full'].includes(user.role)) {
    query.department = user.department;
  }

  const data = await MyModel.find(query);
  return ok(data);
}

// After
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await connectDB();

  // Base query always includes orgId
  const query = { organizationId: user.orgId };
  if (!['super_admin', 'admin_full'].includes(user.role)) {
    query.department = user.department;
  }

  const data = await MyModel.find(query);
  return ok(data);
}
```

### 4.5 Unique Constraint Handling

Global unique constraints (e.g., `email` must be unique globally) must change to compound uniqueness:

```javascript
// Before
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
});

// After
const UserSchema = new mongoose.Schema({
  organizationId: { type: ObjectId, required: true },
  email:          { type: String, required: true },
});

UserSchema.index({ organizationId: 1, email: 1 }, { unique: true });
```

For fields that truly must be globally unique (e.g., system invoice numbers), keep the original unique index but this is rare.

### 4.6 Employee Numbering

```javascript
// Before — hardcoded format
const employeeNumber = `CHC-${year}-${String(seq).padStart(4, '0')}`;

// After — configurable per org
const orgConfig = await OrgConfig.findOne({ organizationId: orgId });
const format = orgConfig.employeeNumberFormat; // e.g. "{orgCode}-{year}-{seq:4}"
const orgCode = orgConfig.code; // e.g. "ACM"

const employeeNumber = format
  .replace('{orgCode}', orgCode)
  .replace('{year}', year)
  .replace('{seq:4}', String(seq).padStart(4, '0'));
```

---

## 5. Phase 3: Configurable Methodologies

This phase transforms the HRMS from a fixed-rule application into a **configurable HR platform** where each organization defines its own policies, workflows, and rules.

### 5.1 Architecture: Organization Config Store

```javascript
// Organization Config — one document per org with all module configs
const OrgConfigSchema = new mongoose.Schema({
  organizationId: { type: ObjectId, ref: 'Organization', unique: true, required: true },

  // ── Attendance ──
  attendance: {
    gracePeriodMinutes:    { type: Number, default: 15 },
    latePolicy:            { type: String, enum: ['strict', 'flexible', 'unlimited'], default: 'strict' },
    maxLatePerMonth:       { type: Number, default: 3 },
    overtimeEnabled:       { type: Boolean, default: false },
    overtimeAfterHours:    { type: Number, default: 9 },
    autoLogoutAfterHours:  { type: Number, default: 14 },
    workProgressRequired:  { type: Boolean, default: true },
    clockInToleranceMin:   { type: Number, default: 5 },
  },

  // ── Leave ──
  leave: {
    yearStartMonth:        { type: Number, default: 1 },  // January
    types: [{
      name:                { type: String },               // e.g. "Earned Leave"
      code:                { type: String },               // e.g. "EL"
      count:               { type: Number, default: 12 },
      carryForward:        { type: Boolean, default: false },
      carryForwardMax:     { type: Number, default: 0 },
      encashable:          { type: Boolean, default: false },
      minDaysPerRequest:   { type: Number, default: 0.5 },
      maxDaysPerRequest:   { type: Number, default: 30 },
      requiresApproval:    { type: Boolean, default: true },
    }],
    approvalFlow: {
      type:                { type: String, enum: ['single', 'multi', 'department_chain'], default: 'single' },
      levels: [{ level: Number, approverRole: String }],
    },
    accrualMethod: {
      type:                { type: String, enum: ['monthly_lump', 'annual_lump', 'per_period'], default: 'annual_lump' },
      accrualDay:          { type: Number, default: 1 },
    },
  },

  // ── Payroll ──
  payroll: {
    cycleType:             { type: String, enum: ['monthly', 'biweekly', 'weekly'], default: 'monthly' },
    payPeriodStartDay:     { type: Number, default: 1 },
    payDateDay:            { type: Number, default: 7 },  // 7th of next month
    currency:              { type: String, default: 'INR' },
    taxMethod:             { type: String, enum: ['old', 'new', 'custom'], default: 'new' },
    earningComponents: [{
      name:                { type: String },
      type:                { type: String, enum: ['fixed', 'percentage', 'formula'] },
      value:               { type: mongoose.Schema.Types.Mixed },
      percentageOf:        { type: String, default: null },
    }],
    deductionComponents: [{
      name:                { type: String },
      type:                { type: String, enum: ['fixed', 'percentage', 'formula'] },
      value:               { type: mongoose.Schema.Types.Mixed },
      mandatory:           { type: Boolean, default: false },
    }],
    bankFileFormat:        { type: String, default: 'standard' },
  },

  // ── Performance ──
  performance: {
    reviewCycle:           { type: String, enum: ['quarterly', 'half_yearly', 'annual'], default: 'annual' },
    reviewPeriodMonths:    [{ type: Number }],  // e.g. [1, 7] for Jan & Jul
    kpiFramework:          { type: String, enum: ['okr', 'bsc', 'custom'], default: 'okr' },
    ratingScale:           { type: String, enum: ['1-5', '1-10', 'descriptive'], default: '1-5' },
    selfReviewWeight:      { type: Number, default: 20 },  // percentage
    peerReviewWeight:      { type: Number, default: 20 },
    managerReviewWeight:   { type: Number, default: 60 },
    improvementPlanEnabled:{ type: Boolean, default: true },
  },

  // ── Recruitment ──
  recruitment: {
    stages: [{ type: String }],  // e.g. ["Applied","Screening","Interview","Offer","Hired","Rejected"]
    offerApprovalFlow: {
      enabled:             { type: Boolean, default: true },
      approverRoles:       [{ type: String }],
    },
    offerLetterTemplate:   { type: String, default: '' },  // reference to document template
    onboardingChecklist:   [{ type: String }],  // checklist items
  },

  // ── Core HR ──
  coreHr: {
    employeeNumberFormat:  { type: String, default: '{orgCode}-{year}-{seq:4}' },
    orgCode:               { type: String, default: 'ORG' },
    probationDurationDays: { type: Number, default: 180 },
    mandatoryFields:       [{ type: String }],  // e.g. ["pan", "aadhaar", "emergencyContact"]
    clearanceChecklist:    [{ type: String }],
    lifecycleTriggers: [{
      event:               { type: String },  // e.g. "promotion", "separation"
      autoEmail:           { type: Boolean, default: false },
      emailTemplate:       { type: String, default: '' },
      notifyRoles:         [{ type: String }],
    }],
  },

  // ── Calendar ──
  calendar: {
    defaultWorkingDays:    [{ type: Number }],  // 0=Sun, 1=Mon, ... 6=Sat
    weekOffDays:           [{ type: Number }],
    holidayCalendars: [{
      name:                { type: String },
      region:              { type: String },
      holidays: [{
        name:              { type: String },
        date:              { type: String },
        type:              { type: String },
      }],
    }],
  },

}, { timestamps: true });
```

### 5.2 Per-Module Configuration Details

#### Attendance Methodologies

| Config Key | Options | Description |
|-----------|---------|-------------|
| `gracePeriodMinutes` | 0–60 | Minutes after shift start considered "on time" |
| `latePolicy` | strict, flexible, unlimited | How late arrivals are handled |
| `maxLatePerMonth` | 0–31 | Max late arrivals before escalation |
| `overtimeEnabled` | true/false | Enable overtime calculation |
| `overtimeAfterHours` | 0–24 | Hours worked before OT kicks in |
| `autoLogoutAfterHours` | 0–24 | Force clock-out after N hours |
| `workProgressRequired` | true/false | Require work notes on clock-out |
| `clockInToleranceMin` | 0–30 | Allow clock-in N min before shift |

**Org A** (manufacturing): Strict attendance, 0 grace, overtime after 8h, mandatory work notes.  
**Org B** (startup): Flexible attendance, 30min grace, no overtime, optional work notes.  
**Org C** (retail): Shift-based, 5min grace, overtime after 9h, location-specific calendars.

#### Leave Methodologies

| Config Key | Options | Description |
|-----------|---------|-------------|
| `types[].name` | Custom | Leave type names (EL, SL, CL, etc.) |
| `types[].count` | 0–365 | Leave entitlement per year |
| `types[].carryForward` | true/false | Can unused leave roll over |
| `types[].carryForwardMax` | 0–365 | Max carry forward days |
| `types[].encashable` | true/false | Can leave be encashed |
| `approvalFlow.type` | single/multi/chain | Approval workflow type |
| `accrualMethod.type` | monthly_lump/annual_lump/per_period | How leave accrues |

**Org A** (banking): EL 15 days, SL 12 days, CL 10 days, carry forward max 30.  
**Org B** (agency): EL 20 days, no SL/CL distinction, unlimited carry forward.  
**Org C** (global): Different leave policies per region/country.

#### Payroll Methodologies

| Config Key | Options | Description |
|-----------|---------|-------------|
| `cycleType` | monthly/biweekly/weekly | Pay frequency |
| `payPeriodStartDay` | 1–28 | Start day of pay period |
| `payDateDay` | 1–28 | Day of month pay is processed |
| `taxMethod` | old/new/custom | Tax calculation regime |
| `earningComponents[].type` | fixed/percentage/formula | How earnings are calculated |
| `deductionComponents[].type` | fixed/percentage/formula | How deductions are calculated |
| `bankFileFormat` | standard/custom | Salary file format |

#### Performance Methodologies

| Config Key | Options | Description |
|-----------|---------|-------------|
| `reviewCycle` | quarterly/half_yearly/annual | How often reviews happen |
| `kpiFramework` | okr/bsc/custom | Performance framework |
| `ratingScale` | 1-5/1-10/descriptive | How performance is rated |
| `selfReviewWeight` | 0–100 | Weight of self-review |
| `peerReviewWeight` | 0–100 | Weight of peer review |
| `managerReviewWeight` | 0–100 | Weight of manager review |

#### Recruitment Methodologies

| Config Key | Options | Description |
|-----------|---------|-------------|
| `stages` | string[] | Custom hiring pipeline stages |
| `offerApprovalFlow.enabled` | true/false | Require approval for offers |
| `offerApprovalFlow.approverRoles` | string[] | Who must approve offers |
| `onboardingChecklist` | string[] | Default onboarding tasks |

### 5.3 Module Toggle System

```javascript
// In requireModule middleware — enhanced with org module check
export async function requireOrgModule(req, module) {
  const orgId = req.user.orgId;

  const org = await Organization.findById(orgId).select('modulesEnabled status');

  if (!org || org.status !== 'active') {
    return { error: fail('Organization account is not active', 403) };
  }

  if (!org.modulesEnabled.includes(module)) {
    return { error: fail(`Module "${module}" is not enabled for your organization`, 403) };
  }

  return { ok: true };
}

// Usage in API routes:
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const moduleCheck = await requireOrgModule(req, 'attendance');
  if (moduleCheck.error) return moduleCheck.error;

  // ... proceed with scoped query
}
```

### 5.4 Methodology Resolution Strategy

```javascript
// Central utility to resolve methodology for a given module
// Priority: Org-specific config → Global default → Hardcoded fallback

async function getModuleConfig(orgId, module) {
  const orgConfig = await OrgConfig.findOne({ organizationId: orgId }).lean();

  if (orgConfig && orgConfig[module]) {
    return orgConfig[module];
  }

  // Fall back to global defaults
  return DEFAULT_MODULE_CONFIGS[module];
}
```

---

## 6. Phase 4: White-Labeling & Branding

### 6.1 Custom Domain Support

```
Architecture:
  ┌─────────────────────────────────────────────────────┐
  │  DNS: CNAME acmecorp.com → hrms-platform.com       │
  │  DNS: CNAME *.hrms-platform.com → hrms-platform.com │
  ├─────────────────────────────────────────────────────┤
  │  Next.js Edge Middleware:                            │
  │    1. Read Host header from request                  │
  │    2. Lookup Organization by { domain: host }        │
  │    3. Lookup Organization by { slug: subdomain }     │
  │    4. Inject x-org-id, x-org-slug, x-org-config     │
  │    5. Rewrite URL path if needed                     │
  ├─────────────────────────────────────────────────────┤
  │  Response: Dynamic HTML with org branding injected   │
  └─────────────────────────────────────────────────────┘
```

### 6.2 Dynamic Branding Injection

```javascript
// Root layout reads org branding from store/props
// src/app/layout.js
export default async function RootLayout({ children }) {
  const orgId = cookies().get('orgId');

  if (orgId) {
    const org = await Organization.findById(orgId).lean();
    const branding = {
      companyName:  org.companyName || org.name,
      logo:         org.logo,
      favicon:      org.favicon,
      primaryColor: org.primaryColor,
    };

    return (
      <html>
        <head>
          <link rel="icon" href={branding.favicon || '/favicon.ico'} />
          <style>{`:root { --primary: ${branding.primaryColor}; }`}</style>
        </head>
        <body>
          <SettingsProvider orgId={orgId} branding={branding}>
            <AuthProvider>
              {children}
            </AuthProvider>
          </SettingsProvider>
        </body>
      </html>
    );
  }
  // ... fallback to defaults
}
```

### 6.3 Email Template Customization

```javascript
// src/lib/email.js
async function renderEmailTemplate(orgId, templateKey, data) {
  const orgConfig = await OrgConfig.findOne({ organizationId: orgId }).lean();
  const org = await Organization.findById(orgId).lean();

  const template = orgConfig.emailTemplates?.[templateKey] || DEFAULT_EMAIL_TEMPLATES[templateKey];

  return template
    .replace('{{companyName}}', org.companyName || org.name)
    .replace('{{logoUrl}}', org.logo || '')
    .replace('{{userName}}', data.userName)
    .replace('{{content}}', data.content);
}
```

### 6.4 Per-Org Locale & Formatting

```javascript
// Stored in Organization model and OrgConfig
{
  defaultTimezone:   'America/New_York',
  defaultDateFormat: 'MM/DD/YYYY',
  defaultCurrency:   'USD',
  locale:            'en-US',
  dateTimeFormat:    'MMM DD, YYYY h:mm A',
  firstDayOfWeek:    0,  // Sunday
  numberFormat: {
    decimal: '.',
    thousands: ',',
  },
}
```

---

## 7. Phase 5: Super Admin Portal

### 7.1 Route Structure

| Route | Purpose |
|-------|---------|
| `/super-admin` | Dashboard with cross-org metrics |
| `/super-admin/organizations` | List all organizations |
| `/super-admin/organizations/new` | Create new organization |
| `/super-admin/organizations/[id]` | Organization detail, config, management |
| `/super-admin/organizations/[id]/users` | Manage org admins |
| `/super-admin/organizations/[id]/billing` | Subscription & billing |
| `/super-admin/modules` | Global module registry |
| `/super-admin/audit` | Cross-org audit log viewer |
| `/super-admin/analytics` | Platform usage analytics |
| `/super-admin/settings` | Global default config presets |

### 7.2 Super Admin API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/admin/organizations` | List orgs (paginated, filterable) |
| POST | `/api/admin/organizations` | Provision new org |
| GET | `/api/admin/organizations/[id]` | Get org details |
| PATCH | `/api/admin/organizations/[id]` | Update org (config, plan, status) |
| DELETE | `/api/admin/organizations/[id]` | Soft-delete / suspend org |
| POST | `/api/admin/organizations/[id]/billing` | Update billing info |
| GET | `/api/admin/analytics` | Platform-wide statistics |
| GET | `/api/admin/audit` | Cross-org audit log |

### 7.3 Tenant Provisioning Flow

```
New Org Creation:
  1. Super admin fills org details (name, slug, plan)
  2. System creates Organization document
  3. System creates OrgConfig document with defaults
  4. System sends onboarding email to org admin
  5. Org admin sets up their organization (logo, departments, shifts, etc.)
  6. Org admin invites users
  7. Organization goes live

Self-Service Onboarding (future):
  1. Prospect visits hrms.com/signup
  2. Fills company details + admin account
  3. System creates org + admin user
  4. 14-day trial begins
  5. Org admin configures their HR rules
```

### 7.4 Billing & Subscription

```javascript
// Organization billing fields
const OrganizationSchema = new mongoose.Schema({
  plan: {
    type: String,
    enum: ['starter', 'professional', 'enterprise'],
    default: 'starter',
  },
  billingEmail: String,
  maxEmployees: { type: Number, default: 50 },
  maxStorage:   { type: Number, default: 1024 }, // MB
  subscriptionId: String,
  billingCycle: { type: String, enum: ['monthly', 'annual'], default: 'monthly' },
  trialEndsAt:  Date,
  suspendedAt:  Date,
  suspensionReason: String,
});

// Plan definitions (in config or DB)
const PLANS = {
  starter:      { price: 29,  employees: 50,  modules: ['core', 'attendance', 'leave'] },
  professional: { price: 99,  employees: 200, modules: ['core', 'attendance', 'leave', 'payroll', 'performance'] },
  enterprise:   { price: 299, employees: -1,  modules: 'all' },
};
```

---

## 8. Phase 6: New Module Suggestions

### 8.1 Module Priority Matrix

| Module | Dev Effort | Value to Orgs | Differentiation | Priority |
|--------|-----------|---------------|-----------------|----------|
| Knowledge Base | 2 weeks | High | Medium | High |
| Helpdesk/Ticketing | 3 weeks | High | Low | High |
| Form/Survey Builder | 4 weeks | High | High | High |
| LMS (Learning) | 6 weeks | Medium | High | Medium |
| Shift Scheduling | 4 weeks | Medium | Medium | Medium |
| Travel & Expense | 3 weeks | Medium | Low | Low |
| Contract Management | 2 weeks | Low | Medium | Low |
| Advanced Time Tracking | 3 weeks | High | Low | Low |

### 8.2 Module Blueprints

#### Knowledge Base

```
Structure:
  ├── Categories (HR Policies, Onboarding, Benefits, Compliance)
  ├── Articles (rich text, versioned, with attachments)
  ├── Tags and search
  ├── Read acknowledgments (employee must confirm they read)
  └── Department/role-based visibility

API routes:
  GET/POST    /api/knowledge-base/categories
  GET/POST    /api/knowledge-base/articles
  PATCH/DELETE /api/knowledge-base/articles/[id]
  POST        /api/knowledge-base/articles/[id]/acknowledge
```

#### Form/Survey Builder

```
Structure:
  ├── Form templates (drag-drop builder)
  ├── Field types: text, number, date, select, multi-select, file upload, rating
  ├── Conditional logic (show/hide fields)
  ├── Submissions with analytics
  └── Export to CSV/Excel

Use cases:
  ├── Employee engagement surveys
  ├── Exit interview forms
  ├── Training feedback
  ├── Pulse surveys
  ├── Custom HR request forms
```

#### LMS (Learning Management)

```
Structure:
  ├── Courses (modules, lessons, quizzes)
  ├── Assignments (course → employee/department)
  ├── Certificates (auto-generated on completion)
  ├── Progress tracking
  └── Mandatory vs optional courses

Integration:
  ├── Onboarding: auto-assign courses on hire
  ├── Compliance: expiry and re-certification reminders
  ├── Performance: link courses to improvement plans
```

#### Helpdesk/Ticketing

```
Structure:
  ├── Categories (IT, HR Admin, Payroll, Facilities)
  ├── Priority levels (low, medium, high, critical)
  ├── Assignment rules (round-robin, department)
  ├── SLA tracking
  └── Satisfaction ratings

API routes:
  GET/POST    /api/helpdesk/tickets
  PATCH       /api/helpdesk/tickets/[id]
  POST        /api/helpdesk/tickets/[id]/comments
  GET         /api/helpdesk/stats
```

---

## 9. CMS Conversion Analysis

### Recommendation: Do NOT Convert to CMS

Converting an HRMS into a full Content Management System is **not recommended**. These are fundamentally different application domains:

| Aspect | HRMS | CMS |
|--------|------|-----|
| **Primary data** | People, time, money | Content, pages, media |
| **Core operations** | Hire, pay, evaluate, track | Create, publish, manage, distribute |
| **Data model** | Structured, relational | Unstructured, hierarchical |
| **Workflows** | HR processes (attendance, leave, payroll) | Editorial workflows (draft, review, publish) |
| **Access patterns** | Transactional, high write | Read-heavy, content delivery |
| **Compliance** | GDPR, labor laws, tax regulations | Copyright, accessibility |

### HR-Specific Content Features That Add Value

Instead of converting, extend the HRMS with content capabilities where they serve HR purposes:

| Feature | Description | Value |
|---------|-------------|-------|
| **Employee Handbook** | Rich document with versioning, acknowledgments | Legal compliance, onboarding |
| **Policy Repository** | Searchable, categorized, role-based policy access | Self-service, transparency |
| **Offer Letter Templates** | Dynamic templates with variable substitution | HR efficiency |
| **Onboarding Portal** | Customizable onboarding pages with tasks, documents, videos | New hire experience |
| **Announcement Enhancement** | Rich media, scheduling, targeting, read receipts | Internal communication |
| **Document Generation** | Auto-generate PDFs (offer letters, appointment orders, experience certificates) | HR productivity |
| **Form Builder** | Custom HR forms with drag-drop builder | Flexibility for all orgs |

### When to Consider a Separate CMS

If organizations explicitly need a full CMS (marketing website, blog, public pages), use a **dedicated CMS** (WordPress, Strapi, Contentful) alongside the HRMS via:
- SSO integration
- API-based data sync
- Embeddable widgets
- This keeps concerns separated and each system focused on its domain.

---

## 10. Migration Strategy

### Overview

Migration is done in 8 sequential steps. Each step is production-safe and reversible.

```
Step 1: Backfill ─────► Step 2: Schema ─────► Step 3: Auth ─────► Step 4: API Scoping
                              │                                           │
                              ▼                                           ▼
                    Step 5: Super Admin ◄──── Step 6: Onboarding ◄──── Step 8: White-label
                              │
                              ▼
                    Step 7: Methodologies
```

### Step 1: Create Default Organization

```javascript
// Migration script — run ONCE before any schema changes
async function migrateCreateDefaultOrg() {
  await connectDB();

  const defaultOrg = await Organization.create({
    name: 'Default Organization',
    slug: 'default',
    status: 'active',
    plan: 'enterprise',
    modulesEnabled: ALL_MODULES,  // all 24+
  });

  // Store defaultOrg._id for use in Step 2
  console.log('Default Org ID:', defaultOrg._id);
  return defaultOrg._id;
}
```

### Step 2: Deploy Schema Changes

```javascript
// Migration script — add organizationId to all existing documents
async function migrateAddOrgIdToAllCollections(defaultOrgId) {
  const models = [
    User, Attendance, Leave, Task, Project,
    // ... all 30+ models
  ];

  for (const Model of models) {
    const result = await Model.updateMany(
      { organizationId: { $exists: false } },
      { $set: { organizationId: defaultOrgId } }
    );
    console.log(`${Model.modelName}: ${result.modifiedCount} documents updated`);
  }

  // Build new indexes
  for (const Model of models) {
    await Model.syncIndexes();  // creates compound + drops old
  }
}
```

### Step 3: Deploy Org-Aware Auth

- Update `User` schema (add `organizationId`, change email index)
- Update JWT sign/verify (include `orgId`)
- Update login route (org-aware lookup)
- Update `requireAuth` middleware (org membership check)
- Deploy subdomain middleware (read Host/Path → resolve org)

**Rollback:** Old tokens without `orgId` will fail `requireAuth`. Use a grace period:

```javascript
// Grace period logic in requireAuth
if (!decoded.orgId) {
  // Legacy token — check if user has a single org, use that
  // Warn admin and force re-login
}
```

### Step 4: Scope All API Routes (Module by Module)

Process:
1. Update `rbac.js` scope filters
2. Update one module (e.g., attendance)
3. Test thoroughly
4. Deploy
5. Repeat for next module

**Priority order for scoping:**
1. Auth & Users (foundation)
2. Settings (departments, shifts, holidays)
3. Attendance & Leave (most used)
4. Employees & Core HR
5. Payroll (most sensitive)
6. All remaining modules

### Step 5: Build Super Admin Portal

- Organization management (CRUD, status, plan)
- Tenant provisioning UI
- Cross-org audit view
- Global config defaults

### Step 6: Build Org Onboarding Flow

- Registration/signup flow for new organizations
- Quick-start wizard (departments, shifts, admin user)
- Default config preset selection
- Email invitation for org admin

### Step 7: Implement Configurable Methodologies (Module by Module)

- Build `OrgConfig` model and CRUD API
- Build config UI under `/settings/organization`
- Implement per-module configuration resolution in API routes
- Deprecate hardcoded rules

**Recommended order:**
1. Attendance config (simplest, immediate value)
2. Leave config (complex, high value)
3. Calendar/Holiday config
4. Payroll config (complex, critical for differentiation)
5. Performance config
6. Recruitment config
7. Core HR config

### Step 8: White-Labeling

- Custom domain DNS setup documentation
- Logo and branding UI in org settings
- Dynamic CSS variable injection
- Email template customization UI
- Locale/timezone configuration UI

---

## 11. Implementation Estimates

### Effort Summary

| Phase | Weeks | Developers | Key Deliverables |
|-------|-------|------------|------------------|
| **Phase 1: Foundation** | 3 | 2 | Organization model, auth changes, subdomain routing, middleware |
| **Phase 2: Data Scoping** | 4 | 2 | All 30+ schemas updated, 68+ API routes scoped, indexes migrated |
| **Phase 3: Methodologies** | 6 | 2 | OrgConfig model, config UI, per-module rule engine, 7 module configs |
| **Phase 4: White-Labeling** | 2 | 1 | Custom domain, branding UI, email templates, locale |
| **Phase 5: Super Admin** | 2 | 1 | Admin portal, org CRUD, billing, analytics, audit |
| **Phase 6: New Modules** | 2-4 per module | 1-2 | Per module: KB, Forms, LMS, Helpdesk, etc. |
| **Migration & Testing** | 2 | 2 | Data migration scripts, E2E tests, QA |
| **Total (core)** | **15-17 weeks** | 2 | Phases 1–5, no new modules |

### Risk Assessment

| Risk | Phase | Probability | Impact | Mitigation |
|------|-------|------------|--------|------------|
| Data leak during migration | 2 | Medium | Critical | Read-only mode during backfill, audit log |
| Broken unique constraints | 2 | High | High | Compound unique indexes, collision detection |
| Org resolution failure | 1 | Low | High | Graceful fallback to default org, error page |
| Slow queries without indexes | 2 | Medium | Medium | Create indexes BEFORE data migration |
| Config complexity overload | 3 | High | Medium | Progressive disclosure defaults, presets |
| API scope filter missed | 2 | Medium | Critical | Code review checklist, automated integration tests |
| Legacy token incompatibility | 1 | Medium | High | Grace period, forced re-login after N days |
| Custom domain DNS issues | 4 | Low | Low | Clear documentation, DNS validation tool |

### Recommended Implementation Order

```
Priority 1 ─── Phase 1 + Phase 2 (Foundation + Data Scoping)
              → MVP multi-tenant with basic data isolation
              → Can start selling to limited customers
              All modules work out of the box

Priority 2 ─── Phase 5 (Super Admin)
              → Ability to manage customers
              → Billing and provisioning

Priority 3 ─── Phase 3 (Methodologies) — Attendance + Leave first
              → Core value proposition
              → Differentiate from competitors

Priority 4 ─── Phase 3 (Methodologies) — Payroll + Performance
              → High-value configs
              → Enterprise sales enablement

Priority 5 ─── Phase 4 (White-Labeling)
              → Professional presentation
              → Customer satisfaction

Priority 6 ─── Phase 6 (New Modules)
              → Expansion and upsell
              → Market differentiation
```

---

## 12. Appendix: Code Change Examples

### A. Schema Change — Adding organizationId

```javascript
// ── BEFORE (Attendance.js) ──
const AttendanceSchema = new mongoose.Schema({
  userId:       { type: ObjectId, ref: 'User', required: true },
  date:         { type: String, required: true },
  clockIn:      { type: String },
  clockOut:     { type: String },
  hoursWorked:  { type: Number, default: 0 },
  status:       { type: String, enum: ['present','absent','late','leave','half_day'], default: 'present' },
  breaks:       [{ in: String, out: String }],
}, { timestamps: true });

// ── AFTER (Attendance.js) ──
const AttendanceSchema = new mongoose.Schema({
  organizationId: { type: ObjectId, ref: 'Organization', required: true, index: true },
  userId:         { type: ObjectId, ref: 'User', required: true },
  date:           { type: String, required: true },
  clockIn:        { type: String },
  clockOut:       { type: String },
  hoursWorked:    { type: Number, default: 0 },
  status:         { type: String, enum: ['present','absent','late','leave','half_day'], default: 'present' },
  breaks:         [{ in: String, out: String }],
}, { timestamps: true });

AttendanceSchema.index({ organizationId: 1, userId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ organizationId: 1, userId: 1 });
AttendanceSchema.index({ organizationId: 1, date: 1 });
```

### B. API Route Change — Scope Filter

```javascript
// ── BEFORE (attendance/route.js GET) ──
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await connectDB();

  const query = {};
  if (scope === 'my') {
    query.userId = user._id;
  } else if (scope === 'team') {
    const ids = await getTeamUserIds(user);
    if (ids) query.userId = { $in: ids };
  } else {
    query.userId = user._id;
  }

  const records = await Attendance.find(query).sort({ date: -1 });
  return ok(records);
}

// ── AFTER (attendance/route.js GET) ──
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await connectDB();

  const query = { organizationId: user.orgId };  // ← ONCE, always
  if (scope === 'my') {
    query.userId = user._id;
  } else if (scope === 'team') {
    const ids = await getTeamUserIds(user);
    if (ids) query.userId = { $in: ids };
  } else {
    query.userId = user._id;
  }

  const records = await Attendance.find(query).sort({ date: -1 });
  return ok(records);
}
```

### C. RBAC Scope Filter Change

```javascript
// ── BEFORE (rbac.js) ──
export function scopeFilter(user, {
  userIdField = 'userId',
  teamLeadField = 'teamLeadId',
} = {}) {
  if (['super_admin', 'admin_full'].includes(user.role)) return {};

  if (role === 'team_lead')  return { [teamLeadField]: user._id };
  if (role === 'team_admin') return { [teamLeadField]: user._id };

  return { [userIdField]: user._id };
}

// ── AFTER (rbac.js) ──
export function scopeFilter(user, {
  userIdField = 'userId',
  teamLeadField = 'teamLeadId',
} = {}) {
  // ALWAYS scope to org first
  const base = { organizationId: user.orgId };

  if (['super_admin', 'admin_full'].includes(user.role)) {
    return base;  // sees all within their org
  }

  if (role === 'team_lead')  return { ...base, [teamLeadField]: user._id };
  if (role === 'team_admin') return { ...base, [teamLeadField]: user._id };

  return { ...base, [userIdField]: user._id };
}
```

### D. Auth Middleware Change

```javascript
// ── BEFORE (middleware.js) ──
export async function requireAuth(req) {
  const token = getTokenFromRequest(req);
  if (!token) return { error: fail('No token provided', 401) };

  const decoded = verifyToken(token);
  if (!decoded) return { error: fail('Invalid or expired token', 401) };

  await connectDB();

  const blacklisted = await TokenBlacklist.findOne({ token });
  if (blacklisted) return { error: fail('Token has been revoked', 401) };

  const user = await User.findById(decoded.id).select('-password');
  if (!user || user.status !== 'active') return { error: fail('User not found or inactive', 401) };

  // Impersonation
  const impersonateId = req.headers.get('x-impersonate');
  if (impersonateId && user.role === 'super_admin') {
    const impersonated = await User.findById(impersonateId).select('-password');
    if (impersonated && impersonated.status === 'active') {
      return { user: impersonated, __isImpersonated: true };
    }
  }

  return { user };
}

// ── AFTER (middleware.js) ──
export async function requireAuth(req) {
  const token = getTokenFromRequest(req);
  if (!token) return { error: fail('No token provided', 401) };

  const decoded = verifyToken(token);
  if (!decoded) return { error: fail('Invalid or expired token', 401) };

  await connectDB();

  // NEW: Legacy token grace period
  if (!decoded.orgId) {
    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.status !== 'active') return { error: fail('User not found', 401) };
    // Legacy user, single org — inject it
    if (user.organizationId) {
      decoded.orgId = user.organizationId;
    } else {
      return { error: fail('Please log in again (org migration)', 401) };
    }
  }

  const blacklisted = await TokenBlacklist.findOne({ token });
  if (blacklisted) return { error: fail('Token has been revoked', 401) };

  // NEW: Validate org membership
  const user = await User.findOne({
    _id: decoded.id,
    organizationId: decoded.orgId,
  }).select('-password');

  if (!user || user.status !== 'active') {
    return { error: fail('User not found or inactive in this organization', 401) };
  }

  // NEW: Check org status
  const org = await Organization.findById(decoded.orgId).select('status').lean();
  if (!org || org.status === 'suspended') {
    return { error: fail('Organization account is not active', 403) };
  }

  // Impersonation (org-aware)
  const impersonateId = req.headers.get('x-impersonate');
  if (impersonateId && user.role === 'super_admin') {
    const impersonated = await User.findOne({
      _id: impersonateId,
      organizationId: decoded.orgId,  // same org boundary
    }).select('-password');
    if (impersonated && impersonated.status === 'active') {
      return { user: impersonated, __isImpersonated: true };
    }
  }

  // NEW: Attach orgId to the user object for downstream use
  return { user: { ...user.toObject(), orgId: decoded.orgId } };
}
```

### E. JWT Token Change

```javascript
// ── BEFORE (jwt.js) ──
export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// Usage in login:
const token = signToken({ id: user._id, role: user.role });

// ── AFTER (jwt.js) ──
export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
}

// Usage in login:
const token = signToken({
  id:      user._id,
  role:    user.role,
  orgId:   user.organizationId,
  orgSlug: organization.slug,
});

// New helper for token validation with org context
export function verifyOrgToken(token, expectedOrgId) {
  const decoded = verifyToken(token);
  if (!decoded) return null;
  if (decoded.orgId !== expectedOrgId) return null;  // org mismatch
  return decoded;
}
```

### F. Subdomain Middleware (Edge)

```javascript
// src/middleware.js (Next.js Edge Middleware — NEW FILE)
import { NextResponse } from 'next/server';

export async function middleware(req) {
  const { hostname, pathname } = new URL(req.url);
  const subdomain = hostname.split('.')[0];

  // Skip root domain, www, super admin, API
  if (
    subdomain === 'www' ||
    subdomain === 'hrms' ||
    hostname === 'localhost' ||
    hostname === 'hrms.com' ||
    pathname.startsWith('/super-admin') ||
    pathname.startsWith('/api/admin')
  ) {
    return NextResponse.next();
  }

  // Look up org by subdomain
  const response = NextResponse.next();

  if (subdomain !== hostname) {
    // Try subdomain resolution
    response.headers.set('x-org-slug', subdomain);
  }

  // For custom domains, try direct lookup (handled at API level)
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### G. Methodology Resolution in API

```javascript
// ── USING METHODOLOGY CONFIG IN ATTENDANCE API ──
export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;
  await connectDB();

  const body = await req.json();

  // Resolve attendance config for this org
  const attendanceConfig = await getModuleConfig(user.orgId, 'attendance');

  const { clockIn, date } = body;

  // Apply org-specific grace period
  const shift = await Shift.findOne({ name: user.shift }).lean();
  const shiftStart = parseTime(shift.startTime);
  const actualClockIn = parseTime(clockIn);
  const lateByMinutes = diffMinutes(actualClockIn, shiftStart);

  let status = 'present';
  if (lateByMinutes > attendanceConfig.gracePeriodMinutes) {
    if (attendanceConfig.latePolicy === 'strict') {
      status = 'late';
      // Check max late count for the month
      const lateCount = await Attendance.countDocuments({
        organizationId: user.orgId,
        userId: user._id,
        status: 'late',
        date: { $regex: `^${date.substring(0, 7)}` },
      });
      if (lateCount >= attendanceConfig.maxLatePerMonth) {
        // Escalate
        await notifyManager(user, 'Exceeded max late count');
      }
    } else if (attendanceConfig.latePolicy === 'flexible') {
      status = 'present'; // flexible policy ignores lateness
    }
  }

  const record = await Attendance.create({
    organizationId: user.orgId,
    userId: user._id,
    date,
    clockIn,
    status,
  });

  return ok(record);
}
```

---

## Appendix: Key Files Reference

| File | Purpose | Change Required |
|------|---------|-----------------|
| `src/lib/models/Organization.js` | NEW — Organization entity | Create |
| `src/lib/models/OrgConfig.js` | NEW — Per-org methodology config | Create |
| `src/lib/models/User.js` | Auth user | Add `organizationId`, change email index |
| `src/lib/models/*.js` | All 30+ models | Add `organizationId` to each schema |
| `src/lib/models/index.js` | Central model exports | Add Organization, OrgConfig exports |
| `src/lib/middleware.js` | Auth middleware | Add org validation, super admin bypass |
| `src/lib/rbac.js` | RBAC engine | Add `organizationId` to scope filters |
| `src/lib/jwt.js` | JWT helpers | Add orgId to token payload |
| `src/lib/auth.js` | Client auth context | Add orgId tracking |
| `src/lib/api.js` | Client API client | Add org context headers |
| `src/app/api/auth/login/route.js` | Login | Org-aware login lookup |
| `src/app/api/*/route.js` | All 68+ API routes | Add `organizationId` to all queries |
| `src/app/layout.js` | Root layout | Dynamic org branding injection |
| `src/middleware.js` | NEW — Edge middleware | Subdomain resolution, org header |
| `src/app/super-admin/*` | NEW — Super admin portal | Create |
| `src/app/settings/organization/*` | NEW — Org config UI | Create |
| `src/components/Sidebar.js` | Navigation | Filter modules by org subscription |
| `src/lib/core/constants.js` | Enums | Add org-related constants |
| `scripts/migrate-multi-tenant.js` | NEW — Migration script | Create |

---

> **End of Document**
>
> This document serves as the technical blueprint for transforming HRMS2.0 from a single-tenant application into a multi-tenant SaaS platform. All phases are designed to be implemented incrementally, with Phase 1 + 2 being the minimum viable path to production.
