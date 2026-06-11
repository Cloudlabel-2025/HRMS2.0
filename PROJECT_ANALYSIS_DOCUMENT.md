# HRMS Pro — Project Analysis Document

## Overview

**HRMS Pro** is a full-stack Enterprise Human Resource Management System built with:
- **Frontend:** Next.js 15 (App Router), React, Bootstrap 5, Chart.js
- **Backend:** Next.js API Routes (REST)
- **Database:** MongoDB (Mongoose ODM)
- **Auth:** JWT (access token + refresh token), localStorage, bcrypt password hashing
- **Stack defaults:** INR currency, IST timezone, DD/MM/YYYY date format

---

## User Flow (Current)

```
User visits / (root)
    ↓
Redirects to /login
    ↓
User enters email + password
    ↓ (JWT issued)
First Login? ──YES──→ /login/setup-password (forced password change)
    ↓ NO
/dashboard
    ↓
Sidebar renders only modules the role has access to (RBAC-filtered)
    ↓
User navigates to any allowed module
    ↓
30-min idle → auto logout → redirects to /login?reason=timeout
    ↓
Logout → clears localStorage → /login
```

### Auth Sub-flows
- **Forgot Password:** `/login/forgot-password` → email with reset link → `/login/reset-password`
- **Setup Password:** Enforced on first login at `/login/setup-password`
- **Token Security:** Tokens are blacklisted on logout/password change; brute-force lockout after 5 failed attempts (30-min lock)

---

## Roles Defined

| Role | Label | Description |
|---|---|---|
| `super_admin` | Super Admin | Full unrestricted access to everything |
| `admin_full` | Admin | Full HR/ops access with some finance limits |
| `recruiter` | Recruiter | Recruitment-focused, limited HR visibility |
| `team_admin` | Team Admin | Manages a team, approvals, limited HR |
| `team_lead` | Team Lead | Manages direct reports in their department |
| `employee` | Employee | Self-service, attendance, leave, payslip |
| `intern` | Intern | Very limited — assigned tasks/projects, self-service only |

---

## Module Access by Role

| Module | Super Admin | Admin | Recruiter | Team Admin | Team Lead | Employee | Intern |
|---|---|---|---|---|---|---|---|
| Dashboard | Full | Full | Limited | Team | Dept | Self | Limited |
| Employees | Full | Full | View | Team | Dept | Self | — |
| Recruitment | Full | Full | Full | — | — | — | — |
| Attendance | Full | Full | Self | Team | Dept | Self | Self |
| Absence | Full | Full | Self | Team | Dept | Self | Self |
| Leave | Full | Full | Self | Team | Dept | Self | Self |
| Tasks | Full | Full | Limited | Team | Dept | Assigned | Assigned |
| Projects | Full | Full | View | Team | Dept | Assigned | Assigned |
| Monitoring | Full | Full | — | Team | Dept | — | — |
| Payroll | Full | Limited | — | — | — | Self (payslip) | — |
| Finance | Full | Limited | — | — | — | — | — |
| Invoicing | Full | Limited | — | — | — | — | — |
| Inventory | Full | Full | — | Team | Dept | — | — |
| Performance | Full | Full | Limited | Team | Dept | Self | Limited |
| Documents | Full | Full | Limited | Team | Dept | Self | Limited |
| Self-Service | Full | Full | Self | Self | Self | Self | Self |
| Core HR | Full | Full | View | Team | Dept | — | — |
| Announcements | Full | Full | — | Team | Dept | View | View |
| Calendar | Full | Full | Self | Team | Dept | Self | Self |
| Reports | Full | Full | Limited | Team | Dept | Self | — |
| SME Portal | Full | Full | View | Team | Dept | Limited | Limited |
| Settings | Full | Limited | — | — | — | — | — |
| Audit Logs | Full | View | — | — | — | — | — |

---

## Role-by-Role Usage Guide

---

### 1. Super Admin

**Access Level:** Full unrestricted access to all 24 modules.

