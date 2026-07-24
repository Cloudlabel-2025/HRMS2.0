# Enterprise HRMS Admin Panel — Complete Project Documentation

**Version:** 1.0  
**Date:** June 24, 2026  
**Technology Stack:** Next.js 16, React 19, MongoDB/Mongoose 9, Zod, JWT  
**Architecture:** White-box, App Router, API routes, Serverless-ready

---

## Foundation Data

### Role Hierarchy (most to least privileged)

```
super_admin → admin_full → recruiter → team_admin → team_lead → employee → intern → sme
```

### Permission Level Definitions

| Level | Meaning |
|-------|---------|
| `full` | Full CRUD, unrestricted access |
| `limited` | Can create and update but cannot delete |
| `view` | Read-only access |
| `dept` | Department-scoped (sees records within own department) |
| `team` | Team-scoped (sees direct reports only) |
| `self` | Own records only |
| `assigned` | Records assigned to the user |
| `false` | No access — module hidden from sidebar, API gates deny |

### Complete Module Permission Matrix

| Module | super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|--------|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| dashboard | full | full | limited | dept | team | self | limited | self |
| employees | full | full | view | dept | team | self | false | false |
| recruitment | full | full | full | false | false | false | false | false |
| timecard | full | full | self | dept | team | self | self | false |
| attendance | full | full | self | dept | team | self | self | self |
| absence | full | full | self | dept | team | self | self | false |
| leave | full | full | self | dept | team | self | self | self |
| payroll | full | limited | false | false | false | self | false | self |
| payslip | full | limited | false | false | false | self | false | false |
| tasks | full | full | limited | dept | team | assigned | assigned | assigned |
| projects | full | full | view | dept | team | assigned | assigned | assigned |
| performance | full | full | limited | dept | team | self | limited | false |
| documents | full | full | limited | dept | team | self | limited | false |
| finance | full | limited | false | false | false | false | false | false |
| invoicing | full | limited | false | false | false | false | false | false |
| inventory | full | full | false | dept | team | false | false | false |
| reports | full | full | limited | dept | team | self | false | false |
| communication | full | full | false | dept | team | view | view | false |
| calendar | full | full | self | dept | team | self | self | self |
| monitoring | full | full | false | dept | team | false | false | false |
| core_hr | full | full | view | dept | team | false | false | false |
| self_service | full | full | self | self | self | self | self | self |
| settings | full | limited | false | false | false | false | false | false |
| audit | full | view | false | false | false | false | false | false |
| sme | full | false | false | false | false | false | false | false |

> **Note:** The server-side RBAC (`src/lib/rbac.js`) is slightly more permissive than the client-side (`src/lib/auth.js`) for certain recruiter/employee/intern modules. The client hides nav items but the server still enforces access. The server is the source of truth.

---

# SECTION A: Module Documentation

## 1. Auth Module

### Behaviour
The authentication module manages all user identity verification, session management, and credential lifecycle. It provides login with rate-limiting and account lockout, JWT-based stateless sessions with refresh token rotation, password management (change, forgot, reset, first-login setup), and logout with token blacklisting.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | full | full | full | full | full | full |

Auth is universal — every user regardless of role goes through the same authentication flow.

### Flow

**Page Load → Login Page:**
1. User navigates to `/login`
2. If already authenticated (token in localStorage), the page immediately redirects to `/dashboard` via `window.location.replace` (removes login from browser history)

**Login Submission (POST /api/auth/login):**
1. Rate limiter checks IP (via `x-forwarded-for` header) — allows 3 attempts per 15-minute window
2. If rate limit exceeded, returns 429 with remaining wait time and logs to AuditLog
3. Validates request body against Zod `LoginSchema` (email format, password presence)
4. Queries `User.findOne({ email }).select('+password +loginAttempts +lockUntil')`
5. **User not found → handleFailure('Invalid email or password')** — generic message, no email enumeration
6. **Account locked (user.isLocked()) → handleFailure with minutes remaining** — 423 status
7. **Wrong password → user.incrementLoginAttempts()** — returns remaining attempts (5 max, lock at 0)
8. **Account inactive (status !== 'active') → handleFailure('Account is inactive')** — 403
9. **Leave-day gate** — checks if user has an approved leave covering today; if so, blocks login
10. **Hire-date gate** — if user's joinDate is today, blocks login until 90 minutes before shift start
11. **Success → reset login attempts, record firstLoginAt if first login, check for pending late-logout reason**
12. Returns JWT (`signToken`) + refresh token (`signRefreshToken`) + user data (id, name, email, role, department, designation, avatar, teamLeadId, teamAdminId, isFirstLogin, needsLateLogoutReason)
13. Audit log created for both success and failure

**Token Management:**
- JWT expires in configured time (default 15m from `JWT_EXPIRES_IN` env)
- Refresh token expires in 7 days
- `POST /api/auth/refresh` accepts `{ refreshToken }`, verifies it, checks `decoded.tokenType === 'refresh'`, validates user is active, and issues a new JWT
- `POST /api/auth/logout` adds the token to `TokenBlacklist` (TTL index auto-deletes after 7 days)
- Client-side `api.js` wrapper auto-refreshes JWT on 401 and retries the request once

**Password Flows:**
- `POST /api/auth/change-password` — requires current password, validates new password (min 6 chars, must differ from current)
- `POST /api/auth/forgot-password` — generates reset token, stores hash in user record
- `POST /api/auth/reset-password` — validates reset token, updates password
- `POST /api/auth/setup-password` — first-login flow, requires valid token from `isFirstLogin` flag

### Story
Super Admin Priya navigates to `/login`, enters her email `priya@hrms.com` and password. The backend verifies her credentials, finds no active leave blocking login, confirms her account is past the hire-date gate, and returns a JWT (valid 15 minutes) and a refresh token (valid 7 days). The client stores both in localStorage and redirects to `/dashboard`. When her JWT expires after 15 minutes, the `api.js` interceptor catches the 401, calls `/api/auth/refresh` with the stored refresh token, gets a new JWT, and retries the failed request seamlessly. At the end of the day, she clicks Logout, which blacklists her JWT so it can never be reused.

---

## 2. Dashboard Module

### Behaviour
The dashboard is the landing page after login, providing role-specific KPIs, quick action buttons, announcements, and recent activity timeline. It aggregates data from 10+ modules into a single API response.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | limited | dept | team | self | limited | self |

### Flow
1. Page mounts → calls `GET /api/dashboard` which aggregates server-side:
   - `totalEmployees` — User.countDocuments({status:'active'}) (admins only)
   - `presentToday` — Attendance.count for today (admins: all; team_lead/team_admin: scoped)
   - `pendingLeaves` — Leave.countDocuments({status:'pending'}) (admins: all; team_lead: dept)
   - `myPendingTasks` — Task.countDocuments({assignedTo: user._id, status: {$ne:'Completed'}})
   - `myAttendanceThisMonth` — Attendance.countDocuments for current month
   - `myLeaveBalance` — User's leaveBalance field
   - `lastPayslip` — Most recent Payroll record for the user
   - `openJobs` — Job.countDocuments({status:'active'}) (recruiters only)
   - `recentActivity` — Last 5 AuditLog entries
   - `announcements` — Active announcements (with audience targeting)

2. Client renders role-filtered KPI cards:
   - **Admins:** Total Employees, Present Today, Pending Leaves, Open Tasks
   - **Team Leads:** Team Members, Present Today, Pending Approvals, Team Tasks
   - **Recruiters:** Open Positions, Pending Tasks, My Leave Balance, Days Present
   - **Employees:** Days Present, Leave Balance, Pending Tasks, Last Payslip

3. Quick action buttons change by role:
   - **Admins:** Add Employee, Approve Leaves, Run Payroll, New Announcement
   - **Employees:** Clock In/Out, Request Leave, My Tasks, View Profile

4. Announcements section shows audience-targeted posts with tag colors

5. Recent activity timeline shows last 5 audited actions

### Story
Employee Rajesh logs in and lands on `/dashboard`. He sees 4 KPI cards: "Days Present This Month" (18), "Leave Balance" (12), "Pending Tasks" (3), and "Last Payslip" (₹45,000). Below, the announcements section shows a company-wide notice about the upcoming holiday. Quick actions let him clock in for the day, request leave, or view his tasks. He clicks "Clock In" to start his day.

---

## 3. Employees Module

### Behaviour
The employee directory provides listing, searching, creating, editing, and viewing detailed profiles. It is the primary HR interface for managing the workforce, including role assignment, department placement, and identity linkage.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | view | dept | team | self | false | false |

### Flow

**Page Load:**
1. `GET /api/employees` — returns all employees (scoped by role: super_admin/admin_full see all, team_lead sees dept, team_admin sees team, employee sees self)
2. `GET /api/settings?type=departments` — department list for filter dropdowns
3. `GET /api/settings?type=designations` — designation list for filter dropdowns
4. `GET /api/settings?type=shifts` — shift list for edit forms

**Employee Creation (POST /api/employees):**
1. Validates against Zod `CreateEmployeeSchema` (name, email, password, department, designation, role, shift, teamLeadId, teamAdminId, etc.)
2. Creates User document with hashed password, role, status='active', isFirstLogin=true
3. Creates Employee document (legacy flat employee doc linked to User)
4. Creates UsrIdentity (legal identity record with auto-generated identityCode)
5. Creates EmpProfile (employment profile with auto-generated employeeNumber)
6. Links User.identityId → UsrIdentity, User.profileId → EmpProfile
7. Audit-logged as "Employee Created"

**Employee View (GET /api/employees/[id]):**
1. Returns single employee record
2. Admin can edit inline (name, email, phone, department, designation, role, shift, teamLead, teamAdmin, status, skills, leaveBalance)
3. Edit calls `PUT /api/employees/[id]` for employee-level changes
4. Role changes cascade — updating role updates User.role

**Employee Detail View (GET /api/employees/[id]/details):**
Aggregates into a single response:
- `employee` — core employee record
- `identity` — UsrIdentity (legal name, DOB, gender, PAN/Aadhaar masked, address history, emergency contacts)
- `profile` — EmpProfile (employeeNumber, employmentType, status, hireDate, confirmationDate, reportingLine)
- `leaves` — recent Leave records for attendance tab
- `attendance` — last 30 days Attendance records
- `assets` — assigned Asset records
- `documents` — uploaded Document records
- `payslips` — Payroll records
- `auditLogs` — Audit trail for this user

