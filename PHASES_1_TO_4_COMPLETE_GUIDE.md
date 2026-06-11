# HRMS 2.0 — Phase 1 to Phase 4 Complete Changes & Testing Guide

**Project:** HRMS 2.0  
**Stack:** Next.js 16.2.6, React 19, MongoDB, Mongoose, Zod  
**Status:** Phase 4 Complete — All deliverables implemented and build verified

---

## Table of Contents

1. [Phase 1 — Security Hardening](#phase-1)
2. [Phase 2 — Core HR Lifecycle Engine](#phase-2)
3. [Phase 3 — Self-Service, Registration & UI Completion](#phase-3)
4. [Phase 4 — Production Hardening](#phase-4)
5. [How to Test — Phase by Phase](#testing)
6. [Test Accounts & Credentials](#credentials)
7. [Known Limitations](#limitations)

---

## Phase 1 — Security Hardening {#phase-1}

### What Was Done

#### 1. Zod Validation Framework
**File:** `src/lib/validation.js`

Every API route that accepted user input previously did a direct `req.json()` spread into the database. Phase 1 introduced Zod schemas for all major operations with `.strict()` mode to reject unknown fields (mass assignment prevention).

Schemas added:
- `LoginSchema` — email + password
- `CreateEmployeeSchema` — 12 fields, strict mode
- `UpdateEmployeeSchema` — partial version of the above
- `CreateLeaveSchema` — date validation, enum types, past-date prevention
- `ApproveLeaveSchema` — action enum
- `ClockInOutSchema` — action enum
- `AttendanceRegularizeSchema` — HH:MM time format, minimum reason length
- `ApproveRegularizationSchema` — action enum
- `CreateDocumentSchema` — URL validation, access enum
- `CreateDepartmentSchema`, `CreateShiftSchema`, `CreateHolidaySchema`
- All Core HR schemas: `CreateCoreIdentitySchema`, `UpdateCoreIdentitySchema`, `CreateEmploymentProfileSchema`, `LifecycleActionSchema` (union of 6 sub-schemas)
- `CreateSelfServiceRequestSchema`, `ReviewSelfServiceRequestSchema`

#### 2. Token Blacklisting
**Files:** `src/lib/models/index.js`, `src/lib/middleware.js`, `src/app/api/auth/logout/route.js`

- Added `TokenBlacklist` model with 7-day TTL auto-expiry
- `requireAuth()` middleware now checks blacklist on every request
- `POST /api/auth/logout` adds the current token to the blacklist
- `POST /api/auth/change-password` also blacklists the old token

#### 3. Brute-Force Login Lockout
**File:** `src/app/api/auth/login/route.js`

- 5 failed attempts triggers a 30-minute account lock
- Lock is stored in the database via the `User` model (`loginAttempts`, `lockUntil`)
- All attempts (success and failure) are written to the audit log with IP address

#### 4. Centralized Audit Logging
**File:** `src/lib/middleware.js`

Added `auditLog(action, module, userId, details, severity, ip)` helper used by all routes. Severity levels: `low`, `medium`, `high`.

#### 5. Seed Route Protection
**File:** `src/app/api/seed/route.js`

Seed route gated by `SETUP_TOKEN` environment variable. Returns 404 in production if `ENABLE_SEED_ROUTE !== 'true'`.

---

### Files Changed in Phase 1

| File | Change |
|---|---|
| `src/lib/validation.js` | Created — all Zod schemas |
| `src/lib/models/index.js` | Added `TokenBlacklist` model |
| `src/lib/middleware.js` | Added blacklist check + `auditLog` helper |
| `src/app/api/auth/login/route.js` | Brute-force lockout, schema validation |
| `src/app/api/auth/logout/route.js` | Created — token blacklisting on logout |
| `src/app/api/employees/route.js` | Schema validation, mass assignment fix |
| `src/app/api/employees/[id]/route.js` | Schema validation, change tracking |
| `src/app/api/leave/route.js` | Schema validation, audit logging |
| `src/app/api/leave/[id]/route.js` | Approval action validation |
| `src/app/api/attendance/clock/route.js` | ClockInOut schema |
| `src/app/api/attendance/regularize/route.js` | Regularize schema |
| `src/app/api/documents/route.js` | Mass assignment fix, URL validation |
| `.env.local` | Secrets rotated (strong JWT, SETUP_TOKEN) |

---

## Phase 2 — Core HR Lifecycle Engine {#phase-2}

### What Was Done

#### 1. Three New Core HR Models
**Files:** `src/lib/models/Identity.js`, `src/lib/models/EmploymentProfile.js`, `src/lib/models/LifecycleHistory.js`

- **`UsrIdentity`** — Legal name, personal contact, address history, emergency contacts, encrypted PAN/Aadhaar identifiers, gender, marital status, nationality, blood group
- **`EmpProfile`** — Employment type, lifecycle status, department, designation, shift, hire dates, probation dates, reporting line, compensation snapshot, separation details, exit clearance checklist, record locking
- **`EmpLifecycleHistory`** — Append-only event log for every lifecycle transition

#### 2. Full Lifecycle Transition Engine
**File:** `src/app/api/core/lifecycle/transition/route.js`

Supported actions and their state transitions:

| Action | From | To |
|---|---|---|
| `confirm_probation` | onboarding | probation |
| `confirm_probation` | probation | active |
| `transfer` | any active | active (new dept) |
| `promotion` | active | active (new designation) |
| `suspend` | active | suspended |
| `separation` | any | resigned / terminated / retired |
| `rehire` | resigned / terminated / retired | rehired |

Each transition syncs data across all 4 layers: `UsrIdentity`, `EmpProfile`, `User`, and legacy `Employee`.

#### 3. Core HR APIs
- `GET/POST /api/core/identities` — list and create identities
- `GET/PUT /api/core/identities/[id]` — read and update identity (including PAN/Aadhaar)
- `GET/POST /api/core/profiles` — list and create employment profiles
- `GET/PUT /api/core/profiles/[id]` — read and update profile
- `PATCH /api/core/profiles/clearance` — update exit clearance checklist items
- `GET /api/core/lifecycle` — read lifecycle history for a profile

#### 4. Core HR Lifecycle UI — `/core-hr`
**File:** `src/app/core-hr/page.js`

Complete rewrite in Phase 4 (see below). Phase 2 originally built:
- Employee directory with search
- Action tab panel for all 6 lifecycle actions
- History timeline for selected employee
- Stats tiles showing Core Profiles, Legacy Records, Visible Results, Recent Events

#### 5. HR Requests Page — `/core-hr/requests`
**File:** `src/app/core-hr/requests/page.js`

HR admins can view and approve/reject pending self-service requests submitted by employees.

#### 6. RBAC Extended
**File:** `src/lib/rbac.js`

Added `core_hr` module. `CORE_HR_MANAGER_ROLES` and `CORE_HR_WRITE_ROLES` constants defined in `src/lib/core/constants.js`.

#### 7. Privacy Layer
**File:** `src/lib/core/privacy.js`

- `buildSensitiveIdentifierPayload(type, value)` — encrypts PAN/Aadhaar with AES-256-GCM, stores hash and masked value
- `sanitizeIdentityRecord(record, viewerRole)` — strips encrypted values from responses; admins get masked values, others get identifiers block deleted entirely
- `buildChangeSet()` — detects which fields changed between two states for history logging

---

### Files Changed in Phase 2

| File | Change |
|---|---|
| `src/lib/models/Identity.js` | Created — `UsrIdentity` model |
| `src/lib/models/EmploymentProfile.js` | Created — `EmpProfile` model with clearance checklist |
| `src/lib/models/LifecycleHistory.js` | Created — append-only history model |
| `src/lib/core/constants.js` | Created — lifecycle enums and role constants |
| `src/lib/core/history.js` | Created — `recordLifecycleHistory()` helper |
| `src/lib/core/privacy.js` | Created — encryption, masking, sanitization |
| `src/lib/models/index.js` | Exported new models |
| `src/app/api/core/identities/route.js` | Created |
| `src/app/api/core/identities/[id]/route.js` | Created |
| `src/app/api/core/profiles/route.js` | Created |
| `src/app/api/core/profiles/[id]/route.js` | Created |
| `src/app/api/core/profiles/clearance/route.js` | Created |
| `src/app/api/core/lifecycle/route.js` | Created — history query |
| `src/app/api/core/lifecycle/transition/route.js` | Created — transition engine |
| `src/app/core-hr/page.js` | Created |
| `src/app/core-hr/requests/page.js` | Created |
| `src/lib/rbac.js` | Extended with core_hr module |

---

## Phase 3 — Self-Service, Registration & UI Completion {#phase-3}

### What Was Done

#### 1. Single Registration Flow — Auto Core HR Record Creation
**File:** `src/app/api/employees/route.js`

When an employee is registered through `/employees`, the POST handler now:
1. Creates `User` (auth record)
2. Creates `Employee` (legacy record)
3. Auto-creates `UsrIdentity` from the registration data
4. Auto-creates `EmpProfile` with `employmentStatus: 'onboarding'`
5. Links all records (`User.identityId`, `User.profileId`)
6. Writes initial lifecycle history entry

#### 2. Sequential Employee ID — `CHC-YYYY-NNNN`
**File:** `src/app/api/employees/route.js`

Employee numbers are generated as `CHC-{hireYear}-{sequence padded to 4}` and stored in `EmpProfile.employeeNumber`.

#### 3. Self-Service Page — `/self-service`
**File:** `src/app/self-service/page.js`

Employees can submit:
- Profile update requests (name, phone)
- Address update requests
- Emergency contact update requests
- Resignation requests

All submissions create a `SelfServiceRequest` document and send a notification to HR admins.

#### 4. HR Approval Flow
**File:** `src/app/api/core/self-service-requests/route.js`

HR can approve or reject requests. Approved changes write directly to `UsrIdentity`.

#### 5. Notifications System
**File:** `src/lib/notify.js`

`notify(userId, title, message, type, refId)` helper used everywhere. Notification types: `leave`, `attendance`, `general`, `lifecycle`, `self_service`, `payroll`.

#### 6. Employee Detail Page — `/employees/[id]`
**File:** `src/app/employees/[id]/page.js`

New Personal Info tab showing:
- Identity Details (legal name, contact, gender, etc.)
- Sensitive Identifiers (PAN, Aadhaar — admin only)
- Employment Profile (employee number, type, status, dates)
- Address history
- Emergency contacts

#### 7. Core HR Dropdowns from Settings
All department, designation, and shift dropdowns in Core HR pull from the Settings collections instead of being hardcoded.

#### 8. Leave Approval 3-Tier Flow
Admin → Team Admin → Team Lead with hold and override capability.

#### 9. Attendance Regularization
Employees can submit regularization requests for missing clock-in/out. Admins approve or reject.

#### 10. Payroll Engine
- Salary structure per employee
- Run payroll (calculates LOP from attendance automatically)
- Approve and finalize
- Employee payslips

---

### Files Changed in Phase 3

| File | Change |
|---|---|
| `src/app/api/employees/route.js` | Auto-creates Core HR records on registration |
| `src/app/api/core/self-service-requests/route.js` | Created — full CRUD + approval |
| `src/app/api/self-service/me/route.js` | Created — employee self-service |
| `src/app/self-service/page.js` | Created |
| `src/app/employees/[id]/page.js` | Created — with Personal Info tab |
| `src/app/api/employees/[id]/details/route.js` | Created — enriched detail endpoint |
| `src/lib/models/SelfServiceRequest.js` | Created |
| `src/lib/notify.js` | Created |
| `src/lib/models/index.js` | Added notification type enum expansion |
| `src/app/api/leave/route.js` | 3-tier approval flow |
| `src/app/api/leave/[id]/route.js` | Hold + override |
| `src/app/api/attendance/regularize/route.js` | Created |
| `src/app/api/payroll/route.js` | Created |
| `src/app/api/payroll/run/route.js` | Created — LOP auto-calculation |
| `src/app/api/payroll/approve/route.js` | Created |
| `src/app/api/payroll/structure/route.js` | Created |
| `src/app/payroll/page.js` | Created |

---

## Phase 4 — Production Hardening {#phase-4}

### What Was Done

#### 1. HR Lifecycle Analytics Report
**Files:** `src/app/api/reports/route.js`, `src/app/reports/page.js`

New `lifecycle` report type accessible to `super_admin` and `admin_full`:
- Headcount by lifecycle status (onboarding, probation, active, suspended, resigned, terminated, rehired)
- Headcount breakdown by department
- Self-service request summary (pending / approved / rejected per request type)
- Full employee table with name, dept, designation, status, hire date, rehire count

#### 2. Department Member Count Sync on Lifecycle Transitions
**File:** `src/app/api/core/lifecycle/transition/route.js`

`Department.members` count now stays accurate across the full lifecycle:
- **Transfer** — decrements old department, increments new department
- **Separation** — decrements the employee's department
- **Rehire** — increments the new department

#### 3. Notification Type Expansion + Navigation
**Files:** `src/lib/models/index.js`, `src/components/Topbar.js`, `src/components/Sidebar.js`

- Notification model enum expanded: `['leave', 'attendance', 'general', 'lifecycle', 'self_service', 'payroll']`
- Clicking any notification now navigates to the correct page
- Topbar bell shows a yellow banner when pending self-service requests exist
- Sidebar shows a red badge on HR Requests link with pending count

#### 4. Exit Clearance Checklist + Record Locking
**Files:** `src/lib/models/EmploymentProfile.js`, `src/app/api/core/profiles/clearance/route.js`, `src/app/core-hr/page.js`

6-item clearance checklist per separated employee:
- Asset Returned
- Access Revoked
- Final Settlement
- Exit Interview Done
- NOC Issued
- Relieving Letter

Profile auto-locks when all 6 items are checked AND settlement status is `settled`. Locked profiles cannot receive further lifecycle transitions except `rehire`.

#### 5. Legacy Read-Path Enrichment
**File:** `src/app/api/employees/route.js`

The `GET /api/employees` endpoint now enriches each employee record with `employeeNumber` and `employmentStatus` from `EmpProfile`. The employee directory table shows both columns.

#### 6. Payslip PDF Export
**File:** `src/app/payroll/page.js`

`printPayslip(slip, empName)` opens a fully styled print window. Print/PDF buttons appear:
- In the Payroll Register table per row
- In the My Payslip net pay banner
- In the admin payslip modal

#### 7. Salary Structure Validation Before Payroll Run
**File:** `src/app/payroll/page.js`

Before running payroll, the system checks which active employees have no salary structure. If any are found, a confirmation dialog lists them by name and warns they will be skipped.

#### 8. Core HR Page Full Rewrite
**File:** `src/app/core-hr/page.js`

- Removed "Create Core Profile" section entirely
- New stats row: Core Profiles, Active, Onboarding, Separated counts
- Status badges with per-status color coding (blue=onboarding, green=active, amber=probation, red=suspended/terminated, etc.)
- Directory sidebar with search + status dropdown filter, selected item highlighted with blue left border
- Employee snapshot card below directory list
- Action tabs styled with per-action accent colors and underline indicator
- Lifecycle history rendered as vertical timeline with from→to arrows
- Exit clearance checklist preserved with improved card layout

#### 9. PAN / Aadhaar Entry in Add Employee Modal
**Files:** `src/app/employees/page.js`, `src/app/api/employees/route.js`, `src/lib/validation.js`

- PAN and Aadhaar fields added to the Add Employee modal (super_admin / admin_full only, Add only — not Edit)
- Client-side validation: PAN `^[A-Z]{5}[0-9]{4}[A-Z]$`, Aadhaar exactly 12 digits
- PAN auto-uppercased, Aadhaar strips non-digits on input
- On save, values are encrypted (AES-256-GCM), hashed (SHA-256), and stored as masked values in `UsrIdentity`

#### 10. PAN / Aadhaar Display in Employee Detail Personal Info Tab
**Files:** `src/app/employees/[id]/page.js`, `src/app/api/employees/[id]/details/route.js`, `src/lib/core/privacy.js`

- `sanitizeIdentityRecord(record, viewerRole)` now gates by role
- `super_admin` and `admin_full` see masked values (`ABCDE****F`, `XXXX-XXXX-5678`)
- All other roles get the identifiers block deleted from the response entirely
- Update button allows admins to update PAN/Aadhaar inline with the same format validation
- "Not entered" shown in muted italic when not set

#### 11. Data Retention / Archive Policy
**Files:** `src/app/api/core/archive/route.js`, `src/app/settings/page.js`

- `GET /api/core/archive?olderThanYears=N` — previews eligible profiles (separated + locked + last updated older than N years)
- `POST /api/core/archive { olderThanYears: N }` — archives them (status → `alumni`, identity → `archived`)
- Settings General tab shows a Data Retention section (super_admin only) with year selector, Preview button, candidate list, and Archive button with confirmation guard

---

### Files Changed in Phase 4

| File | Change |
|---|---|
| `src/app/api/reports/route.js` | Lifecycle report type added |
| `src/app/reports/page.js` | HR Lifecycle report card, dept chart, self-service summary |
| `src/app/api/core/lifecycle/transition/route.js` | Dept member count sync; lifecycle notification type |
| `src/lib/models/index.js` | Notification enum expanded |
| `src/components/Topbar.js` | Notification navigation, pending requests banner |
| `src/components/Sidebar.js` | Pending HR requests badge |
| `src/app/core-hr/page.js` | Full rewrite — removed Create Profile, new UI |
| `src/app/api/core/profiles/clearance/route.js` | Created |
| `src/app/payroll/page.js` | PDF export, salary structure validation |
| `src/app/employees/page.js` | PAN/Aadhaar fields in Add modal |
| `src/app/employees/[id]/page.js` | PAN/Aadhaar display + update in Personal Info tab |
| `src/app/api/employees/route.js` | PAN/Aadhaar wired into identity creation |
| `src/app/api/employees/[id]/details/route.js` | Passes role to sanitizeIdentityRecord |
| `src/lib/core/privacy.js` | Role-gated sanitizeIdentityRecord |
| `src/lib/validation.js` | panNumber + aadhaarNumber added to CreateEmployeeSchema |
| `src/app/api/core/identities/route.js` | sanitizeIdentityRecord role passing |
| `src/app/api/core/identities/[id]/route.js` | sanitizeIdentityRecord role passing; file rewritten |
| `src/app/api/core/archive/route.js` | Created — data retention archive API |
| `src/app/settings/page.js` | Data retention UI in General tab |

---

## How to Test — Phase by Phase {#testing}

### Setup Before Testing

```bash
npm run dev
```

Go to `http://localhost:3000`. Seed the database at `http://localhost:3000/api/seed` (POST with `{ "token": "<your SETUP_TOKEN from .env.local>" }`).

---

### Phase 1 Testing — Security

#### Test 1.1 — Brute Force Lockout
1. Go to `/login`
2. Enter a valid email with wrong password 5 times
3. Expected: 6th attempt returns "Account locked for 30 minutes"
4. Wait 30 minutes OR manually clear `loginAttempts` and `lockUntil` in MongoDB

#### Test 1.2 — Mass Assignment Prevention
1. As an employee (non-admin), call `PUT /api/employees/:id` with body `{ "role": "super_admin" }`
2. Expected: 403 Access Denied (non-admins can only update phone, avatar, skills, designation)

#### Test 1.3 — Token Blacklisting on Logout
1. Log in and copy the JWT token from localStorage (`hrms_token`)
2. Click Logout
3. Try calling any API with the old token (e.g., `GET /api/employees` with `Authorization: Bearer <old_token>`)
4. Expected: 401 "Token has been revoked"

#### Test 1.4 — Input Validation
1. Try `POST /api/leave` with `{ "type": "InvalidType", "from": "not-a-date" }`
2. Expected: 400 "Validation failed: type: Invalid enum value..."

#### Test 1.5 — Audit Log
1. Perform any action (login, create employee, approve leave)
2. Navigate to `/audit` as super_admin
3. Expected: Entries appear with correct module, severity, and IP

---

### Phase 2 Testing — Core HR Lifecycle

#### Test 2.1 — Employee Directory in Core HR
1. Go to `/core-hr` as super_admin or admin_full
2. Expected: Directory shows employees with status badges (blue=onboarding, green=active, etc.)
3. Use the search bar — filters by name, department, status in real time
4. Use the status dropdown — filters directory to that status only

#### Test 2.2 — Lifecycle Transitions
1. Select an employee with status `onboarding`
2. Click the "Probation" tab → set effective date → click "Apply Probation"
3. Expected: Status changes to `probation`, history timeline shows the event
4. Select the same employee (now probation) → click "Probation" tab again → apply
5. Expected: Status changes to `active`

#### Test 2.3 — Transfer
1. Select an active employee
2. Click "Transfer" tab
3. Change department and designation (use dropdowns from Settings)
4. Add a reason → click "Apply Transfer"
5. Expected: Department updates, history shows from→to state, Department.members synced

#### Test 2.4 — Separation + Clearance Checklist
1. Select an active employee
2. Click "Separate" tab
3. Choose separation type "Resignation", enter last working date, reason
4. Click "Apply Separate"
5. Expected: Status changes to `resigned`, Exit Clearance Checklist section appears below
6. Click each checklist item to check it off
7. Set `settlementStatus` to `settled` on a transition (or directly update in DB)
8. After all 6 items checked + settled: expected message "Profile locked"

#### Test 2.5 — Rehire
1. With a `resigned` employee (not locked), click "Rehire" tab
2. Select new department, designation, shift
3. Apply rehire
4. Expected: Status changes to `rehired`, rehireCount incremented in profile

#### Test 2.6 — Record Locking Prevents Further Transitions
1. With a fully cleared (locked) profile, try any lifecycle action except rehire
2. Expected: Error "This profile is locked after exit clearance. Only rehire is allowed."

---

### Phase 3 Testing — Self-Service & Registration

#### Test 3.1 — Registration Creates Core HR Records Automatically
1. As super_admin, go to `/employees` → Add Employee
2. Fill all fields, click "Add Employee"
3. Go to `/core-hr`
4. Expected: New employee appears in directory with status `onboarding` and `CHC-YYYY-NNNN` employee number

#### Test 3.2 — Employee ID Format
1. Register a new employee
2. Go to `/employees` — check the "Emp ID" column
3. Expected: Badge shows `CHC-2025-0001` (or next sequence number)

#### Test 3.3 — Self-Service Requests (as Employee)
1. Log in as a regular employee
2. Go to `/self-service`
3. Submit a "Profile Update" request (change phone number)
4. Expected: Request created, notification sent to HR admins

#### Test 3.4 — HR Review Queue
1. Log in as admin_full or super_admin
2. Go to `/core-hr/requests`
3. Expected: The self-service request from Test 3.3 appears
4. Click "Approve" → confirm
5. Expected: Identity record updated with new phone, employee notified

#### Test 3.5 — Notification Navigation
1. As an employee, submit a self-service request
2. Log in as admin — click the bell icon in the Topbar
3. Expected: Yellow banner showing pending request count + "Review now" button
4. Click the notification — expected: navigates to `/core-hr/requests`

#### Test 3.6 — Payroll Run with LOP Calculation
1. As admin, go to `/payroll` → Salary Structure tab
2. Create a salary structure for an active employee (set basic = 30000)
3. Go to the current month's attendance and ensure the employee has some present days and some absent
4. Click "Run Payroll"
5. Go to Payroll Register — expected: `lopDays` calculated based on absent days

---

### Phase 4 Testing — Production Hardening

#### Test 4.1 — HR Lifecycle Report
1. Go to `/reports` as super_admin or admin_full
2. Click the "HR Lifecycle" card (orange)
3. Expected: Summary cards show active/onboarding/separated counts
4. Bar chart shows headcount by lifecycle status
5. Second bar chart shows headcount by department
6. Self-service request summary table shows pending/approved/rejected counts

#### Test 4.2 — Payslip PDF Export
1. Go to `/payroll` after running payroll for a month
2. Admin: In the Payroll Register, click the "PDF" button next to any employee
3. Expected: New browser window opens with a formatted payslip + "Print / Save as PDF" button
4. Employee: On "My Payslip" tab, click the "Print / PDF" button in the net pay banner
5. Expected: Same print window opens

#### Test 4.3 — Salary Structure Validation Warning
1. Make sure at least one active employee has NO salary structure
2. As admin, click "Run Payroll"
3. Expected: Confirmation dialog appears listing employees without structures and warning they will be skipped
4. Click Cancel — no payroll runs
5. Click OK — payroll runs, those employees skipped

#### Test 4.4 — PAN / Aadhaar in Add Employee (Admin Only)
1. Log in as super_admin or admin_full
2. Go to `/employees` → Click "Add Employee"
3. Expected: At the bottom of the modal, a yellow "Sensitive Identifiers" section with PAN and Aadhaar fields
4. Enter an invalid PAN (e.g., `INVALID`) → click Save
5. Expected: Error toast "Invalid PAN — must be 5 letters, 4 digits, 1 letter"
6. Enter a valid PAN `ABCDE1234F` and Aadhaar `123456789012` → save
7. Go to the employee's detail page → Personal Info tab
8. Expected: PAN shows `ABCDE****F`, Aadhaar shows `XXXX-XXXX-9012`

#### Test 4.5 — PAN / Aadhaar Not Visible to Non-Admins
1. Log in as a regular employee
2. Navigate to your own employee detail page (or any employee)
3. Go to Personal Info tab
4. Expected: No "Sensitive Identifiers" section visible at all

#### Test 4.6 — PAN / Aadhaar Update from Personal Info Tab
1. Log in as super_admin
2. Go to any employee's detail page → Personal Info tab
3. Click "Update" in the Sensitive Identifiers section
4. Enter a new PAN and/or Aadhaar
5. Enter an invalid Aadhaar (e.g., 11 digits) → click "Save Securely"
6. Expected: Error toast "Invalid Aadhaar — must be exactly 12 digits"
7. Enter valid values → save
8. Expected: Masked values update immediately after page refreshes

#### Test 4.7 — Data Retention Archive (super_admin only)
1. Log in as super_admin
2. Go to `/settings` → General tab
3. Scroll to "Data Retention Policy" section at the bottom
4. Set years to `1` → click "Preview"
5. Expected: Shows count of profiles that are separated + locked + last updated > 1 year ago
6. If count > 0, click "Archive N Profiles"
7. Expected: Confirmation dialog → profiles status changed to `alumni`

#### Test 4.8 — Core HR Page Verify No Create Profile Section
1. Go to `/core-hr` as super_admin
2. Expected: No "Create Core Profile" panel anywhere on the page
3. The page shows: stats row, directory sidebar, action panel, history timeline

#### Test 4.9 — Department Member Count Sync
1. Note the `members` count for a department in `/settings` → Departments
2. Go to `/core-hr`, select an active employee in that department
3. Apply a Transfer to a different department
4. Go back to `/settings` → Departments
5. Expected: Original department count decreased by 1, new department count increased by 1

---

## Test Accounts & Credentials {#credentials}

After seeding the database, the following accounts are available (passwords as configured in `.env.local`):

| Role | Email | What They Can Do |
|---|---|---|
| `super_admin` | Set in seed | All actions including archive, PAN/Aadhaar, data retention |
| `admin_full` | Set in seed | All HR actions except data retention archive |
| `team_admin` | Created via Add Employee | Manage own team, approve leave for team |
| `team_lead` | Created via Add Employee | Second-tier leave approval |
| `employee` | Created via Add Employee | Self-service, view own payslip, apply leave |
| `recruiter` | Created via Add Employee | Add employees, view recruitment |

---

## Known Limitations {#limitations}

### Technical Debt from Phase 2 Assessment (Not Yet Addressed)

1. **No MongoDB Transactions** — Multi-step operations (employee creation, leave approval, payroll run) are not wrapped in database transactions. If a step fails mid-way, partial data may be written. Requires MongoDB replica set to enable transactions.

2. **No Pagination** — All list endpoints return all records. At scale (5,000+ employees), this will cause slow API responses and browser memory pressure.

3. **26 Working Days Hard-Coded** in payroll LOP calculation. Should be calculated from the actual calendar minus weekends and holidays.

4. **Time Stored as String** — Clock-in/clock-out stored as `"HH:MM"` strings rather than full timestamps. Night shift calculations (crossing midnight) may produce incorrect LOP values.

5. **Code Duplication** — `getTeamUserIds()` function defined independently in leave, attendance, and task API routes. Should be extracted to a shared service.

6. **No API Versioning** — All routes are at `/api/*`. Breaking changes require modifying existing endpoints.

7. **No Component Composition** — All page components are monolithic files (150–400 lines). Hard to unit test in isolation.

### Environment Requirements

- `IDENTITY_FIELD_ENCRYPTION_KEY` must be set in `.env.local` for PAN/Aadhaar encryption to work. If not set, `encryptedValue` will be `null` but `maskedValue` and `hashValue` are still stored.
- MongoDB must be accessible at the URI in `.env.local`
- `ENABLE_SEED_ROUTE=true` required to use the seed endpoint

---

*Document generated after Phase 4 completion. Build verified: 79 routes, 0 errors.*