**Key Capabilities:**
- **Dashboard:** Full org-wide stats — total employees, present today, pending leaves, open tasks. Recent activity feed + announcements.
- **Employees:** Create, view, edit, deactivate all employees. View full profiles.
- **Recruitment:** Post jobs, manage applicants through pipeline (Applied → Screening → Interview → Offer → Hired/Rejected).
- **Attendance:** View all attendance records, approve regularization requests, monitor team attendance.
- **Leave:** See all leave requests, approve/reject/hold. Can override Team Admin/Team Lead objections.
- **Payroll:** Run monthly payroll, define salary structures (basic, HRA, allowances, PF, ESI, TDS), approve & finalize payroll. View all payslips.
- **Finance:** Manage budgets, expenses, invoices across all departments.
- **Invoicing:** Create and track client invoices (draft → sent → paid/overdue).
- **Inventory:** Manage company assets (assign, track condition) and stock items.
- **Performance:** Create/track goals for all employees, conduct reviews (self/peer/manager scoring).
- **Documents:** Upload and manage policy documents, employee contracts, HR files.
- **Core HR:** Employee lifecycle management (onboarding, transfers, exits), identity and employment profile management.
- **Self-Service:** View and approve all self-service requests from employees.
- **Announcements:** Create, pin, and broadcast company-wide announcements.
- **Calendar:** Full calendar view with company events.
- **Reports:** Generate org-wide HR, attendance, payroll, and performance reports.
- **SME Portal:** Manage SME (Small/Medium Enterprise) client configurations, Saturday configs, payroll start dates.
- **Settings:** Configure system-wide settings — departments, shifts, holidays, system config (timezone, currency, date format).
- **Audit Logs:** View full security audit trail — all login events, data changes, and critical actions with severity levels.

---

### 2. Admin (admin_full)

**Access Level:** Full access to most modules; limited finance and settings.

**Key Capabilities:**
- Same as Super Admin for: Employees, Recruitment, Attendance, Leave, Tasks, Projects, Performance, Documents, Inventory, Core HR, Announcements, Calendar, Reports, SME Portal.
- **Payroll:** Can view payroll register and approve/finalize. Cannot run payroll (Super Admin only in some configs).
- **Finance/Invoicing:** View and limited management (no full budget control).
- **Settings:** Can configure some settings but not full system configuration.
- **Audit Logs:** View-only access.
- **Cannot access:** Full system settings control.

---

### 3. Recruiter

**Access Level:** Recruitment-focused role with limited HR visibility.

**Key Capabilities:**
- **Dashboard:** Shows open positions count, pending tasks, leave balance, days present.
- **Recruitment:** Full access — post job openings, manage applicant pipeline, update stages.
- **Employees:** View-only — can browse employee directory.
- **Attendance/Leave/Absence:** Self only — can track own attendance and apply for leave.
- **Tasks:** Limited — can see assigned tasks.
- **Performance:** Limited visibility.
- **Documents:** Limited — can view shared documents.
- **Self-Service:** Can submit profile/address/emergency contact update requests.
- **Calendar:** Own calendar view.
- **Reports:** Limited reports.
- **Core HR:** View-only.
- **Cannot access:** Payroll, Finance, Invoicing, Inventory, Monitoring, Announcements (create), Settings, Audit.

---

### 4. Team Admin

**Access Level:** Manages a defined team. Sees team-scoped data.

**Key Capabilities:**
- **Dashboard:** Team-level stats — team member count, team present today, leave approvals pending, team tasks.
- **Employees:** View employees in their team.
- **Attendance:** View team attendance. Monitor team clock-in/clock-out status.
- **Leave:** View team's leave requests. **Second-level approval** (after Admin approves, Team Admin can object/hold).
- **Tasks/Projects:** Assign and track tasks/projects within their team.
- **Monitoring:** Monitor team activity.
- **Performance:** Track team member goals and reviews.
- **Documents:** Access team-level documents.
- **Core HR:** View team HR information.
- **Inventory:** View team-assigned assets.
- **Self-Service:** Own self-service requests only.
- **Calendar/Announcements:** View team calendar and announcements.
- **Reports:** Team-scoped reports.
- **Cannot access:** Payroll, Finance, Invoicing, Settings, Audit, Recruitment.

---

### 5. Team Lead

**Access Level:** Manages direct reports in their department.

**Key Capabilities:**
- **Dashboard:** Department-level stats — team members, department attendance, pending approvals, department tasks.
- **Employees:** View employees directly assigned to them (by `teamLeadId`).
- **Attendance:** View attendance of their direct reports.
- **Leave:** View leaves of direct reports. **Third-level approval** — can approve/reject/hold leaves where Admin has already approved.
- **Tasks/Projects:** Assign and manage tasks/projects for their reports.
- **Monitoring:** Monitor their reports' activity.
- **Performance:** Set goals, conduct reviews for direct reports.
- **Documents:** View department documents.
- **Core HR:** View HR data for their reports.
- **Inventory:** View assets assigned to their team.
- **Self-Service:** Own self-service requests.
- **Calendar/Announcements:** View.
- **Reports:** Department-scoped reports.
- **Cannot access:** Payroll, Finance, Invoicing, Settings, Audit, Recruitment.

---

### 6. Employee

**Access Level:** Self-service focused. Can only see own data.

**Key Capabilities:**
- **Dashboard:** Personal stats — days present this month, leave balance, pending tasks, last payslip amount.
- **Employees:** View own profile only (department-level view based on config).
- **Attendance:**
  - Clock In / Clock Out daily.
  - View own monthly attendance (present/absent/late/leave summary).
  - Submit regularization requests (to fix missed clock-in/out).