**Tabs in Detail View:**
- **Overview:** Professional summary, skills, reporting chain (Team Admin → Team Lead → Employee)
- **Personal Info:** Identity details, encrypted identifiers (PAN/Aadhaar masked, admin-only), employment profile, address history, emergency contacts
- **Attendance:** Leave balance card, recent leaves table, last 30 days attendance table
- **Work Progress:** Monthly cycles with expandable dates and task progress tables, CSV download
- **Assets & Docs:** Assigned assets list, uploaded documents with download links
- **Payroll:** Payslip history table (month, gross, deductions, net, status)
- **Audit Log:** Activity log table with action, module, details, severity, timestamp

**Employee Deletion (DELETE /api/employees/[id]):**
- Super_admin only
- Soft-delete: sets status to 'alumni', removes from active employee queries

### Story
Super Admin Priya opens the Employees page and sees 150 employees in a paginated table. She filters by department "Engineering" and finds a team of 12. She clicks "Add Employee" to onboard a new developer: fills in name, email, department, designation, role (employee), and shift. The server auto-creates the User account (with auto-generated password), identity record, and employment profile. The new employee appears in the directory immediately. Priya then clicks on an existing employee to view their full detail page — she sees attendance for the last 30 days, pending leaves, assigned assets (a laptop), uploaded documents (offer letter), and recent payslips.

---

## 4. Attendance Module

### Behaviour
The attendance module manages daily clock-in/out, break and lunch tracking, work progress logging linked to tasks, regularization requests for missed punches, and auto-logout for forgotten clock-outs. It handles overnight shifts that cross midnight through shift-aware date computation.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | self | dept | team | self | self | self |

### Flow

**Page Load:**
1. `GET /api/attendance?date=<today>&scope=my` — user's own today record (determines if clocked in/out)
2. `GET /api/attendance?scope=team&date=<today>` — team attendance for today (managers)
3. `GET /api/attendance?scope=team&date=<yesterday>` — team attendance for yesterday
4. `GET /api/employees` — employee list for team view (admins)
5. `GET /api/attendance/regularize?scope=approvals|my` — regularization requests
6. `GET /api/attendance/available-tasks` — user's assigned tasks for work progress sheet
7. `GET /api/settings?type=shifts` — shift definitions for shift-aware date

**Clock In/Out Flow (POST /api/attendance/clock):**
1. Sends `{ action: 'in' | 'out' }`
2. Server uses shift-aware date computation — for overnight shifts (e.g., 10PM-6AM), the "day" belongs to the shift's start date
3. Clock-in creates an Attendance record with `{userId, date, clockIn, status:'present'}`
4. Clock-out sets `clockOut`, computes `hoursWorked`, determines late flag based on shift end time
5. Returns updated record with server timestamp

**Break/Lunch Tracking:**
- Breaks are tracked as `[{type: 'break'|'lunch', start, end}]`
- Break allowance: 30min, Lunch allowance: 60min
- Excess break/lunch time is deducted from `hoursWorked`
- Persisted via `PUT /api/attendance` with `{breaks, workProgress, baseHoursWorked, hoursWorked, breakDeduction}`

**Work Progress Sheet:**
- Embedded table in clock-in view where each row represents a time slice
- Fields: task selector (from available-tasks), start time, end time, status, remarks
- Task selector shows `[ProjectName] TaskName` format
- Each row can be linked to a specific task via taskDetails
- CSV download available after clock-out

**Regularization Flow:**
- Employee submits `POST /api/attendance/regularize` with `{date, requestedIn, requestedOut, reason}`
- Admin reviews and approves/rejects via `PUT /api/attendance/regularize` with `{id, action}`
- On approval, the attendance record is updated with the requested times

**Auto-Logout Flow:**
- Cron job calls `POST /api/attendance/auto-logout` — finds all users still clocked in after shift end + 30min grace period
- Creates auto-clock-out with `autoLoggedOut: true`
- On next login, user sees prompt to provide late-logout reason
- `POST /api/attendance/late-logout-reason` saves the reason

### Story
Employee Rajesh arrives at 9 AM and clicks "Clock In". The system records his clock-in at 09:05 (marked as late since his Morning shift starts at 9 AM). During the day, he takes a 30-minute lunch break and tracks it with the break button. He logs his work progress — 2 hours on "Project Alpha — Dashboard UI", 1 hour on "Bug Fix — Login Validation". At 6 PM, he clicks "Clock Out". The system calculates 8.5 hours worked minus 0.5 hours break = 8 hours. Rajesh forgets to clock out one day — the auto-logout cron detects his open session at 6:30 PM and auto-clocks him out. The next day, he sees a prompt asking for the reason for his late logout.

---

## 5. Leave Module

### Behaviour
The leave module handles employee leave applications with a multi-tier approval workflow. Employees apply for leave, their request flows through admin → team_admin/team_lead for approval or objection, and the balance is tracked per leave type. SMEs have a simplified single-stage approval directly by super_admin.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | self | dept | team | self | self | self |

### Flow

**Page Load:**
1. `GET /api/leave?scope=my` — user's own leave requests
2. `GET /api/leave?scope=all` — all leave requests (admins)
3. `GET /api/leave?scope=approvals` — leaves pending the current user's approval
4. `GET /api/employees` — employee list for admin employee selector
5. `GET /api/leave?scope=my&userId=X` — specific employee's leaves (super_admin)

**Balance Display:**
Four leave types with pre-defined totals:
- Casual Leave: 12 days
- Sick Leave: 10 days
- Earned Leave: 15 days
- Maternity Leave: 3 days

Balance = `total - sum(approved leaves of that type)` — computed client-side

**Leave Application (POST /api/leave):**
1. Validates `{type, from, to, reason}`
2. SME-specific validation: checks contract end date, active status, sets smeId
3. Creates Leave document with `status:'pending', adminApproval:'pending'`
4. For SME leaves: skip multi-level chain, direct to super_admin
5. Affects leave balance on approval

**Multi-Tier Approval Chain (PUT /api/leave/[id]):**
Actions: `approved`, `rejected`, `held`

- **Step 1 — Admin:** First to act on the leave. Sets `adminApproval` and `adminApprovedBy`. If approved, the leave moves to step 2.
- **Step 2a — Team Admin:** Can raise objection by holding or rejecting. `teamAdminApproval` field.
- **Step 2b — Team Lead:** Can raise objection by holding or rejecting. `tlApproval` field.
- **Override:** If team_admin or team_lead objected, admin can override with "Override Approve" or "Reject"
- **Hold:** Requires a `holdReason` which is visible to the admin
- **SME Leaves:** Simplified — only super_admin can act, no multi-level chain, no balance deduction

**Status Resolution:**
- `status` reflects the overall resolved state after all approval steps
- Leave balances are decremented when status changes to 'approved'
- Held leaves remain in a pending-like state

**Cancellation (DELETE /api/leave/[id]):**
- Employee can cancel their own pending leave
- Restores leave balance if leave was already approved

**SME View (Simplified):**
- SMEs see only "My Leaves" tab — no balance summary cards, no approval tables
- Simplified table: Type, From, To, Days, Reason, Status
- Apply modal shows info text explaining single-stage approval by Super Admin

### Story
Employee Rajesh wants to take 2 days of Casual Leave. He opens the Leave page, sees his balance (12 CL remaining), and clicks "Apply Leave". He selects Casual Leave, dates 25-26 June, types his reason, and submits. His admin, Priya, sees the leave in her approvals tab. She approves it. The leave then appears in Rajesh's team lead's queue for step 2. The team lead holds it asking for more details. Priya sees the hold reason, overrides it, and fully approves the leave. Rajesh gets a notification that his leave is approved.

---

## 6. Payroll Module

### Behaviour
The payroll module processes monthly payroll for all active employees with salary structures. It manages salary structure components (earnings and deductions), runs payroll calculations, handles the approval workflow (draft → approved → finalized), and provides payslip generation for employees.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | limited | false | false | false | self | false | self |

### Flow

**Page Load:**
1. `GET /api/payroll?month=YYYY-MM` — payroll records for selected month
2. `GET /api/payroll/structure` — all salary structures (admin) or own (employee)
3. `GET /api/employees` — employee list for structure management

**Salary Structure Management (GET/POST /api/payroll/structure):**
- One salary structure per user (unique userId constraint)
- **Earnings:** DA (Dearness Allowance), HRA (House Rent Allowance), CA (Conveyance Allowance), Medical, Bonus
- **Deductions:** EPFO, ESI, Professional Tax, LOP (Loss of Pay), Loan
- Total earnings = `da + hra + ca + medical + bonus`
- Total deductions = `epfo + esi + professionalTax + lop + loan`

**Payroll Run (POST /api/payroll/run):**
1. Admin selects a month and clicks "Run Payroll"
2. Client warns if active employees are missing salary structures
3. Server processes payroll for all active employees with salary structures
4. Creates Payroll records with status 'draft' for each employee
5. Computes: grossPay, totalDeductions, netPay, presentDays, lopDays, cycleLabel

**Payroll Approval Flow:**
- **Approve (draft → approved):** `POST /api/payroll/approve` with `{month, action: 'approve'}`
- **Finalize (approved → finalized):** `POST /api/payroll/approve` with `{month, action: 'finalize'}`
- Approval is month-wide (all employees for that month are transitioned together)

**Payslip Viewing:**
- Two tabs: "Payroll Register" (admin table) and "My Payslip" (employee)
- Payslip modal shows: month, all earnings components, all deductions, grossPay, netPay, presentDays, lopDays
- Printable via a new window with formatted HTML

**Payroll Cycle Configuration:**
- Default cycle: 26th of previous month to 25th of current month
- Configurable via Settings (payrollStartDay, payrollEndDay)
- Cycle readiness check: current date must be past the configured payroll end day

### Story
On the 26th of June, Admin Priya opens the Payroll page, selects "May 2026", and clicks "Run Payroll". The system processes all 150 employees with salary structures. She sees 3 employees without structures and asks HR to set those up. After fixing, she runs payroll again. The register shows all employees with their gross pay, deductions, and net pay. She clicks "Approve" to move all records from draft to approved. Later, after final review, she clicks "Finalize" to lock the payroll. Employee Rajesh logs in, opens My Payslip, and sees his May payslip showing ₹45,000 net pay.

---

## 7. Tasks Module

### Behaviour
The tasks module provides Kanban-style task management with three views (board, list, projects). Tasks are linked to projects and assigned to employees based on department match. The module enforces strict validation rules (alphanumeric titles, due dates within project range) and provides real-time status transitions via drag-and-drop.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | limited | dept | team | assigned | assigned | assigned |

