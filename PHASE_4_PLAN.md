# Phase 4 Plan (Updated)

## Context — What was actually built in Phases 1, 2 & 3

Before defining Phase 4 scope, here is what the previous phases actually delivered so Phase 4 targets only the real remaining gaps.

### Phase 1 — Security Hardening
- Zod validation framework across all API routes
- Token blacklisting on logout and password change
- Brute-force login lockout (5 attempts, 30-min lock)
- Mass assignment prevention (`.strict()` schemas)
- Centralized audit logging utility
- Secrets management and seed route protection

### Phase 2 — Core HR Lifecycle Engine
- `UsrIdentity`, `EmpProfile`, `EmpLifecycleHistory` models
- Lifecycle transitions: onboarding → probation → active → transfer / promote / suspend / separate / rehire
- Data sync across all 4 layers on every transition: `UsrIdentity`, `EmpProfile`, `User`, legacy `Employee`
- Core HR lifecycle UI (`/core-hr`) with directory, action tabs, history panel
- HR Requests page (`/core-hr/requests`) for reviewing self-service submissions
- RBAC extended with `core_hr` module

### Phase 3 — Self-Service, Employee Registration, and UI Completion
- **Single registration flow** — registering an employee now auto-creates `UsrIdentity` + `EmpProfile` + lifecycle history entry
- **Sequential employee ID** format: `CHC-YYYY-NNNN` (globally consistent)
- **Self-service page** (`/self-service`) — employees submit profile, address, emergency contact, and resignation requests
- **HR approval flow** — HR reviews and approves/rejects self-service requests; approved changes write directly to `UsrIdentity`
- **Notifications** — employees notified on lifecycle transitions and request outcomes; HR notified on new self-service submissions
- **Employee detail page** (`/employees/[id]`) — new Personal Info tab shows identity, address, emergency contacts, employment profile
- **Core HR dropdowns** — Department, Designation, Shift fields in Transfer / Promote / Rehire / Create Profile panels now pull from Settings (globally consistent)
- **Leave approval 3-tier flow** — Admin → Team Admin → Team Lead with hold/override
- **Attendance regularization** — employee submits, admin approves
- **Payroll** — salary structure, run, approve, finalize, employee payslips

---

## Phase 4 Goal

Harden the platform into a production-ready enterprise system by completing the reporting layer, strengthening compliance controls, cleaning up remaining legacy read paths, building exit/offboarding completeness, and adding system-level operational tools.

---

## Phase 4 Scope

### 1. Lifecycle & HR Analytics Dashboard

Build a dedicated reporting section (or extend the existing `/reports` page) with:

- **Headcount summary** — employees by lifecycle status (onboarding, probation, active, suspended, separated, rehired)
- **Department headcount** — breakdown by dept and designation
- **Transition trends** — transfers, promotions, separations over time (monthly/quarterly)
- **Pending HR actions** — employees stuck in onboarding/probation beyond configured days
- **Rehire tracking** — employees with rehire count > 0
- **Self-service request summary** — pending vs approved vs rejected counts by type

These should be available to `super_admin` and `admin_full` from the Reports page.

---

### 2. Exit & Offboarding Completion

Currently separation is recorded but there is no structured clearance tracking. Add:

- **Exit clearance checklist** — configurable checklist items (asset return, access revoked, final settlement, exit interview, NOC issued)
- **Clearance status per employee** — visible in Core HR on separated profiles
- **Record locking** — once a separation is finalized (settlement = settled, clearance complete), prevent further lifecycle mutations on that profile
- **Post-exit document uploads** — HR can attach relieving letter, experience certificate, full & final settlement sheet to the employee's profile

---

### 3. Legacy Read-Path Cleanup

The registration flow now auto-creates Core HR records, but these legacy reads still exist and should be replaced or bridged:

- `/api/employees` GET — still reads from the `Employee` collection; add a fallback/merge that enriches results with `UsrIdentity` data (employee number, employment status) when available
- Employee directory in the Employees page — show `employeeNumber` (from `EmpProfile`) and `employmentStatus` (from `EmpProfile`) alongside the existing columns
- Employee detail page — already reads `UsrIdentity` + `EmpProfile`; ensure the old `Employee` record is not the fallback source for any field that exists in Core HR

