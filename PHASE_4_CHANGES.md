# Phase 4 — Changes Documentation

**Status:** Partially Executed (Session interrupted mid-execution)
**Date:** Current session

---

## What Was Completed in This Session

### 1. HR Lifecycle Analytics Report

**Files Modified:**
- `src/app/api/reports/route.js`
- `src/app/reports/page.js`

**What was done:**

Added a new `lifecycle` report type to the existing Reports module.

**API (`/api/reports?type=lifecycle`):**
- Queries all `EmpProfile` records and aggregates by employment status
- Returns headcount breakdown by lifecycle status (onboarding, probation, active, suspended, resigned, terminated, rehired)
- Returns headcount breakdown by department
- Returns self-service request summary (pending/approved/rejected counts per request type) via aggregation on `SelfServiceRequest`
- Returns full employee table with name, department, designation, status, hire date, rehire count
- Access restricted to `super_admin` and `admin_full`

**UI (`/reports` page):**
- Added "HR Lifecycle" card to the report type selector (orange, `bi-diagram-3` icon)
- Added rendering for `deptChart` — second bar chart showing headcount by department
- Added self-service request summary table with color-coded status badges (pending/approved/rejected)
- Existing summary cards, main chart, and data table all work for lifecycle report

---

### 2. Department Member Count Sync on Lifecycle Transitions

**File Modified:** `src/app/api/core/lifecycle/transition/route.js`

**What was done:**

Previously, `Department.members` count was only incremented when an employee was registered. It was never updated when employees were transferred or separated. Fixed:

- **Transfer:** When `action === 'transfer'` and the department changes, decrements old department count by 1, increments new department count by 1
- **Separation:** When `action === 'separation'`, decrements the employee's department count by 1
- **Rehire:** When `action === 'rehire'`, increments the new department count by 1

This keeps `Department.members` accurate across the full employee lifecycle.

---

### 3. Lifecycle Notification Type Fix

**File Modified:** `src/app/api/core/lifecycle/transition/route.js`

**What was done:**

Previously all lifecycle notifications (probation, active, suspended, etc.) were sent with type `'general'`. Changed to type `'lifecycle'` so:
- Notifications display with the correct cyan color and `bi-diagram-3` icon in the Topbar
- Clicking a `lifecycle` notification navigates to `/core-hr` (already wired in `getNotifRoute` in Topbar)

---

### 4. Notification Type Expansion (Model)

**File Modified:** `src/lib/models/index.js`

**What was done (partially — interrupted):**

The `Notification` model's `type` enum was updated from:
```
['leave', 'attendance', 'general']
```
to:
```
['leave', 'attendance', 'general', 'lifecycle', 'self_service', 'payroll']
```

This is required for the new notification types created by lifecycle transitions and self-service requests to be saved correctly without Mongoose validation errors.

---

## What Was Done in the Bug Fix Session (Before Phase 4)

These changes were completed before Phase 4 execution began:

### Bug Fix 1 — Lifecycle Action Fields Bleeding Between Tabs

**File Modified:** `src/app/core-hr/page.js`

**Problem:** All lifecycle action tabs (transfer, promote, probation, rehire, suspend, separate) shared one flat `EMPTY_FORM` object. Switching from Transfer to Promotion kept the department/designation values from the transfer form visible in the promotion form.

**Fix:**
- Added `ACTION_DEFAULTS` map — each action key maps to only the fields relevant to that action with sensible defaults
- Added `switchAction(key)` function — resets the form to `EMPTY_FORM` + merges only that action's defaults when switching tabs
- When an employee is selected from the directory, the form is now reset to `EMPTY_FORM` and the action resets to `confirm_probation`
- Replaced `setAction(item.key)` with `switchAction(item.key)` in the action tab buttons

---

### Bug Fix 2 — Self-Service Requests Not Accessible as a Queue

**Files Modified:**
- `src/components/Topbar.js`
- `src/components/Sidebar.js`

**Problem:** When an employee submitted a self-service request (address update, profile update, etc.), HR only saw a generic bell notification. There was no way to navigate to the review queue from the notification, and the HR Requests page (`/core-hr/requests`) was not prominent enough.

**Fixes:**

**Topbar.js:**
- Added `useRouter` for navigation
- Extended `NOTIF_ICONS` and `NOTIF_COLORS` to include `self_service`, `lifecycle`, and `payroll` types
- Added `getNotifRoute(n)` function — maps notification type to the correct page (`self_service` → `/core-hr/requests`, `lifecycle` → `/core-hr`, `leave` → `/leave`, `attendance` → `/attendance`, `payroll` → `/payroll`)
- Added `handleNotifClick(n)` — marks notification as read then navigates to the correct route
- Added `loadPendingRequests()` — fetches count of pending self-service requests for HR admins
- Added `pendingRequests` state — polled every 30 seconds
- Added a yellow banner inside the notification dropdown when `pendingRequests > 0` — shows count and a "Review now" button that navigates to `/core-hr/requests`
- Notification items now use `handleNotifClick` instead of just `markRead`

**Sidebar.js:**
- Added `useState`, `useEffect`, `api` imports
- Added `pendingRequests` state — fetches from `/api/core/self-service-requests?status=pending` on mount, polls every 30 seconds (admin/super_admin only)
- Added red badge on the "HR Requests" sidebar link showing the pending count when > 0

---

## What Remains in Phase 4 (Not Yet Executed)

The following deliverables from the Phase 4 plan were not reached in this session:

| Deliverable | Status | Notes |
|---|---|---|
| Lifecycle analytics — HR Lifecycle report | ✅ Done | |
| Department member count sync | ✅ Done | |
| Notification type expansion | ✅ Done (model) | |
| Notification center navigation | ✅ Done (Topbar + Sidebar) | |
| Lifecycle notification type fix | ✅ Done | |
| Self-service notification type | ✅ Already correct (`self_service`) | |
| Exit clearance checklist | ✅ Done | Model + API + Core HR UI |
| Record locking on finalized separation | ✅ Done | Transition API has `isLocked` check |
| Legacy read-path enrichment | ✅ Done | Employee list shows `employeeNumber` + `employmentStatus` |
| Payslip PDF export | ✅ Done | `printPayslip()` opens print window; button on register, My Payslip, and modal |
| Salary structure validation before payroll run | ✅ Done | Confirm dialog lists employees with no structure before run |
| PAN/Aadhaar entry UI | ✅ Done | Admin-only section in employee detail Personal Info tab with masking |
| Data retention/archive policy | ✅ Done | `/api/core/archive` GET/POST + Settings General tab UI (super_admin only) |
| Holiday calendar already working | ✅ Already done | Calendar page already loads from settings |
| LOP auto-calculation | ✅ Already done | Payroll run already calculates LOP from attendance records |

---

## Files Modified in Phase 4

| File | Change |
|---|---|
| `src/app/api/reports/route.js` | Added lifecycle report type with headcount, dept breakdown, self-service summary |
| `src/app/reports/page.js` | Added HR Lifecycle report card, dept chart render, self-service summary table |
| `src/app/api/core/lifecycle/transition/route.js` | Department member count sync on transfer/separation/rehire; lifecycle notification type fixed |
| `src/lib/models/index.js` | Notification type enum expanded to include lifecycle, self_service, payroll |
| `src/app/core-hr/page.js` | Bug fix: action form isolation on tab switch; reset on employee selection |
| `src/components/Topbar.js` | Bug fix: notification navigation, pending requests banner, new notification types |
| `src/components/Sidebar.js` | Bug fix: pending HR requests badge on sidebar link |
| `src/app/api/self-service/requests/route.js` | HR notification type set to `self_service` |