### Flow

**Page Load:**
1. `GET /api/tasks` — all tasks (scoped by role)
2. `GET /api/projects` — all projects
3. `GET /api/settings?type=departments` — department list for project filters
4. `GET /api/employees` — employee list for task assignment

**Project Filtering:**
- `visibleProjects` — projects that have tasks assigned to the current user (or all for admins)
- Dropdown filter controls which project's tasks are shown

**Task Creation (POST /api/tasks):**
1. Admin selects a project → assignee dropdown filters to employees whose department matches `project.departments`
2. Validates: title max 30 chars, alphanumeric only, due date within project start-end range
3. Creates task with `{title, description, projectId, assignedTo, assignedBy, priority, status:'To Do', due}`

**Three Views:**
- **Kanban Board:** Columns for To Do, In Progress, Completed, Blocked — drag cards to change status
- **List View:** Table with all tasks, sortable by columns
- **Projects View:** Card-based project display with associated tasks

**Task Status Update (PUT /api/tasks/[id]):**
- Drag-and-drop triggers `PUT /api/tasks/[id]` with `{status: newStatus}`
- Client optimistically updates local state for instant UI feedback
- Full edit also supports changing title, description, project, assignee, priority, due date

**Employee Work Progress Integration:**
- Tasks appear in the attendance work progress picker
- GET /api/attendance/available-tasks returns user's assigned tasks for clock-in

### Story
Admin Priya creates a new project "Website Redesign" with department "Engineering" and team members Rajesh, Vikram, and Anita. She then creates tasks: "Design Homepage" (assigned to Rajesh, high priority, due in 2 weeks), "Setup CI/CD" (assigned to Vikram, medium priority, due in 1 week), "User Testing" (assigned to Anita, low priority, due in 3 weeks). Rajesh opens his Tasks page, sees the Kanban board with 3 tasks in "To Do". He drags "Design Homepage" to "In Progress" as he starts working. When done, he drags it to "Completed".

---

## 8. Projects Module

### Behaviour
Manages project definitions with team assignment, department scoping, date ranges, progress tracking, and document attachments.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | view | dept | team | assigned | assigned | assigned |

### Flow

**Page Load:**
- `GET /api/projects` — all projects (scoped by role)

**Project CRUD:**
- `POST /api/projects` — create with `{name, description, team[], departments[], startDate, endDate}`
- Progress computed from associated task completion

**Project Documents:**
- `GET /api/projects/documents?projectId=X` — list documents for a project
- `POST /api/projects/documents` — upload a document (calls POST /api/upload for file storage)
- `DELETE /api/projects/documents/[id]` — remove a document

**Integration with Tasks:**
- Tasks belong to projects via `Task.projectId → Project`
- Assignee selection in task creation is filtered by project's departments array
- Due date validation ensures tasks fall within project's date range

### Story
Priya creates "Mobile App v2" project with department "Engineering", team members assigned, start date June 1, end date August 31. She uploads the PRD document and design mockups as project documents. Engineers start creating tasks under this project.

---

## 9. Performance Module

### Behaviour
Manages employee performance reviews and goals. Supports multi-source scoring (self, peer, manager) for reviews and KPI tracking for goals.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | limited | dept | team | self | limited | false |

### Flow

**Reviews (GET/POST /api/performance/reviews):**
- `GET /api/performance/reviews` — list reviews (scoped: admins all, managers dept/team, employees self)
- `POST /api/performance/reviews` — create review with `{userId, cycle, projectId, taskId, selfScore, selfComment, peerScore, peerComment, managerScore, managerComment, managerBy}`
- Statuses: `pending, in_review, completed, improvement_plan`
- Overall score computed from individual scores

**Goals (GET/POST /api/performance/goals, PUT /api/performance/goals/[id]):**
- `GET /api/performance/goals` — list goals
- `POST /api/performance/goals` — create with `{userId, title, kpi, target, progress, status, cycle}`
- `PUT /api/performance/goals/[id]` — update progress or status
- Goal statuses: `in_progress, achieved, missed`

### Story
At the end of the quarter, Priya creates performance reviews for her team. Employee Rajesh submits his self-assessment. His peer provides feedback. Priya adds her manager score and mark the review as completed. Meanwhile, Rajesh sets a goal "Complete 20 tasks this quarter" with progress tracking at 60%.

---

## 10. Recruitment Module

### Behaviour
Manages the full recruitment lifecycle: job posting creation with detailed requirements, applicant tracking through the pipeline (Applied → Screening → Interview → Offer → Hired/Rejected), and duplicate applicant detection.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | full | false | false | false | false | false |

### Flow

**Job Postings (GET/POST/PUT/DELETE /api/recruitment/jobs):**
- Full schema: title, department, designation, type (Full-time/Part-time/Contract/Intern), employment mode (Remote/Hybrid/Onsite), location, openings, status (draft/active/paused/closed/archived)
- Experience level, qualifications, required/preferred skills, description
- Salary: type (fixed/range/not_disclosed), fixed/min/max, currency (INR/USD/EUR/GBP), period (monthly/annual)
- Benefits, hiring manager, recruiter, application deadline, interview rounds
- Screening questions: `{question, type (text/yes_no/multiple_choice), options[], required}`
- Internal/External flag, auto-close option, published timestamp

**Applicants (GET/POST/PUT /api/recruitment/applicants):**
- Stage pipeline: Applied → Screening → Interview → Offer → Hired → Rejected
- Duplicate detection: matches by email hash on previous rejections
- Rejection tracking: reason, timestamp, rejectedBy, previous rejection history
- Onboarding: Hired stage links to `onboardedEmployeeId` → creates employee record

### Story
Recruiter Rahul opens the Recruitment page, creates a new job posting "Senior React Developer" with required skills (React, TypeScript, Next.js), preferred skills (GraphQL, MongoDB), salary range ₹15-25 LPA, and 3 interview rounds. The job goes active. Applicants start applying — Rahul reviews each one, moves them through the pipeline. He rejects a duplicate applicant (email already rejected last month for the same role). One applicant reaches the "Hired" stage, triggering employee onboarding.

---

## 11. Finance Module

### Behaviour
Manages company financial operations: client invoices, employee expense claims with department budget tracking, and departmental budget allocation.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | limited | false | false | false | false | false | false |

### Flow

**Invoices (GET/POST /api/finance/invoices):**
- Unique auto-generated invoice numbers
- Status flow: draft → sent → pending → paid → overdue
- Client name, amount, issue date, due date
- Tracked by createdBy

**Expenses (GET/POST/PUT /api/finance/expenses):**
- Employees submit expenses with category, amount, date, description
- Status: pending → approved/rejected
- Budget tracking: department budgets prevent overspending
- `PUT /api/finance/expenses` updates status with approvedBy

**Budgets (GET/POST /api/finance/budgets):**
- Department-level annual budget allocation
- Tracked: allocated vs spent

### Story
Admin Priya creates an invoice to client "Acme Corp" for ₹5,00,000. She submits an expense claim for ₹2,500 (travel to client site). The finance manager approves it. The budget for Engineering department shows ₹50,000 allocated, ₹12,000 spent this quarter.

---

## 12. Inventory Module

### Behaviour
Manages company assets (assigned to employees) and stock items (consumables with reorder levels).

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | false | dept | team | false | false | false |

### Flow

**Assets (GET/POST/PUT /api/inventory):**
- Unique asset IDs (e.g., asset tags)
- Categories: predefined via Settings
- Assigned to specific employees with assignment date
- Status: assigned, available, maintenance
- Condition: good, fair, repair
- Monetary value tracked

**Stock (GET/POST/PUT /api/inventory):**
- Items with quantity tracking
- Reorder level alerts (stock < reorderAt)
- Unit of measure

### Story
IT Admin assigns a new laptop (Asset ID: AST-2026-042) to employee Rajesh. The laptop was in "available" status and now changes to "assigned". The stock monitor shows "Printer Toner" has 2 units left, below the reorder level of 5, triggering a reorder alert.

---

## 13. Documents Module

### Behaviour
Manages document uploads and access control. Documents can be categorized and restricted by access level (all, admin, employee) or linked to specific employees.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | limited | dept | team | self | limited | false |

### Flow

**Document Management:**
- `GET /api/documents` — list documents (scoped by access level + role)
- `POST /api/documents` — upload with `{name, category, fileUrl, fileSize, fileType, access, employeeId, expiry, version}`
- Categories: Policy, Employee, Contract, HR, Other
- Access levels: all, admin, employee
- Employee-linked documents appear in employee detail view
- Version tracking for document updates