---

### 4. Settings — Global Configuration Completion

Currently departments, designations, and shifts are created in Settings and used in Core HR dropdowns. Complete the remaining gaps:

- **Shift assignment** — when a shift is selected in transfer/create profile, sync it back to the `User` and `Employee` records (currently only `EmpProfile` is updated)
- **Department member count** — keep `Department.members` in sync when employees are transferred or separated (currently only incremented on registration)
- **Holiday calendar** — display configured holidays in the Calendar page
- **System config** — expose timezone, currency, date format settings in the Settings page UI (currently only stored, not editable through the UI)

---

### 5. Notification System Hardening

Notifications are created but the Topbar bell only shows basic unread counts. Complete:

- **Notification types** — add `lifecycle`, `self_service`, `payroll` to the existing `['leave', 'attendance', 'general']` enum
- **Notification center** — clicking a notification should navigate to the relevant page (leave request, self-service request, payroll, core HR profile)
- **Email notifications** (optional/future) — add a pluggable email adapter so critical events (resignation approved, probation confirmed, payslip ready) can optionally send email

---

### 6. Payroll Completeness

The payroll engine runs and generates payslips. Remaining gaps:

- **LOP (Loss of Pay) auto-calculation** — currently `lopDays` is stored but not auto-calculated from attendance; connect payroll run to attendance records to auto-compute LOP days
- **Payslip PDF export** — the payslip view exists but the PDF button does nothing; implement print/PDF generation
- **Salary structure validation** — warn HR when an employee has no salary structure defined before running payroll

---

### 7. Compliance & Privacy Controls

- **PAN / Aadhaar entry** — the identity model has encrypted PAN/Aadhaar fields but there is no UI to enter them; add fields in the employee detail Personal Info tab (admin only, with masking on display)
- **Audit log visibility** — the `/audit` page exists; ensure it shows self-service approvals, lifecycle transitions, and payroll events with correct severity
- **Data retention** — add a configurable soft-delete/archive policy so separated employees older than N years can be archived (identity and profile flagged `archived`, excluded from active queries)

---

## Recommended Build Order

1. Legacy read-path cleanup + department member count sync (low risk, high visibility)
2. Exit clearance checklist + record locking (completes the separation flow)
3. Lifecycle analytics in Reports page (no model changes needed, just queries)
4. Payroll LOP auto-calculation + payslip PDF
5. Notification center navigation + type expansion
6. Settings system config UI + holiday calendar display
7. PAN/Aadhaar UI (admin-only, masked)
8. Data retention / archive policy

---

## What Phase 4 Does NOT Need to Do

These were listed in the original Phase 4 plan but are already done:

- ~~Replace employee-directory reads with identity/profile queries~~ — done in Phase 3 (employee detail page reads Core HR; registration auto-creates Core HR records)
- ~~Self-service requests~~ — fully built in Phase 3
- ~~Exit separation workflow~~ — lifecycle separation action built in Phase 2; resignation self-service built in Phase 3
- ~~Lifecycle history~~ — append-only history written on every transition since Phase 2
- ~~RBAC for self-service and separation~~ — done in Phase 2/3

---

## Phase 4 Deliverables

| Deliverable | Priority |
|---|---|
| Lifecycle analytics dashboard in Reports | High |
| Exit clearance checklist + record locking | High |
| LOP auto-calculation from attendance | High |
| Department member count sync on transfer/separation | Medium |
| Payslip PDF export | Medium |
| Notification center with navigation | Medium |
| System config UI in Settings | Medium |
| Holiday calendar integration | Medium |
| PAN/Aadhaar entry UI (admin, masked) | Low |
| Data retention/archive policy | Low |

---

## Completion Definition

Phase 4 is complete when:

1. HR can track an employee from onboarding to full exit clearance without any manual workarounds
2. Reports page shows real-time lifecycle and headcount analytics
3. Payroll run automatically accounts for LOP from attendance
4. No critical operational path still depends on the legacy `Employee` document as the primary source of truth (it remains as a compatibility record only)
5. All sensitive identity fields have appropriate masking and audit coverage