- **Leave:**
  - Apply for leave (Casual, Sick, Earned, Maternity, Paternity, Compensatory, Loss of Pay).
  - Track leave balance (used vs total per type).
  - View own leave history and approval status.
- **Payroll:** View own payslip — earnings (Basic, HRA, Allowances), deductions (PF, ESI, TDS, LOP), Net Pay.
- **Tasks:** View and update tasks assigned to them.
- **Projects:** View projects they're assigned to.
- **Performance:** View own goals, submit self-assessment scores, participate in performance reviews.
- **Documents:** View documents shared with employees and own contracts.
- **Self-Service (My Profile):**
  - Submit profile update request (preferred name, phone).
  - Submit address update request.
  - Submit emergency contact update.
  - Submit resignation request (with notice period, last working date).
  - View request history and status.
- **Absence:** Own absence records.
- **Calendar:** View own calendar and company events.
- **Announcements:** View company announcements.
- **Reports:** Own data reports only.
- **SME Portal:** Limited visibility.
- **Cannot access:** Finance, Invoicing, Inventory, Monitoring, Core HR, Recruitment, Settings, Audit.

---

### 7. Intern

**Access Level:** Most restricted. Essentially same as Employee but even more limited.

**Key Capabilities:**
- **Dashboard:** Limited view — attendance and basic stats.
- **Attendance:** Clock in/out, view own records, submit regularization.
- **Leave:** Apply and track own leaves.
- **Tasks/Projects:** View and work on assigned tasks/projects only.
- **Performance:** Limited — can view own goals.
- **Documents:** Limited — view shared policy documents.
- **Self-Service:** Full self-service (profile updates, address, emergency contacts, resignation).
- **Calendar:** Own calendar.
- **Announcements:** View only.
- **SME Portal:** Limited visibility.
- **Cannot access:** Employees, Payroll, Finance, Invoicing, Inventory, Monitoring, Core HR, Reports, Recruitment, Settings, Audit.

---

## Leave Approval Workflow

```
Employee applies for leave
    ↓
Admin receives notification → Approves (first level)
    ↓
Team Admin notified → Can object/hold (silence = no objection)
    ↓
Team Lead notified → Can object/hold (silence = no objection)
    ↓
If objection → Admin sees objection, can Override Approve or Reject
    ↓
Final Status: approved / rejected / held
```

---

## Attendance Workflow

```
Employee → Clock In (marks present, records time)
    ↓
Employee → Clock Out (calculates hours worked, flags late if applicable)
    ↓
Monthly summary auto-generated (present/absent/late/leave counts)
    ↓
If missed punch → Submit Regularization Request
    ↓
Admin reviews and approves/rejects regularization
```

---

## Payroll Workflow (Admin/Super Admin)

```
Define Salary Structure per employee (Basic, HRA, Allowances, PF, ESI, TDS)
    ↓
Each month → Run Payroll (auto-calculates from attendance + structure)
    ↓
Review payroll register
    ↓
Approve Payroll
    ↓
Finalize Payroll (locks the records)
    ↓
Employees can view their payslip under "My Payslip" tab
```

---

## Self-Service Request Workflow

```
Employee submits request (profile update / address / emergency contact / resignation)
    ↓
Request logged with status "pending"
    ↓
HR/Admin reviews in Core HR → Self-Service Requests section
    ↓
Approved / Rejected → Employee can see status in request history
```

---

## Security Features

- JWT-based auth with access token + refresh token
- Token blacklisting on logout and password change
- Brute-force lockout: 5 failed attempts → 30-minute account lock
- 30-minute idle session auto-logout
- RBAC on every API route (`requireAuthAndModule`)
- Audit logging for all security-critical events
- First-login forced password change

---

## Technology Stack Summary

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | Bootstrap 5.3, Bootstrap Icons |
| Charts | Chart.js |
| Database | MongoDB (Mongoose) |
| Auth | JWT, bcryptjs |
| Fonts | Geist (Google Fonts) |
| Validation | Zod |
| Date/Currency | INR, IST, DD/MM/YYYY (configurable) |

---

## Navigation Structure (Sidebar Sections)

| Section | Modules |
|---|---|
| MAIN | Dashboard |
| PEOPLE | Employees, Recruitment |
| TIME | Attendance, Absence, Leave |
| WORK | Tasks, Projects, Monitoring |
| FINANCE | Payroll, Finance, Invoicing, Inventory |
| HR | Performance, Documents, My Profile (Self-Service), Core HR, Announcements, Calendar |
| ANALYTICS | Reports, SME Portal |
| SYSTEM | Settings, Audit Logs |

> Sidebar items are dynamically filtered per role — users only see modules they have access to.

---

*Document generated from source code analysis of HRMS2.0 project.*