### Story
HR uploads the company's "Employee Handbook 2026" (category: Policy, access: all). All employees can see it. They also upload Rajesh's updated contract (category: Contract, access: admin, linked to Rajesh's employee record). Only admins can view it from Rajesh's detail page.

---

## 14. Settings Module

### Behaviour
Central configuration hub for the entire HRMS. Manages 9 types of configuration: global settings, departments, SME expertise, roles, designations, asset categories, shifts, holidays, and notification rules.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | limited | false | false | false | false | false | false |

### Flow

**Page Load:**
- `GET /api/settings?type=config` — global configuration (timezone, currency, dateFormat, language, payroll cycle, late login threshold, saturday working policy)
- Type-specific calls as user navigates tabs

**Configuration Types (9 tabs):**

1. **General** — Global config via `SystemConfig` key `global_config`: timezone (default Asia/Kolkata), currency (default INR), date format (default DD/MM/YYYY), language (default English), payroll cycle start/end day, late login threshold minutes, Saturday working policy

2. **Departments** — Department CRUD: name, head. Used as dropdown in Employee forms, SME forms, Core HR forms, Project department arrays

3. **Expertise** — `SmeExpertise` model: name. Used as chip selector in SME Add/Edit form

4. **Roles** — Role name + description. Custom role definitions

5. **Designations** — Designation name + department + description. Used in Employee and Core HR forms

6. **Asset Categories** — Category name + description. Used in Inventory module

7. **Shifts** — Shift name + startTime + endTime + days array. Used in Attendance (clock-in time validation, shift-aware date), Employee shift assignment

8. **Holidays** — Holiday name + date + type (National/Optional/Company). Saturday generator auto-creates 1st/3rd Saturday holidays

9. **Notifications** — Toggle rules for: Late Login, Absence, Leave Approval, Payslip Generated, Task Overdue, Document Expiry, Performance Review

**CRUD Pattern:**
All types use the same generic endpoint differentiated by `type` query parameter:
- `GET /api/settings?type=X` — list all
- `POST /api/settings` — create with `{type, name, ...fields}`
- `PUT /api/settings` — update with `{type, _id, ...fields}`
- `DELETE /api/settings` — delete with `{type, _id}`

**Saturday Generator:**
- `POST /api/settings/generate-saturdays` — auto-creates 1st and 3rd Saturday of each month as holidays for a given year

### Story
Super Admin Priya opens Settings. She adds a new department "Data Science" and creates a new shift "Night (10PM-6AM)". She configures the payroll cycle to run from the 26th to the 25th. She sets the timezone to Asia/Kolkata and turns off Saturday working. She adds SME expertise options like "Machine Learning", "Data Engineering" for the SME module.

---

## 15. Core HR Module

### Behaviour
The Core HR module is the heart of the employment record system, implementing a tripartite data architecture that separates authentication (User), legal identity (UsrIdentity), and employment profile (EmpProfile). It manages the full employment lifecycle from onboarding through separation, including lifecycle transitions, offboarding clearance, and data archival.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | view | dept | team | false | false | false |

### Flow

**Tripartite Architecture:**
```
User (auth credentials)
  ├── identityId ──→ UsrIdentity (legal PII)
  │     ├── legalName, preferredName, displayName
  │     ├── primaryEmail, personalPhone
  │     ├── dateOfBirth, gender, maritalStatus, nationality, bloodGroup
  │     ├── identifiers: {pan: {encrypted, hashed, masked}, aadhaar: {...}}
  │     ├── addressHistory[]: {addressType, line1, city, state, country, postalCode, isCurrent}
  │     └── emergencyContacts[]: {name, relation, phone, email, isPrimary}
  │
  └── profileId ──→ EmpProfile (employment record)
        ├── employeeNumber (auto-gen: CHC-{year}-{seq})
        ├── employmentType, employmentStatus
        ├── department, designation, businessUnit, workLocation, shift
        ├── hireDate, probation dates, confirmationDate, rehireCount
        ├── reportingLine: {managerIdentityId, teamLeadIdentityId, teamAdminIdentityId}
        ├── compensationSnapshot: {currency, grade, payGroup, band}
        └── separation: {type, reason, lastWorkingDate, settlementStatus, clearanceChecklist}
```

**Page Load:**
- `GET /api/core/profiles?limit=200` — employment profiles directory with embedded identity info
- Shows unified view: legal name (from identity), employee number, department, designation, employment status, hire date
- Clicking a profile row navigates to `/core-hr/{profileId}`

**Profile Detail View:**
- `GET /api/core/profiles/[id]` — full profile with identity details
- Shows: identity info, employment profile, lifecycle history
- Lifecycle transitions available via action buttons

**Lifecycle Transitions (POST /api/core/lifecycle/transition):**

1. **Confirm Probation** — Sets `employmentStatus` from 'probation' to 'active', records confirmationDate
2. **Transfer** — Updates department, designation, shift on EmpProfile + User
3. **Promotion** — Updates designation, records promotion in lifecycle history
4. **Rehire** — Changes status from 'alumni' to 'rehired', increments rehireCount
5. **Suspend** — Sets status to 'suspended' with reason and suspensionUntil
6. **Separation** — Sets status based on type (resigned/terminated/retired), triggers offboarding

**Identity CRUD:**
- `GET /api/core/identities` — list all identities
- `POST /api/core/identities` — create with identity fields (auto-generates identityCode)
- `GET /api/core/identities/[id]` — single identity with sensitive fields (masked)
- `PUT /api/core/identities/[id]` — update identity fields
- Sensitive identifiers (PAN, Aadhaar) are encrypted at rest, returned masked, require admin role

**Offboarding Clearance:**
- `PATCH /api/core/profiles/clearance` — updates 6 clearance checklist items:
  - Asset Returned, Access Revoked, Final Settlement, Exit Interview Done, NOC Issued, Relieving Letter
- All must be `true` before separation is finalized

**Lifecycle History:**
- `GET /api/core/lifecycle` — query history by identity/profile/event type
- `POST /api/core/lifecycle` — create history events (internal use)
- Records: entity type, event type, from→to states, changes array (field, old value, new value), actor, IP, requestId

**Data Archival:**
- `GET /api/core/archive?olderThanYears=N` — preview: count + candidate profiles for archival
- `POST /api/core/archive` — execute archival: changes employment status to 'alumni'
- Super_admin only

**Self-Service Request Review:**
- `GET /api/core/self-service-requests?status=pending` — pending requests for approval
- Admin reviews requests (profile_update, address_update, emergency_contact_update, resignation)
- Approve: applies changes to UsrIdentity/EmpProfile
- Reject: records rejection reason

### Story
Priya opens Core HR and sees the employment directory — 150 active employees. She clicks on Rajesh's profile. His identity shows full legal name, DOB, masked PAN (ABCXXXX123F), current address, and emergency contacts. His employment profile shows employee number "CHC-2026-042", Engineering department, Senior Developer designation, reporting to Vikram (Team Lead). She performs a "Transfer" to move him to the new "Data Science" department. Later, Rajesh submits a resignation via self-service. Priya reviews it, processes his offboarding by clearing the 6 clearance items, and finalizes his separation. His record is preserved for archival after the configured retention period.

---

## 16. Self-Service Module

### Behaviour
Allows employees to manage their own profile information (name, phone, addresses, emergency contacts) and submit resignation requests. Changes go through an admin review workflow. SME users are redirected to their dedicated SME profile page.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | self | self | self | self | self | self |

### Flow

**Page Load:**
1. If user role is `sme`: calls `GET /api/sme/me`, redirects to `/sme/{sme._id}`
2. Otherwise: `GET /api/self-service/me` returns `{identity, profile, requests}`
   - `identity` — current snapshot (name, email, phone, address, emergency contacts)
   - `profile` — employment details
   - `requests` — request history with statuses

**Request Types:**

1. **profile_update:** Fields: preferredName, personalPhone, secondaryPhone
2. **address_update:** Fields: addressHistory array with addressType, line1, line2, city, state, country, postalCode, landmark, isCurrent
3. **emergency_contact_update:** Fields: emergencyContacts array with name, relation, phone, email, isPrimary
4. **resignation:** Fields: noticePeriodDays, lastWorkingDate, settlementStatus, exitInterviewComplete

**Submission Flow:**
1. Client-side validation (character limits, regex, required fields)
2. `POST /api/self-service/requests` with `{requestType, reason, payload}`
3. Request created with `status: 'pending'`
4. Request list refreshes showing the new pending entry
5. Employee can edit or cancel pending requests: `PUT/DELETE /api/self-service/requests/[id]`

**Admin Review Flow (on /core-hr/requests page):**
1. Admins see requests filtered by status: pending/approved/rejected
2. `GET /api/core/self-service-requests?status={status}` returns array
3. Selecting a request shows employee info + requested changes
4. Approve: `PUT /api/core/self-service-requests` with `{id, action: 'approved', reviewNote}`
5. Reject: with `{id, action: 'rejected', reviewNote}`
6. Sidebar polls every 30 seconds for pending requests count (badge on "HR Requests" nav item)

### Story
Employee Rajesh moves to a new apartment. He opens Self-Service, selects "Update Address", fills in his new address (line1, city, state, pincode), adds a reason "Moved to new apartment", and submits. The request appears in Admin Priya's "HR Requests" queue with a red badge showing 1 pending. Priya reviews the change, confirms it's correct, and approves it. Rajesh's identity record is updated with the new address.

---

## 17. SME Module

### Behaviour
Manages Subject Matter Experts (SMEs) — freelance experts contracted for limited engagements. Provides separate portal with SME management (CRUD), monitoring (work progress + leave management), and simplified leave workflow. Super_admin only access.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | false | false | false | false | false | false | false |

### Flow

**Page Load (GET /api/sme):**
1. Returns all SMEs sorted by createdAt desc, populated with userId (name, email, role, status)
2. Also loads `GET /api/settings?type=departments` and `GET /api/settings?type=sme_expertise` for form options

**Four Tabs:**

**Tab 1 — All SMEs:**
- Table view: Name (linked to /sme/{id}), Email, Expertise (badge chips), Rate (₹amount/type), Contract dates, Status badge, Actions (Edit button)
- "Add SME" button at top right opens modal

**Add/Edit SME Modal:**
- Sections: Personal Information (Full Name, Email, Password auto-gen, DOB, Phone, PAN), Expertise (chip selector from dynamic options + custom tag input), Departments (chip selector from dynamic options + custom tag input), Account Details (Bank Name, Account Holder, Account Number, IFSC), Contract & Rate (Rate Amount ₹, Rate Type, Status, Contract Start/End)
- Expertise and Departments use tag-input UI: clickable chips + inline text input with Enter-to-add
- On create (POST /api/sme): creates User (role=sme, password auto-generated) + SME record, returns generated credentials in a modal
- On edit (PUT /api/sme): updates SME record, syncs name back to User
- Status dropdown updates `form.status` which is included in PUT payload → persists to database

**SME Profile Page (/sme/[id]):**
- Shows SME details: name, email, phone, DOB, PAN, expertise, departments, rate, contract dates, status
- "Request Leave" button (visible only when SME views own profile)
- Leave request modal: type, from/to dates, reason — creates leave via POST /api/leave with smeId

**Tab 2 — Monitoring:**
- Left sidebar: list of all SMEs with initials, name, task count, status dot (green/grey)
- Right panel (selected SME): SME header with status badge, 4 summary cards (Total/To Do/In Progress/Completed), blocked task alert, pending leave requests for that SME with approve/reject buttons, tasks grouped by dates with expand/collapse

**Tab 3 — Work Progress:**
- Level 1: SME list with task count and completion percentage
- Level 2 (click SME): SME header with back button, tasks grouped by due date, each date expandable to show task table (Task, Project, Priority, Status)

**Tab 4 — Leave Requests:**
- Filter bar: search by SME name, leave type dropdown, from/to date range, Clear button
- Status filter tabs with counts: All, Pending, Approved, Rejected, Held — color-coded
- Table: SME (avatar+name), Type, From, To, Days, Reason, Status (with icon), Actions (Approve/Reject for pending/held)
- Data from GET /api/leave?scope=all&smeOnly=true

**Data Integration:**
- SME leaves are loaded from the same endpoint as monitoring leaves
- Tasks are fetched from GET /api/leave?scope=all&smeOnly=true (note: tasks for progress views come from /api/tasks)
- Leaves for monitoring sidebar are filtered client-side by `userId?._id === sme.userId`

### Story
Super Admin Priya opens the SME Portal. She clicks "Add SME" to onboard a Machine Learning expert, Dr. Sharma. She fills in his details, selects expertise (Machine Learning, Deep Learning), assigns departments (Engineering, Data Science), enters his rate (₹2,000/hour), and sets a 3-month contract. The system generates login credentials. Dr. Sharma logs in, sees only Dashboard, Attendance, Calendar, Payroll, Tasks, and Leave in his sidebar. He visits his profile page and requests 2 days of sick leave. Priya sees the pending leave in the Monitoring tab's leave section or in the Leave Requests tab, and approves it.

---

## 18. Audit Module

### Behaviour
Captures a comprehensive audit trail of all system activities. Every sensitive operation across all modules logs to AuditLog. The audit page provides querying by module, severity, user, date range. Page views and custom actions are also logged.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | view | false | false | false | false | false | false |

### Flow

**Page Load:**
- `GET /api/audit` — query with filters: module, severity (low/medium/high), userId, date range

**Logging Patterns:**
1. **Action Logging:** `AuditLog.create({action, module, userId, targetUserId, details, severity, ip})` — used in login, employee CRUD, leave actions, payroll processing, lifecycle transitions, settings changes, etc.
2. **Page View Logging:** `POST /api/audit/page-view` — deduplicated per user per module per session
3. **Custom Action Logging:** `POST /api/audit/action` — for ad-hoc auditable events

**Severity Levels:**
- `low` — standard operations (login success, page views, routine updates)
- `medium` — suspicious activity (failed login attempts, rate limit exceeded, account locked)
- `high` — critical security events (JWT tampering, unauthorized access attempts, blacklisted token usage)

### Story
After a security review, Priya opens the Audit Log page. She filters by module "Auth" and severity "medium" to review failed login attempts. She sees 3 failed attempts from IP 192.168.1.100 in the last hour. She investigates whether this is a brute-force attempt.

---

## 19. Reports Module

### Behaviour
Generates downloadable reports for attendance, leave, payroll, tasks, and lifecycle data.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | limited | dept | team | self | false | false |

### Flow

**Report Generation (GET /api/reports):**
- Query param: `type` (attendance, leave, payroll, tasks, lifecycle)
- Admin: sees all data, scoped by role
- Employee: sees self-only data
- Returns formatted report data for export/display

### Story
Priya needs end-of-month attendance data. She opens Reports, selects "Attendance Report", picks June 2026, and exports the data showing present/absent/late for every employee.

---

## 20. Notifications Module

### Behaviour
In-app notification system that provides real-time alerts for leave approvals, attendance issues, payroll events, lifecycle changes, and self-service updates. Polled by the topbar and sidebar.

### Scope
All authenticated users (role-scoped by notification targeting)

### Flow

**Notification Types:**
- `leave` — leave approved/rejected/held/override
- `attendance` — auto-logout, regularization status
- `general` — system announcements
- `lifecycle` — profile/identity updates, probation confirmation
- `self_service` — request approved/rejected
- `payroll` — payslip generated, payroll finalized
- `viewing` — someone viewed your profile

**API Endpoints:**
- `GET /api/notifications` — list user's notifications (sorted by most recent)
- `POST /api/notifications` — create (system use, not user-facing)
- `PATCH /api/notifications` — mark as read

**Polling:**
- Topbar polls `GET /api/notifications` every 30 seconds
- Shows dropdown with unread count badge
- Clicking a notification navigates to relevant page
- Sidebar polls `GET /api/core/self-service-requests?status=pending` every 30 seconds for HR badge count

### Story
When Priya approves Rajesh's leave, the Notify helper creates a Notification for Rajesh: `{userId: Rajesh._id, title: "Leave Approved", message: "Your Casual Leave (25-26 Jun) has been approved", type: "leave", refId: leaveId}`. Rajesh sees the red badge on his topbar bell icon, opens the dropdown, and clicks the notification to view his leave status.

---

## 21. Announcements Module

### Behaviour
Company-wide and department-targeted announcements with audience filtering, pin-to-top support, tagging, and like functionality.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | false | dept | team | view | view | false |

### Flow

**CRUD:**
- `POST /api/announcements` — create with `{title, body, audience, tag, tagColor, pinned, departments}`
- `GET /api/announcements` — list visible to user (filtered by audience + department match)
- `PUT /api/announcements/[id]` — like/unlike (toggles user ID in likes array)

**Display:**
- Dashboard shows announcements section
- Communication page shows full announcement feed
- Pinned announcements appear first
- Tag colors for visual distinction (e.g., blue for General, green for HR, red for Urgent)

### Story
Priya creates an announcement: "Office Closed for National Holiday" with tag "HR", tagColor green, audience "Company-wide". All employees see it on their Dashboard and in the Communication page. Rajesh reads it and clicks the like button.

---

## 22. Calendar Module

### Behaviour
Displays a month/week/day view calendar showing holidays, leaves, and attendance data. No dedicated API — reads from settings and leave/attendance.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | self | dept | team | self | self | self |

### Flow

**Page Load:**
- Renders calendar grid showing current month
- Day view available at `/calendar/day/[date]`
- Data sourced from: Holiday records (via settings), Leave records (team/self), Attendance records (present/absent markers)

### Story
Rajesh opens the Calendar to check upcoming holidays. He sees June 15 marked as "Company Holiday" and June 26 marked as his approved leave.

---

## 23. Monitoring Module

### Behaviour
System monitoring page — shows system health, auto-logout status, and operational metrics. No dedicated API; data is sourced from dashboard/audit/attendance modules.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | full | false | dept | team | false | false | false |

### Story
Priya checks the Monitoring page to see current system status: active sessions, auto-logout triggers that fired today, any anomalies in attendance patterns.

---

## 24. Invoicing Module

### Behaviour
Client invoicing module — separate from the Finance module's invoice functionality. Manages client billing workflows.

### Scope
| super_admin | admin_full | recruiter | team_lead | team_admin | employee | intern | sme |
|:-----------:|:----------:|:---------:|:---------:|:----------:|:--------:|:------:|:---:|
| full | limited | false | false | false | false | false | false |

### Story
Priya creates a client invoice for consulting services, tracks its payment status.

---

## 25. Profile Module

### Behaviour
User's own profile view. Non-admin users are redirected to their employee detail page. Admins see their own account details and activity log.

### Scope
All authenticated users

### Flow

1. Calls `GET /api/employees`, finds employee where `e.email === user.email`
2. Non-admin: `router.replace(/employees/${mine._id})` — redirects to employee detail (self-view)
3. Admin: Shows account details card (name, email, phone, role, department, designation, shift) + System Access card (role badge, last login, activity summary) + Activity Log tab (own audit logs via `GET /api/audit?userId=${user.id}`)

### Story
Rajesh clicks "My Profile" in the sidebar. The system finds his employee record by email and redirects him to `/employees/{hisId}`. He sees the same detail page an admin would see, but only his own data.

---

## 26. Health Module

### Behaviour
Simple health check endpoint that returns the MongoDB connection status.

### Scope
Public (no authentication required)

### Flow
- `GET /api/health` — returns `{status: 'ok', db: 'connected' | 'disconnected', timestamp}`

### Story
The devops monitoring system pings `/api/health` every minute to ensure the server is running and the database is connected.

---

## 27. Reminders Module

### Behaviour
Cron-triggered system that checks for approaching project end-dates and task due-dates, sending notifications to relevant users.

### Scope
System (called via cron job, not user-facing)

### Flow
1. `POST /api/reminders` — triggered by external cron job
2. Queries all Projects with endDate approaching within configurable threshold and `reminderSent: false`
3. Queries all Tasks with due date approaching and `reminderSent: false`
4. Creates Notification records for each project manager / task assignee
5. Marks `reminderSent: true` to prevent duplicate reminders

### Story
At 9 AM daily, a cron job calls `/api/reminders`. It finds Rajesh's task "Design Homepage" is due in 3 days. A notification is created: "Task 'Design Homepage' is due in 3 days. Please update the status."

---

## 28. Seed Module

### Behaviour
Initial setup and test data generation. The setup endpoint creates the initial super admin account. The test data endpoint creates comprehensive sample data for development/demo.

### Scope
Super admin only (setup-token protected for initial seed)

### Flow

**Setup Seed (POST /api/seed):**
1. Protected by `SETUP_TOKEN` environment variable
2. Creates the initial super admin user with credentials from env vars: `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
3. Sets `ENABLE_SEED_ROUTE=false` after successful seeding

**Test Data Seed (POST /api/seed/test-data):**
1. Creates sample employees with various roles (admin, team lead, employee, intern)
2. Creates attendance records, leave requests, payroll records, projects, tasks, announcements, etc.
3. Used for development, staging, and demo environments

### Story
On the first deployment, the setup process calls `POST /api/seed` which creates the initial super admin (superadmin@hrms.com). For the staging environment, the test data seeder populates the database with 50 sample employees, 3 months of attendance, leave requests in various states, and a full payroll cycle.

---

# SECTION B: Cross-Module Integration Flows

## Integration 1: Attendance ↔ Tasks

### Data Flow
The Attendance module's work progress sheet is directly linked to the Tasks module.

1. When an employee is clocked in, the attendance page fetches `GET /api/attendance/available-tasks`
2. This returns tasks assigned to the current user with status ≠ 'Completed'
3. The employee selects a task from a dropdown in each work progress row
4. The selected task populates the `taskDetails` field with `[ProjectName] TaskTitle` format
5. The attendance record stores `workProgress: [{type, taskDetails, startTime, endTime, status, remarks, feedback}]`
6. Work progress is persisted via `PUT /api/attendance`

### Models Involved
- `Attendance.workProgress[].taskDetails` — string reference (denormalized)
- `Task.assignedTo` — ObjectId → User (for available-tasks filtering)

### Behaviour & Scope
- **Employees/Interns/SMEs:** Can link tasks from their own assigned task list to their work progress
- **Admins/Managers:** Can see work progress with task links when viewing attendance or employee details
- **Export:** Work progress CSV download available after clock-out, includes task names

---

## Integration 2: Leave → Attendance (Login Gate)

### Data Flow
The Auth module's login route checks the Leave model to block login if the user is on approved leave.

1. On POST /api/auth/login, after password verification and status check:
2. Server queries `Leave.findOne({userId: user._id, status: 'approved', from: { $lte: today }, to: { $gte: today }})`
3. If a leave is found, login is rejected with 403: "You are on approved leave today ({type}). Please return on {to} to log in."
4. The attendance record for that day is automatically marked as 'leave' status

### Models Involved
- `Leave` — {userId, status, from, to, type}
- `User` — for authentication and status check

### Behaviour & Scope
- All roles: the gate applies universally to prevent clock-in during approved leave periods
- Prevents attendance marking conflicts (employee cannot be both "present" and "on leave")
- The leave-day gate is checked after password validation (to avoid information leakage)

---

## Integration 3: Payroll → Attendance

### Data Flow
The Payroll module uses Attendance data to compute Loss of Pay (LOP) deductions.

1. Payroll cycle: Configurable start/end days (default 26th-25th)
2. When payroll is run for a month, the system calculates:
   - `presentDays` = count of Attendance records with status 'present' in the cycle
   - `lopDays` = total working days in cycle - presentDays (minus leaves, holidays)
3. LOP deduction is calculated from the salary structure's daily rate
4. `lopDays` is stored in the Payroll record for the month

### Models Involved
- `Attendance` — {userId, date, status}
- `Payroll` — {userId, month, presentDays, lopDays}
- `SalaryStructure` — {userId, lop} — base LOP rate component

### Behaviour & Scope
- **Admins:** Run payroll which automatically pulls attendance data
- **Employees:** See their present days and LOP on their payslip
- Payroll cycle boundaries determine which attendance records map to which payroll month

---

## Integration 4: Core HR Tripartite

### Data Flow
The Core HR module implements a three-model architecture for complete separation of authentication, identity, and employment data.

1. **User (auth layer):** Handles login credentials, session management, role assignment, org hierarchy
   - `User.identityId → UsrIdentity` (optional 1:1 link)
   - `User.profileId → EmpProfile` (optional 1:1 link)

2. **UsrIdentity (PII layer):** Stores legal identity data with encrypted sensitive identifiers
   - `UsrIdentity.authUserId → User` (reverse link, unique sparse)
   - Contains: legal name, DOB, gender, PAN/Aadhaar (encrypted), address history, emergency contacts

3. **EmpProfile (employment layer):** Stores job-related data
   - `EmpProfile.identityId → UsrIdentity` (required 1:1 link)
   - Contains: employee number, department, designation, employment status, hire date, reporting line, compensation, separation details

4. **Lifecycle Transitions:** Update across layers:
   - Transfer: updates EmpProfile.department + EmpProfile.designation + User.department
   - Promotion: updates EmpProfile.designation
   - Separation: sets EmpProfile.employmentStatus, records EmpLifecycleHistory
   - Creates EmpLifecycleHistory events tracking all changes

### Models Involved
- `User` — auth credentials, role, basic contact, org hierarchy
- `UsrIdentity` — legal PII, identifiers (encrypted), addresses, emergency contacts
- `EmpProfile` — employment details, lifecycle status, reporting line, compensation, separation
- `EmpLifecycleHistory` — audit trail of all lifecycle changes

### Behaviour & Scope
- **Super_admin/Admin_full:** Full CRUD on all three layers
- **Team_lead/Team_admin:** Dept/team-scoped view only
- **Recruiter:** View only
- **Employees:** No direct access (changes go through Self-Service)
- The separation ensures PII can be encrypted independently of auth data
- Identity and profile records are retained for historical/archival purposes even after user deactivation

---

## Integration 5: Self-Service → Core HR

### Data Flow
Employee self-service requests flow through an admin review process before applying changes to Core HR records.

1. **Employee submits request:**
   - `POST /api/self-service/requests` with `{requestType, reason, payload}`
   - Request types: profile_update, address_update, emergency_contact_update, resignation
   - Creates SelfServiceRequest with `status: 'pending'`

2. **Admin reviews request:**
   - Sidebar polls `GET /api/core/self-service-requests?status=pending` every 30s
   - Admin opens review panel showing employee info + requested changes
   - Admin action: approve or reject with reviewNote

3. **On approval:**
   - Changes are applied to UsrIdentity (for profile/address/emergency updates)
   - For resignation: EmpProfile.separation fields are updated, lifecycle transition recorded
   - Notification sent to employee

4. **On rejection:**
   - Request marked as rejected with rejection reason
   - No changes to identity/profile

### Models Involved
- `SelfServiceRequest` — {identityId, profileId, requestType, payload, reason, status, reviewerUserId, reviewedAt, reviewNote}
- `UsrIdentity` — updated on approval of profile/address/emergency requests
- `EmpProfile` — updated on resignation approval

### Behaviour & Scope
- **Employees (all roles):** Can submit requests for their own data
- **Admins (super_admin, admin_full):** Review and approve/reject requests
- Changes require admin approval — no direct employee editing of official records
- Resignation requests trigger the offboarding process

---

## Integration 6: Recruitment → Core HR

### Data Flow
When a candidate reaches the "Hired" stage in recruitment, they can be onboarded into the Core HR system.

1. Applicant stage moves to "Hired" → status becomes eligible for onboarding
2. Onboarding creates:
   - `UsrIdentity` — from applicant data (name, email, phone, skills)
   - `EmpProfile` — employee number, department, designation, hire date
   - `User` — auth credentials, role assignment
3. The applicant's `onboardedEmployeeId` is linked to the new Employee record
4. A lifecycle history event records the onboarding

### Models Involved
- `Applicant` — {jobId, name, email, stage, onboardedEmployeeId}
- `UsrIdentity` — created during onboarding
- `EmpProfile` — created during onboarding
- `User` — created during onboarding

### Behaviour & Scope
- **Super_admin/Admin_full/Recruiter:** Can manage applicants through the pipeline
- **Recruiter:** Full recruitment access but cannot directly create employees (onboarding is the bridge)
- The onboarding flow ensures data consistency between hiring and HR records

---

## Integration 7: Employee Detail → 6+ Modules

### Data Flow
The employee detail page at `/employees/[id]` aggregates data from 6+ modules into a single unified view via `GET /api/employees/[id]/details`.

1. Server queries in parallel:
   - Employee record (User/Employee model)
   - UsrIdentity (PII, encrypted identifiers)
   - EmpProfile (employment details)
   - Leave records (recent)
   - Attendance records (last 30 days)
   - Asset assignments
   - Document uploads
   - Payroll/payslip history
   - AuditLog entries
   - Work progress (via separate call to `/api/employees/[id]/work-progress`)

2. Client renders tabs:
   - **Overview:** Role, department, shift, status, leave balance, skills, reporting chain
   - **Personal Info:** Full identity details, masked PAN/Aadhaar, address history, emergency contacts
   - **Attendance:** Leave balance card, leaves table, attendance history
   - **Work Progress:** Monthly cycle grouping, date-wise task progress, CSV download
   - **Assets & Docs:** Assigned assets, uploaded documents
   - **Payroll:** Payslip history table
   - **Audit Log:** Activity timeline

### Models Involved
- User, Employee, UsrIdentity, EmpProfile, Leave, Attendance, Asset, Document, Payroll, AuditLog, Task

### Behaviour & Scope
- **Super_admin/Admin_full:** Full access to all aggregated data
- **Team_lead/Team_admin:** Dept/team-scoped access
- **Employee/Intern:** Self-only (redirected from /profile)

---

## Integration 8: Tasks ↔ Projects

### Data Flow
Tasks and Projects have a parent-child relationship with bidirectional influence.

1. **Task → Project:** `Task.projectId → Project` — each task belongs to exactly one project

2. **Project → Task (department scoping):**
   - When creating a task, the assignee dropdown is filtered to employees whose `department` matches one of the project's `departments` array
   - `employees.filter(e => selectedProjectDepts.includes(e.department))`

3. **Date validation:**
   - Task due date must fall within `Project.startDate` to `Project.endDate` range

4. **Progress tracking:**
   - Project progress can be computed from the percentage of completed tasks
   - Project status (active/on_hold/completed) cascades task availability

5. **Documents:**
   - Project documents are stored in ProjectDocument model
   - Can be linked to a specific task via `taskId`

### Models Involved
- `Task` — {projectId → Project, assignedTo → User, due, status}
- `Project` — {name, team[], departments[], startDate, endDate, status}
- `ProjectDocument` — {projectId → Project, taskId → Task}

### Behaviour & Scope
- **All roles with task access:** Tasks are always scoped by project membership/department
- **Admins:** Can create/edit projects and all tasks
- **Team leads:** Project/task access within department
- **Employees:** See tasks assigned to them within their projects

---

## Integration 9: SME Tripartite

### Data Flow
SME (Subject Matter Expert) data is distributed across multiple models with cross-references.

1. **SME creation:** POST /api/sme creates:
   - `User` with `role: 'sme'` — authentication and sidebar access
   - `SME` record — freelance specific data (expertise, rate, contract, departments, account details)
   - `SME.userId → User` — reverse link

2. **Attendance:** `Attendance.smeId → SME` — tracks SME attendance separately

3. **Leave:** `Leave.smeId → SME` — identifies SME leave requests (simplified approval: skip multi-level chain, direct super_admin)

4. **Absence:** `Absence.smeId → SME` — absence tracking for SMEs

5. **Module Access:** SMEs have restricted module access (Dashboard, Attendance, Calendar, Payroll, Tasks, Projects, Leave — all at `self` or `assigned` level)

### Models Involved
- `SME` — {name, email, phone, dob, pan, expertise[], departments[], accountDetails, rate, contractStart, contractEnd, status, userId → User}
- `User` — {role:'sme', smeId → SME}
- `Attendance` — {smeId → SME}
- `Leave` — {smeId → SME}
- `Absence` — {smeId → SME}

### Behaviour & Scope
- **Super_admin only:** Full access to SME portal (CRUD, monitoring, leave management)
- **SMEs:** Self-service access to own profile, leave requests, attendance, tasks
- SME leave approval bypasses the standard multi-level chain → goes directly to super_admin
- SME attendance, leave, and absence are tracked separately from employee records

---

## Integration 10: Settings → All Modules

### Data Flow
The Settings module acts as a central configuration provider consumed by all other modules.

1. **Departments:** Used by Employees, SME, Projects, Core HR as form dropdown options
   - Employee form: department selector
   - SME form: multi-select chips
   - Project form: department array for team scoping
   - Core HR: employment profile department

2. **Designations:** Used by Employees, Core HR as form dropdown options
   - Employee form: designation selector
   - Core HR: designation field in profile

3. **Shifts:** Used by Attendance, Employees, Core HR
   - Attendance: shift-aware date computation, late threshold
   - Employee/Core HR: shift assignment

4. **SME Expertise:** Used by SME module exclusively
   - Expertise chip selector in SME Add/Edit form

5. **Holidays:** Used by Calendar, Attendance
   - Calendar: holiday display
   - Attendance: holiday status marking

6. **Global Config:** Affects date formatting, timezone, currency, language across all modules
   - Dashboard: date/time display
   - Payroll: cycle dates, currency symbol (₹)
   - Reports: date format, timezone

### Models Involved
- `Department`, `Designation`, `Shift`, `Holiday`, `SystemConfig`, `SmeExpertise`, `Role`, `AssetCategory`

### Behaviour & Scope
- **Super_admin:** Full CRUD on all settings
- **Admin_full:** Limited (can view and update but cannot delete)
- **All other roles:** No access — settings changes are admin-only

---

## Integration 11: Audit Log → All Modules

### Data Flow
Every sensitive operation across the entire system logs to AuditLog, creating a comprehensive audit trail.

1. **Common audit points:**
   - **Auth:** Login success/failure, rate limit exceeded, password change, token refresh
   - **Employees:** Create, update, delete employee records
   - **Leave:** Create leave, approve/reject/hold/override
   - **Payroll:** Run, approve, finalize payroll
   - **Attendance:** Regularize attendance
   - **Core HR:** Lifecycle transitions (probation, transfer, promotion, separation)
   - **Settings:** Configuration changes
   - **SME:** Create, update SME
   - **Self-Service:** Submit, approve, reject requests

2. **AuditLog schema:**
   - `action`, `module`, `userId`, `targetUserId`, `details`, `severity` (low/medium/high), `ip`, `createdAt`

3. **Querying:**
   - `GET /api/audit` with filters: module, severity, userId, date range
   - Dashboard uses last 5 AuditLog entries for "Recent Activity" timeline

### Models Involved
- `AuditLog` — universal audit table
- Every other module creates AuditLog entries

### Behaviour & Scope
- **Super_admin:** Full access — can query all audit logs
- **Admin_full:** View only
- **All other roles:** No access

---

## Integration 12: Notifications → All Modules

### Data Flow
The Notify helper creates Notification documents triggered by events across all modules.

1. **Notification triggers:**
   - **Leave:** Approved/rejected/held notification to leave applicant
   - **Attendance:** Auto-logout notification, regularization status update
   - **Payroll:** Payslip generated, payroll finalized notifications
   - **Lifecycle:** Profile/identity update notifications
   - **Self-Service:** Request approved/rejected notifications
   - **Tasks:** Task assignment notifications
   - **Reminders:** Upcoming deadlines (task due, project end)

2. **Display:**
   - Topbar: bell icon with unread count badge, dropdown list of notifications
   - Sidebar: badge count for pending HR requests
   - Clicking a notification navigates to relevant module

3. **Polling:**
   - Topbar polls every 30s: `GET /api/notifications`
   - Sidebar polls every 30s: `GET /api/core/self-service-requests?status=pending`

### Models Involved
- `Notification` — {userId, title, message, type, read, refId, createdAt}

### Behaviour & Scope
- All authenticated users receive notifications relevant to their role
- Notifications are non-critical (fire-and-forget) — system operates without them
- Unread notifications persist until manually marked read via PATCH

---

## Integration 13: Dashboard → 10+ Modules

### Data Flow
The dashboard aggregates data from 10+ modules into a single API call.

1. **GET /api/dashboard** server-side aggregation:
   - User.countDocuments (employee count)
   - Attendance.countDocuments (present today)
   - Leave.find (pending leaves)
   - Task.find (pending tasks)
   - Payroll.findOne (last payslip)
   - Job.find (open positions)
   - Announcement.find (active announcements)
   - AuditLog.find (recent activity)

2. **Role-based filtering:**
   - Admins: all metrics
   - Team leads: team-scoped metrics
   - Recruiters: recruitment-focused metrics
   - Employees: self-only metrics

3. **Result cached in a single response object:**
   - `{totalEmployees, presentToday, pendingLeaves, myPendingTasks, myAttendanceThisMonth, myLeaveBalance, lastPayslip, openJobs, recentActivity, announcements}`

### Models Involved
- User, Attendance, Leave, Task, Payroll, Job (JobPosting), Announcement, AuditLog

### Behaviour & Scope
- Every role sees a customized subset of dashboard KPIs
- Quick action buttons change by role
- Announcements section shows audience-targeted results

---

## Integration 14: Reminders → Tasks + Projects

### Data Flow
The cron-triggered reminders module checks approaching deadlines for projects and tasks.

1. `POST /api/reminders` (called by cron):
   - Finds all Projects where `endDate` is within threshold (e.g., 7 days) and `reminderSent: false`
   - Finds all Tasks where `due` is within threshold and `reminderSent: false`
   - Creates Notification records: "Task '{title}' is due in {days} days"
   - Marks `reminderSent: true` to prevent duplicates

2. Notifications appear in the recipients' topbar notification dropdown

### Models Involved
- `Project` — {endDate, reminderSent, createdBy}
- `Task` — {due, reminderSent, assignedTo}
- `Notification` — created for each task approaching deadline

### Behaviour & Scope
- System-triggered (cron job), not user-facing
- Prevents task/project deadline surprises
- One reminder per task/project (no repeats)

---

# SECTION C: RBAC Stories per Role POV

## Super Admin POV (Full Access — All 28 Modules)

### Morning Login

Priya (super_admin) opens the HRMS at http://localhost:3000. The login page immediately invalidates any previous session. She enters her email `priya@hrms.com` and password.

**Login Gate Checks:**
1. **Rate limiting:** Her IP has made 0 attempts in the last 15 minutes — allowed
2. **Email exists:** User found — proceeds
3. **Not locked:** Account not in lockout state
4. **Password match:** Verified successfully
5. **Account active:** Status is 'active'
6. **Leave-day gate:** No approved leave for today — allowed
7. **Hire-date gate:** Past join date — no restriction

She receives a JWT (valid 15 minutes) + refresh token (valid 7 days). The client stores these and redirects to `/dashboard`.

### Dashboard — Full Command Center

Priya sees 4 KPI cards:
- **150 Total Employees** — all active headcount
- **127 Present Today** — who clocked in (includes herself)
- **8 Pending Leaves** — needs her attention
- **12 Open Tasks** — her own tasks

The announcements section shows 3 pinned company notices. Recent activity timeline shows: "Leave Approved — Rajesh (Casual Leave)", "Employee Created — New Developer", "Payroll Finalized — May 2026".

Quick actions: Add Employee, Approve Leaves, Run Payroll, New Announcement.

### Employee Management — Full Workforce Control

Priya navigates to `/employees`. The table shows all 150 employees. She filters by department "Engineering" — 12 employees. She clicks "Add Employee" to onboard a new senior developer:

1. Fills: name, email (auto-generates password), department (Engineering), designation (Senior Developer), role (employee), shift (Morning)
2. Submits — server creates User (hashed password, isFirstLogin=true), UsrIdentity (auto-generated identityCode), EmpProfile (auto-generated employee number CHC-2026-XXX)
3. New employee appears in the directory immediately

She clicks on an existing employee "Rajesh" to view full details:
- **Overview tab:** Professional summary, leave balance (12), skills (React, Node.js), reporting chain (Team Lead → Vikram, Team Admin → Anita)
- **Personal Info tab:** Full identity with masked PAN "ABCXXXX123F", addresses, emergency contacts — she can edit identity fields directly (PUT /api/core/identities/[id])
- **Attendance tab:** Last 30 days attendance (22 present, 2 leaves, 4 holidays, 2 absent), leave history
- **Work Progress tab:** Monthly cycles with expandable task progress — she can see Rajesh worked on "Dashboard UI" for 6 hours yesterday
- **Assets & Docs tab:** Laptop AST-2026-042 assigned, offer letter uploaded
- **Payroll tab:** Last 3 payslips
- **Audit Log tab:** All audited actions for Rajesh

### Attendance — Oversight and Regularization

Priya opens `/attendance`. She sees:
- Her own clock status (clocked in at 09:02)
- Team attendance for today: 127 present, 8 absent, 5 late
- Regularization requests: 3 pending — she reviews and approves each
- She can also trigger auto-logout manually if someone forgot to clock out

### Leave Management — Multi-Tier Approval Authority

Priya opens `/leave`. She has three tabs:

1. **My Leaves:** She applies for 2 days of Earned Leave for next week
2. **All Leaves:** Table of every employee's leave with status badges — she filters by "Pending"
3. **Approvals:** Leaves waiting for admin action

She sees Rajesh's leave request (Casual Leave, 25-26 Jun). She can:
- **Approve:** The leave moves to Step 2 (team_admin/team_lead can now object)
- **Reject:** Leave is denied
- **Hold:** Requires a reason — temporarily pauses the request

If the team lead later "held" the leave, Priya sees the hold reason and can:
- **Override Approve:** Force-approves the leave over the objection
- **Reject:** Final rejection

She can also manage SME leaves — simplified, no multi-level chain. She sees SME leave requests in the monitoring tab's leave section and can approve/reject directly.

### Payroll — Full Processing Pipeline

Priya opens `/payroll`. She selects month "May 2026":

1. **Check structures:** She sees 145 out of 150 active employees have salary structures. 5 employees are missing — she opens their profile and creates structures (DA ₹15,000, HRA ₹8,000, CA ₹2,000, Medical ₹1,250, EPFO ₹1,800, ESI ₹500)
2. **Run Payroll:** Clicks "Run Payroll" — server processes all 150 employees, creating draft payroll records
3. **Review:** The Payroll Register shows all employees with gross pay, deductions, net pay. She scrolls through, makes no adjustments
4. **Approve:** Moves all records from draft → approved
5. **Finalize:** After final review, moves all records from approved → finalized — payroll is now locked

She views her own payslip to verify the system: ₹1,25,000 gross, ₹25,000 deductions, ₹1,00,000 net.

### Tasks & Projects — Organizational Oversight

Priya opens `/tasks`. She sees the Kanban board with all 200 tasks across all projects:
- **To Do:** 45 tasks
- **In Progress:** 38 tasks
- **Completed:** 105 tasks
- **Blocked:** 12 tasks

She can drag any task to any status column to update it. She creates a new task "Security Audit" assigned to Vikram, high priority, due in 2 weeks.

She opens `/projects` to create "Q3 Security Initiative" with departments (Engineering, IT), team members (Vikram, Anita), and a timeline (Jul-Sep 2026).

### Performance — Reviews and Goals

Priya creates Q2 performance reviews for all team leads. She assigns goals for the upcoming quarter. She reviews self-assessments, adds manager scores, and marks reviews as completed.

### Recruitment — Full Pipeline

Priya checks recruitment. There are 4 active job postings. She creates a new one "DevOps Engineer" with full schema: required skills, salary range, 3 interview rounds. She reviews the 12 applicants in the pipeline, moves 2 to Interview stage, and rejects 1 duplicate applicant.

### Finance & Inventory

Priya creates invoices to clients, reviews and approves expense claims against department budgets, assigns assets to new employees.

### Settings — Central Configuration

Priya opens Settings. She:
1. General tab: Sets timezone to Asia/Kolkata, date format to DD/MM/YYYY
2. Departments: Adds "Data Science" department
3. Shifts: Creates "Night (10PM-6AM)" shift for the support team
4. Holidays: Generates 1st/3rd Saturday holidays for 2026
5. SME Expertise: Adds "Machine Learning", "Deep Learning", "NLP" options
6. Notification Rules: Enables reminders for task overdue

### Core HR — Lifecycle Management

Priya navigates to Core HR. She sees the employment directory with 150 profiles. She opens Rajesh's profile. His employment status is "active". She processes:

1. **Transfer:** Moves Rajesh from Engineering to the new Data Science department — updates EmpProfile.department and User.department
2. Records lifecycle history: "Transfer: Engineering → Data Science"

For a separating employee, Priya processes offboarding:
1. Reviews resignation letter
2. Completes 6-item clearance checklist using PATCH /api/core/profiles/clearance
3. Finalizes separation — changes employment status to "resigned", records lifecycle history

### SME Portal — Expert Management

Priya opens "/sme" — her exclusive portal (super_admin only).

**Add SME:** She clicks "Add SME" and creates a profile for Dr. Sharma, Machine Learning expert:
- Personal Info: Name, Email (auto-generates password), DOB, Phone, PAN
- Expertise: Selects "Machine Learning", "Deep Learning" from chips, adds custom "NLP"
- Departments: Selects "Engineering", "Data Science" from chips
- Account Details: Bank name, account holder, account number, IFSC
- Contract & Rate: ₹2,000/hour, 3-month contract (Jun 1 - Aug 31), Status Active
- Submits → system creates User (role=sme) + SME record, shows credentials modal

**Monitoring tab:** Left sidebar lists all 5 SMEs with their task counts. She clicks Dr. Sharma → right panel shows his header (active status badge), 4 summary cards (Total: 8 tasks, To Do: 3, In Progress: 4, Completed: 1), blocked alert (none), pending leaves (1 — she approves it with check button), tasks grouped by due date.

**Work Progress tab:** Lists all SMEs. She clicks an SME to drill into their work progress: dates grouped with expandable task details.

**Leave Requests tab:** Filter bar lets her search by SME name, filter by type, date range, or status. She sees 2 pending SME leaves and approves them.

### Audit — Full Visibility

Priya opens Audit Logs. She filters by module "Auth", severity "medium" to see suspicious login attempts. She spots 15 failed logins from an IP address in the last hour and investigates.

### Reports

She generates an attendance report for June 2026 — exports all employee attendance data.

### Self-Service — Reviewing Employee Requests

Priya sees a red badge on "HR Requests" in the sidebar (3 pending). She opens the review panel:
1. Rajesh's address update request — reviews the new address, approves
2. Anita's emergency contact update — approves
3. Vikram's resignation — he's a key employee; she schedules a meeting before processing

### Impersonation

To troubleshoot an issue Anita is having, Priya uses impersonation. She opens the employee dropdown, selects "Impersonate Anita". All API calls now include `X-Impersonate: {anitaId}` header. The server returns Anita's data. Priya sees exactly what Anita sees, without logging out. A "Return Home" button floats at the bottom-right to end impersonation.

---

## Team Lead POV (Department-Scoped Access)

### Morning Login

Vikram (team_lead) logs in. Same gates apply. He reaches his role-scoped dashboard.

### Dashboard — Team-Focused KPIs

Vikram sees:
- **12 Team Members** — direct reports + department colleagues
- **10 Present Today** — 2 absent, he checks on them
- **3 Pending Approvals** — leaves waiting for his second-step approval
- **5 Team Tasks** — tasks in progress across his team

### Employee View — Department Only

Vikram opens `/employees`. He sees only the 12 people in his department (via `employeeScopeFilter: {teamLeadId: user._id}`). He cannot see employees from other departments. He can view their profiles but cannot edit roles or create new employees.

### Attendance — Team Visibility

Vikram sees his team's attendance table: who clocked in, who's late, who's absent. He cannot clock in/out for others. He can view regularization requests for his team.

### Leave — Second-Step Approver

Vikram opens `/leave`. He sees:
- **My Leaves:** His own leave requests
- **Approvals:** Leaves where admin has already approved (Step 1 done) and now awaiting his step (tlApproval)

He can:
- **Approve:** Leave progresses to final approval
- **Hold:** Raises an objection with reason (visible to admin)
- **Reject:** Denies the leave

He cannot create leaves for others. He cannot view leaves outside his department.

### Tasks — Department Management

Vikram sees tasks assigned to his department members. He can update task statuses, reassign tasks within the team. He cannot create projects.

### Projects — View Only

Vikram can view projects within his department but cannot create or edit them.

### Performance — Team Reviews

Vikram can view and create performance reviews and goals for his team members.

### Calendar — Department View

Vikram sees department-level calendar with team leaves and holidays.

### Self-Service — Own Access Only

Vikram can submit self-service requests for his own profile/address/emergency contacts.

### Restricted Modules (No Access)

Vikram cannot access:
- **Payroll** (false)
- **Recruitment** (false)
- **Finance** (false)
- **Settings** (false)
- **Audit** (false)
- **Core HR** (false)
- **SME** (false)
- **Reports** (false — team_lead access is dept, but reports need specific config)

---

## Employee POV (Self-Only Access)

### First Login

Rajesh is a new employee. He receives an email with his login credentials. He navigates to `/login` and logs in with the auto-generated password. Since `isFirstLogin: true`, he is immediately redirected to `/login/setup-password` where he must set a new password (minimum 6 characters, different from current).

After setting up his password, the system redirects him to `/dashboard`.

### Dashboard — Personal KPIs

Rajesh sees:
- **18 Days Present This Month**
- **12 Leave Balance Remaining**
- **3 Pending Tasks**
- **₹45,000 Last Payslip**

### Attendance — Daily Clock In/Out

Rajesh opens `/attendance`. His view shows only his own attendance:

1. **Clock In:** He clicks "Clock In" at 09:05. The system records the time, marks him as late (his Morning shift starts at 9AM). A timer starts tracking his work hours.

2. **Break/Lunch:** He clicks "Break" at 1:00 PM for lunch. The lunch timer tracks 45 minutes. He clicks "End Break" at 1:45 PM. The system calculates 60 minutes lunch allowance — no deduction.

3. **Work Progress:** He fills in his work progress sheet:
   - 09:05-11:00 — Project Alpha: Dashboard UI (linked to task)
   - 11:00-12:30 — Bug Fix: Login Validation
   - 12:30-1:00 — Code Review

4. **Clock Out:** At 6:00 PM, he clicks "Clock Out". The system calculates 8.5 hours worked - 0.75 hours break = 7.75 hours total.

5. **Forgot Clock Out:** One day Rajesh forgets to clock out. The auto-logout cron detects his open session at 6:30 PM and auto-clocks him out. Next login, he sees a notification asking for late-logout reason.

6. **Regularization:** If he forgot to clock in some morning, he submits a regularization request with `{date, requestedIn, requestedOut, reason: "traffic delay"}`. Admin reviews and approves.

### Leave — Application & Tracking

Rajesh opens `/leave`. He sees only one tab: "My Leaves" (no balance cards for his simplified view). He clicks "Apply Leave":

1. Selects type: Casual Leave (balance shown: 12 remaining)
2. Selects dates: 25-26 Jun (2 days)
3. Enters reason: "Family function"
4. Submits — `POST /api/leave` creates his request with `status:'pending'`

He can view his leave history table and cancel any pending leaves. Once admin approves, the leave-day gate will block his clock-in on those dates.

### Tasks — Assigned Work

Rajesh opens `/tasks`. He sees only tasks assigned to him (assigned scope). The Kanban board shows 3 tasks in "To Do", 2 in "In Progress", 1 "Completed". He drags "Design Homepage" from "To Do" to "In Progress". The status updates in real-time.

The project filter dropdown only shows projects that have his tasks.

### Performance — Self-Review

Rajesh views his own performance reviews and goals. He can submit self-assessments and update goal progress. He cannot see anyone else's data.

### Documents — Accessible Documents

Rajesh opens `/documents`. He sees only documents with access level "all" or "employee" (e.g., Employee Handbook, IT Policy). He cannot see admin-only documents (e.g., contracts of other employees).

### Self-Service — Manage Own Data

Rajesh opens `/self-service`. He can:

1. **Update Profile:** Change his preferred name, personal phone
2. **Update Address:** Submit a new address for his records
3. **Update Emergency Contact:** Change emergency contact details
4. **Resignation:** Submit resignation (with notice period, last working day)

Each request goes through admin review. He can track pending/approved/rejected status.

### Profile — Self-View

Rajesh clicks "My Profile" in the sidebar. The system finds his employee record by email match and redirects him to `/employees/{hisId}`. He sees his own full detail page — the same page an admin would see, but only with his data. He can view his personal info, attendance record, work progress, assigned assets, documents, and payslips.

### Calendar — Personal View

Rajesh opens Calendar. He sees his own leaves marked, company holidays, and attendance status for each day.

### Restricted Modules (No Access)

Rajesh cannot access or even see in sidebar:
- **Employees** (client hides it, server allows dept-scope but client shows false)
- **Recruitment** (false)
- **Finance** (false)
- **Settings** (false)
- **Core HR** (false)
- **SME Portal** (false)
- **Audit** (false)
- **Monitoring** (false)
- **Invoicing** (false)
- **Inventory** (false)
- **Payroll** (self — only shows payslip, no processing)

---

*End of Document — June 24, 2026*
