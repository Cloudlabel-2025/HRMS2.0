/**
 * Generates docs/rbac-scenarios/RBAC_Scenarios_HRMS.xlsx
 * RBAC test scenarios for 8 roles x 11 modules. Matrix is generated
 * programmatically from src/lib/permissions.js MODULE_ACCESS (no drift).
 *
 * Run: node scripts/generate-rbac-scenarios.mjs
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_ACCESS } from '../src/lib/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'docs', 'rbac-scenarios');
const OUT_FILE = path.join(OUT_DIR, 'RBAC_Scenarios_HRMS.xlsx');

const ROLES = [
  ['Super Admin', 'super_admin', '8B5CF6'],
  ['Admin', 'admin_full', '3B82F6'],
  ['Recruiter', 'recruiter', '06B6D4'],
  ['Team Lead', 'team_lead', '10B981'],
  ['Team Admin', 'team_admin', 'F97316'],
  ['Employee', 'employee', 'F59E0B'],
  ['Intern', 'intern', '64748B'],
  ['SME', 'sme', '0891B2'],
];
const ROLE_LABELS = ROLES.map((r) => r[0]);

// ── Scenario rows ─────────────────────────────────────────────────────────
// [SC-ID, Module, Sub-module, Role, Category, Precondition, Action, Steps,
//  Expected UI, Expected HTTP, Expected DB/State, Negative?, Trace, Priority]
const S = (...a) => a;
const SCENARIOS = [
  // ── Dashboard (D) ──
  S('D-01', 'Dashboard', 'Stat cards + Monitoring', 'Super Admin', 'Access', 'Seeded employees + today attendance', 'Open /dashboard; GET /api/dashboard', '1. Login Super Admin 2. Open Dashboard 3. Call GET /api/dashboard', 'Total Employees (global), Present Today (global), Pending Leaves (global), Monitoring + Overview cards', '200; monitoring + overview present', 'No state change', 'No', 'src/app/api/dashboard/route.js:52,55,75,122', 'P1'),
  S('D-02', 'Dashboard', 'Stat cards + Monitoring', 'Admin', 'Access', 'Same as D-01', 'Open /dashboard; GET /api/dashboard', '1. Login Admin 2. Open Dashboard', 'Same stat cards as Super Admin; Monitoring card visible; no Overview card', '200; monitoring present; overview null', 'No state change', 'No', 'src/app/api/dashboard/route.js:52,75', 'P1'),
  S('D-03', 'Dashboard', 'Team stat cards', 'Team Lead', 'Scope', 'Team members in own + visible departments', 'Open /dashboard; GET /api/dashboard', '1. Login Team Lead 2. Check Team Members / Present Today / Pending Approvals', 'Team Members = teamIds.length; Present Today scoped to team; Pending Approvals scoped', '200; monitoring null', 'No state change', 'No', 'src/app/api/dashboard/route.js:53,56,64', 'P1'),
  S('D-04', 'Dashboard', 'Team stat cards', 'Team Admin', 'Scope', 'Same as D-03', 'Open /dashboard; GET /api/dashboard', '1. Login Team Admin 2. Check Team Members / Leave Approvals', 'Same scoping as Team Lead; label Leave Approvals', '200; monitoring null', 'No state change', 'No', 'src/app/api/dashboard/route.js:53,56', 'P1'),
  S('D-05', 'Dashboard', 'Self cards', 'Employee', 'Access', 'Own attendance + leave + payslip seeded', 'Open /dashboard; GET /api/dashboard', '1. Login Employee 2. Check Days Present / Leave Balance / Last Payslip', 'Days Present, Leave Balance, Pending Tasks, Last Payslip; totals show 0/—', '200; monitoring null; pendingTasks scoped to self', 'No state change', 'No', 'src/app/api/dashboard/route.js:61,250', 'P1'),
  S('D-06', 'Dashboard', 'Self cards', 'Intern', 'Access', 'Same as D-05', 'Open /dashboard; GET /api/dashboard', '1. Login Intern 2. Check cards', 'Same self cards as Employee', '200; monitoring null', 'No state change', 'No', 'src/app/api/dashboard/route.js:61', 'P2'),
  S('D-07', 'Dashboard', 'Recruiter cards', 'Recruiter', 'Access', 'Active job postings seeded', 'Open /dashboard; GET /api/dashboard', '1. Login Recruiter 2. Check Open Positions / Pending Tasks', 'Open Positions = active jobs; Pending Tasks scoped to self', '200; openJobs counted; monitoring null', 'No state change', 'No', 'src/app/api/dashboard/route.js:255', 'P2'),
  S('D-08', 'Dashboard', 'Self cards', 'SME', 'Access', 'SME user linked', 'Open /dashboard; GET /api/dashboard', '1. Login SME 2. Check cards', 'Generic self cards (Days Present etc.)', '200; monitoring null', 'No state change', 'No', 'src/app/(protected)/dashboard/page.js:178', 'P2'),
  S('D-09', 'Dashboard', 'Monitoring branch guard', 'Employee', 'Negative', 'Any', 'GET /api/dashboard', '1. Login Employee 2. Inspect payload', 'No monitoring section rendered', '200 with monitoring:null', 'No state change', 'Yes', 'src/app/api/dashboard/route.js:75', 'P1'),
  S('D-10', 'Dashboard', 'Announcements', 'Team Lead', 'Scope', 'Announcements with Company-wide + dept audiences', 'GET /api/dashboard', '1. Login Team Lead 2. Check Announcements card', 'Only Company-wide + accessible-dept + My Team items', '200', 'No state change', 'No', 'src/app/api/dashboard/route.js:30', 'P2'),

  // ── Employees (E) ──
  S('E-01', 'Employees', 'Directory', 'Super Admin', 'Access', 'Active employees seeded', 'Open /employees; GET /api/employees', '1. Login Super Admin 2. Open Employees', 'Full directory, all departments', '200 full list', 'No state change', 'No', 'src/app/api/employees/route.js:17,29', 'P1'),
  S('E-02', 'Employees', 'Directory', 'Admin', 'Access', 'Same as E-01', 'Open /employees; GET /api/employees', '1. Login Admin 2. Open Employees', 'Full directory', '200 full list', 'No state change', 'No', 'src/app/api/employees/route.js:17,29', 'P1'),
  S('E-03', 'Employees', 'Directory', 'Recruiter', 'Access', 'Same as E-01', 'Open /employees; GET /api/employees', '1. Login Recruiter 2. Open Employees', 'Full directory (view); can create via POST', '200; POST allowed', 'No state change', 'No', 'src/app/api/employees/route.js:29,118', 'P1'),
  S('E-04', 'Employees', 'Directory', 'Team Lead', 'Scope', 'Employees across 2 departments', 'GET /api/employees', '1. Login Team Lead 2. List employees', 'Only own + visibleDepartments departments', '200 filtered by department', 'No state change', 'No', 'src/app/api/employees/route.js:29', 'P1'),
  S('E-05', 'Employees', 'Directory', 'Team Admin', 'Scope', 'Same as E-04', 'GET /api/employees', '1. Login Team Admin 2. List employees', 'Only own department teams', '200 filtered', 'No state change', 'No', 'src/app/api/employees/route.js:29', 'P1'),
  S('E-06', 'Employees', 'Directory', 'Employee', 'Scope', 'Same as E-04', 'GET /api/employees', '1. Login Employee 2. List employees', 'Own department directory (dept access)', '200 filtered', 'No state change', 'No', 'src/app/api/employees/route.js:29', 'P2'),
  S('E-07', 'Employees', 'Directory', 'Intern', 'Negative', 'Any', 'GET /api/employees', '1. Login Intern 2. Call API', 'Sidebar hides Employees; API denies', '403 Access denied', 'No state change', 'Yes', 'src/app/api/employees/route.js:17', 'P1'),
  S('E-08', 'Employees', 'Directory', 'SME', 'Negative', 'Any', 'GET /api/employees', '1. Login SME 2. Call API', 'No access', '403 Access denied', 'No state change', 'Yes', 'src/app/api/employees/route.js:17', 'P1'),
  S('E-09', 'Employees', 'Create', 'Team Lead', 'Negative', 'Any', 'POST /api/employees', '1. Login Team Lead 2. POST new employee', 'No create button; API denies', '403 Access denied', 'No record created', 'Yes', 'src/app/api/employees/route.js:118', 'P1'),
  S('E-10', 'Employees', 'Create role guard', 'Admin', 'Negative', 'Any', 'POST /api/employees {role:super_admin}', '1. Login Admin 2. POST with super_admin role', 'Validation error', '403 (only Super Admin may grant)', 'No record created', 'Yes', 'src/app/api/employees/route.js:132', 'P1'),

  // ── Absence (A) ──
  S('A-01', 'Absence', 'Month view', 'Super Admin', 'Access', 'Attendance + leaves + permissions seeded for month', 'Open /absence; GET /api/absence?month=YYYY-MM', '1. Login Super Admin 2. Open Absence 3. Pick month', 'All derived rows (absent/not_arrived/on_leave/on_permission/late/half_day) + summary', '200 absences[] + summary', 'No state change (derived)', 'No', 'src/app/api/absence/route.js:42,103', 'P1'),
  S('A-02', 'Absence', 'Month view', 'Admin', 'Access', 'Same as A-01', 'GET /api/absence?month=YYYY-MM', '1. Login Admin 2. Open Absence', 'Same full-month view as Super Admin', '200', 'No state change', 'No', 'src/app/api/absence/route.js:42', 'P1'),
  S('A-03', 'Absence', 'Month view', 'Team Lead', 'Scope', 'Two departments with absences', 'GET /api/absence?month=YYYY-MM', '1. Login Team Lead 2. Open Absence', 'Only dept + visibleDepartments users', '200 filtered roster', 'No state change', 'No', 'src/app/api/absence/route.js:43,90', 'P1'),
  S('A-04', 'Absence', 'Month view', 'Team Admin', 'Scope', 'Same as A-03', 'GET /api/absence?month=YYYY-MM', '1. Login Team Admin 2. Open Absence', 'Only team users', '200 filtered roster', 'No state change', 'No', 'src/app/api/absence/route.js:43,90', 'P1'),
  S('A-05', 'Absence', 'Month view', 'Employee', 'Scope', 'Own records', 'GET /api/absence?month=YYYY-MM', '1. Login Employee 2. Open Absence', 'Only own rows', '200 self only', 'No state change', 'No', 'src/app/api/absence/route.js:44', 'P1'),
  S('A-06', 'Absence', 'Month view', 'Intern', 'Scope', 'Own records', 'GET /api/absence?month=YYYY-MM', '1. Login Intern 2. Open Absence', 'Only own rows', '200 self only', 'No state change', 'No', 'src/app/api/absence/route.js:44', 'P2'),
  S('A-07', 'Absence', 'Month view', 'Recruiter', 'Scope', 'Own records', 'GET /api/absence?month=YYYY-MM', '1. Login Recruiter 2. Open Absence', 'Only own rows', '200 self only', 'No state change', 'No', 'src/app/api/absence/route.js:44', 'P2'),
  S('A-08', 'Absence', 'Month view', 'SME', 'Scope', 'Own records', 'GET /api/absence?month=YYYY-MM', '1. Login SME 2. Open Absence', 'Only own rows', '200 self only', 'No state change', 'No', 'src/app/api/absence/route.js:44', 'P2'),
  S('A-09', 'Absence', 'Not arrived threshold', 'Super Admin', 'Workflow', 'No clock-in today; now BEFORE halfDayThreshold (180m)', 'GET /api/absence (current month)', '1. Check before threshold time 2. Reload', 'Grey Not Arrived badge (not red Absent)', '200 kind=not_arrived', 'No Attendance row written', 'No', 'src/lib/absence-status.js; src/app/api/absence/route.js:180', 'P1'),
  S('A-10', 'Absence', 'Absent after threshold', 'Super Admin', 'Workflow', 'No clock-in today; now AFTER halfDayThreshold', 'GET /api/absence (current month)', '1. Check after threshold 2. Reload', 'Red Absent badge; permission badge persists if permission on file', '200 kind=absent', 'markAbsentEmployees may write absent row', 'No', 'src/lib/attendance-utils.js:188', 'P1'),
  S('A-11', 'Absence', 'On leave + dedupe', 'Admin', 'Workflow', 'Approved leave covering date; legacy Absence doc same date', 'GET /api/absence?month=YYYY-MM', '1. Approve leave 2. Reload month', 'On Leave badge; legacy doc counted once (dedupe)', '200 kind=on_leave; single row per user/date', 'No duplicate', 'No', 'src/app/api/absence/route.js:236', 'P1'),
  S('A-12', 'Absence', 'Without Leave filter', 'Admin', 'Scope', 'Absent rows with and without approved leave', 'Select Without Leave dropdown', '1. Open Absence 2. Select Without Leave', 'Only kind=absent AND hasLeave=false', '200 (client filter)', 'No state change', 'No', 'src/app/(protected)/absence/page.js:79', 'P2'),

  // ── Leave (L) ──
  S('L-01', 'Leave', 'All Leaves tab', 'Super Admin', 'Access', 'Leaves across roles', 'Open /leave > All Leaves; GET /api/leave?scope=all', '1. Login Super Admin 2. Open All Leaves', 'All leave rows with type badge colors', '200', 'No state change', 'No', 'src/app/api/leave/route.js:50', 'P1'),
  S('L-02', 'Leave', 'All Leaves tab', 'Admin', 'Access', 'Same as L-01', 'GET /api/leave?scope=all', '1. Login Admin 2. Open All Leaves', 'All rows visible', '200', 'No state change', 'No', 'src/app/api/leave/route.js:50', 'P1'),
  S('L-03', 'Leave', 'All Leaves tab', 'Team Lead', 'Negative', 'Any', 'GET /api/leave?scope=all', '1. Login Team Lead 2. Call API', 'No All Leaves tab', '403 Access denied', 'No state change', 'Yes', 'src/app/api/leave/route.js:50', 'P1'),
  S('L-04', 'Leave', 'Team scope', 'Team Lead', 'Scope', 'Team leaves', 'GET /api/leave?scope=team', '1. Login Team Lead 2. Load team leaves', 'Dept-scoped rows via getDepartmentUserIds', '200 filtered', 'No state change', 'No', 'src/app/api/leave/route.js:52', 'P1'),
  S('L-05', 'Leave', 'Approvals queue', 'Team Admin', 'Workflow', 'Pending leave in dept', 'Open Pending Approvals; PUT /api/leave/:id approve', '1. Login Team Admin 2. Approve pending (admin approved first)', 'Approve/Hold/Reject per canActOn', '200 on action', 'status + workflowApprovals updated; balance moved', 'No', 'src/app/(protected)/leave/page.js:192; src/app/api/leave/route.js:56', 'P1'),
  S('L-06', 'Leave', 'Approvals queue', 'Team Lead', 'Workflow', 'Pending leave in dept', 'PUT /api/leave/:id approve', '1. Login Team Lead 2. Act on pending step for own hierarchy', 'Buttons only when canAct true (role in approverRoles / legacy gates)', '200 or 403 if not entitled step', 'Workflow step updated', 'No', 'src/app/api/leave/[id]/route.js', 'P1'),
  S('L-07', 'Leave', 'Apply', 'Employee', 'Workflow', 'Balance available; no overlap/permission clash', 'POST /api/leave', '1. Login Employee 2. Apply Leave 3. Submit valid dates+reason', 'Success toast; row appears pending', '201; workflowApprovals built; pending balance incremented', 'Leave pending; balance.pending += paidDays', 'No', 'src/app/api/leave/route.js:285', 'P1'),
  S('L-08', 'Leave', 'Apply', 'Intern', 'Workflow', 'Same as L-07', 'POST /api/leave', '1. Login Intern 2. Apply', 'Same as Employee', '201', 'Leave pending', 'No', 'src/app/api/leave/route.js:285', 'P2'),
  S('L-09', 'Leave', 'Apply', 'Recruiter', 'Workflow', 'Recruiter has leave:self', 'POST /api/leave', '1. Login Recruiter 2. Apply', 'Own leave only', '201', 'Leave pending', 'No', 'src/app/api/leave/route.js:285', 'P2'),
  S('L-10', 'Leave', 'Apply (SME)', 'SME', 'Workflow', 'Active SME profile; within contract', 'POST /api/leave', '1. Login SME 2. Apply', 'Single Admin column; max 1 pending enforced', '201 or 400 if pending exists/contract exceeded', 'Leave pending with smeId', 'No', 'src/app/api/leave/route.js:227', 'P2'),
  S('L-11', 'Leave', 'Apply hidden', 'Super Admin', 'Access', 'Any', 'Open /leave My tab', '1. Login Super Admin 2. Check Apply button', 'No Apply Leave button; must pick employee via selectedEmpId', 'GET scope=my&userId=...', 'No state change', 'No', 'src/app/(protected)/leave/page.js:105,241', 'P2'),
  S('L-12', 'Leave', 'Self-approval', 'Team Lead', 'Negative', 'Own pending leave', 'PUT /api/leave/:id approve own', '1. Apply as lead 2. Approve own request', 'No action buttons on own row', '403 (canApproveLeave false for self)', 'No change', 'Yes', 'src/lib/rbac.js:76', 'P1'),
  S('L-13', 'Leave', 'Approve action', 'Employee', 'Negative', 'Any pending leave', 'PUT /api/leave/:id approve', '1. Login Employee 2. Attempt approve', 'No action buttons', '403', 'No change', 'Yes', 'src/app/api/leave/[id]/route.js', 'P1'),
  S('L-14', 'Leave', 'Type badge color', 'Admin', 'Edge', 'Mixed CL/SL/PL/LOP rows in All Leaves', 'Open All Leaves', '1. Login Admin 2. Open All Leaves', 'Every Type badge shows policy color (server typeColor), never transparent', '200 rows carry typeColor/typeName', 'No state change', 'No', 'src/app/api/leave/route.js:enrichment; src/app/(protected)/leave/page.js:420', 'P1'),

  // ── Leave Policies (LP) ──
  S('LP-01', 'Leave Policies', 'Page access', 'Super Admin', 'Access', 'Any', 'Open /leave-policies', '1. Login Super Admin 2. Open page', 'Full editor (General/Applicability/Entitlements/Workflow/Advanced)', '200', 'No state change', 'No', 'src/app/(protected)/leave-policies/page.js', 'P1'),
  S('LP-02', 'Leave Policies', 'Page access', 'Admin', 'Access', 'Any', 'Open /leave-policies', '1. Login Admin 2. Open page', 'Same editor as Super Admin', '200', 'No state change', 'No', 'src/app/(protected)/leave-policies/page.js', 'P1'),
  S('LP-03', 'Leave Policies', 'Page + API deny', 'Team Lead', 'Negative', 'Any', 'Open /leave-policies; GET /api/settings/leave-policies', '1. Login Team Lead 2. Open page', 'Access Restricted message', '403', 'No state change', 'Yes', 'src/app/api/settings/leave-policies/route.js:11', 'P1'),
  S('LP-04', 'Leave Policies', 'API deny', 'Employee', 'Negative', 'Any', 'GET /api/settings/leave-policies', '1. Login Employee 2. Call API', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/settings/leave-policies/route.js:11', 'P1'),
  S('LP-05', 'Leave Policies', 'API deny', 'Intern', 'Negative', 'Any', 'GET /api/settings/leave-policies', '1. Login Intern 2. Call API', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/settings/leave-policies/route.js:11', 'P2'),
  S('LP-06', 'Leave Policies', 'API deny', 'Recruiter', 'Negative', 'Any', 'GET /api/settings/leave-policies', '1. Login Recruiter 2. Call API', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/settings/leave-policies/route.js:11', 'P2'),
  S('LP-07', 'Leave Policies', 'API deny', 'SME', 'Negative', 'Any', 'GET /api/settings/leave-policies', '1. Login SME 2. Call API', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/settings/leave-policies/route.js:11', 'P2'),
  S('LP-08', 'Leave Policies', 'Default protection', 'Admin', 'Edge', 'isDefault policy exists', 'DELETE /api/settings/leave-policies/:id (?hard=true)', '1. Login Admin 2. Archive/delete default', 'Blocked with message', '400 (default protected)', 'Policy unchanged', 'Yes', 'src/app/api/settings/leave-policies/[id]/route.js', 'P2'),

  // ── Bulk Import (BI) ──
  S('BI-01', 'Bulk Import', 'Template', 'Super Admin', 'Access', 'Any', 'GET /api/leave/bulk/template?type=leaves', '1. Login Super Admin 2. Download template', 'Excel template downloads', '200', 'No state change', 'No', 'src/app/api/leave/bulk/template/route.js:8', 'P1'),
  S('BI-02', 'Bulk Import', 'Validate+Commit', 'Admin', 'Workflow', 'CSV/XLSX <=3MB, <=500 rows', 'POST validate then commit', '1. Login Admin 2. Upload 3. Validate 4. Commit', 'Row errors listed; commit creates balances/leaves + Attendance rows', '200; audit + Document archive', 'Balances/leaves created per mode', 'No', 'src/app/api/leave/bulk/validate/route.js:32; src/app/api/leave/bulk/commit/route.js:65', 'P1'),
  S('BI-03', 'Bulk Import', 'Template deny', 'Team Lead', 'Negative', 'Any', 'GET /api/leave/bulk/template', '1. Login Team Lead 2. Call API', 'Page shows admin-only alert', '403', 'No state change', 'Yes', 'src/app/api/leave/bulk/template/route.js:8', 'P1'),
  S('BI-04', 'Bulk Import', 'Validate deny', 'Employee', 'Negative', 'Any', 'POST /api/leave/bulk/validate', '1. Login Employee 2. Upload file', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/leave/bulk/validate/route.js:32', 'P1'),
  S('BI-05', 'Bulk Import', 'Commit deny', 'Team Admin', 'Negative', 'Any', 'POST /api/leave/bulk/commit', '1. Login Team Admin 2. Commit rows', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/leave/bulk/commit/route.js:65', 'P1'),
  S('BI-06', 'Bulk Import', 'skipEligibility', 'Admin', 'Negative', 'Any', 'POST validate with skipEligibility=1', '1. Login Admin (non-super) 2. Validate with skip flag', 'Flag rejected', '403 (super_admin only); commit always re-checks', 'No state change', 'Yes', 'src/app/api/leave/bulk/validate/route.js', 'P2'),
  S('BI-07', 'Bulk Import', 'File guards', 'Super Admin', 'Edge', 'File >3MB or >500 rows', 'POST /api/leave/bulk/validate', '1. Upload oversized file', 'Validation error message', '400', 'No state change', 'Yes', 'src/app/api/leave/bulk/validate/route.js', 'P2'),
  S('BI-08', 'Bulk Import', 'Access deny', 'Recruiter', 'Negative', 'Any', 'Open /leave/bulk', '1. Login Recruiter 2. Open page', 'Admin-only alert', '403 on API', 'No state change', 'Yes', 'src/app/(protected)/leave/bulk/page.js', 'P2'),
  S('BI-09', 'Bulk Import', 'Access deny', 'Intern', 'Negative', 'Any', 'Open /leave/bulk', '1. Login Intern 2. Open page', 'Admin-only alert', '403 on API', 'No state change', 'Yes', 'src/app/(protected)/leave/bulk/page.js', 'P2'),
  S('BI-10', 'Bulk Import', 'Access deny', 'SME', 'Negative', 'Any', 'Open /leave/bulk', '1. Login SME 2. Open page', 'Admin-only alert', '403 on API', 'No state change', 'Yes', 'src/app/(protected)/leave/bulk/page.js', 'P2'),

  // ── Monitoring (M) ──
  S('M-01', 'Monitoring', 'Live board', 'Super Admin', 'Access', 'Team + shifts seeded', 'Open /monitoring', '1. Login Super Admin 2. Open Monitoring', 'All employees with Present/Late/Not Arrived/Absent/On Leave + work-progress modal', '200', 'No state change', 'No', 'src/app/(protected)/monitoring/page.js:68,350', 'P1'),
  S('M-02', 'Monitoring', 'Live board', 'Admin', 'Access', 'Same as M-01', 'Open /monitoring', '1. Login Admin 2. Open Monitoring', 'Full board (no work-progress modal unless super_admin)', '200', 'No state change', 'No', 'src/app/(protected)/monitoring/page.js:68', 'P1'),
  S('M-03', 'Monitoring', 'Dept scope', 'Team Lead', 'Scope', 'Two departments', 'Open /monitoring', '1. Login Team Lead 2. Open Monitoring', 'Own department only (API ?department=)', '200 filtered', 'No state change', 'No', 'src/app/(protected)/monitoring/page.js:72', 'P1'),
  S('M-04', 'Monitoring', 'Team scope', 'Team Admin', 'Scope', 'Same as M-03', 'Open /monitoring', '1. Login Team Admin 2. Open Monitoring', 'Own team only', '200 filtered', 'No state change', 'No', 'src/app/(protected)/monitoring/page.js:72', 'P1'),
  S('M-05', 'Monitoring', 'No access', 'Employee', 'Negative', 'Any', 'GET /api/monitoring/patterns', '1. Login Employee 2. Call API', 'Monitoring hidden in sidebar', '403', 'No state change', 'Yes', 'src/app/api/monitoring/patterns/route.js:18', 'P1'),
  S('M-06', 'Monitoring', 'No access', 'Intern', 'Negative', 'Any', 'GET /api/monitoring/patterns', '1. Login Intern 2. Call API', 'No access', '403', 'No state change', 'Yes', 'src/app/api/monitoring/patterns/route.js:18', 'P1'),
  S('M-07', 'Monitoring', 'No access', 'Recruiter', 'Negative', 'Any', 'GET /api/monitoring/patterns', '1. Login Recruiter 2. Call API', 'No access', '403', 'No state change', 'Yes', 'src/app/api/monitoring/patterns/route.js:18', 'P2'),
  S('M-08', 'Monitoring', 'No access', 'SME', 'Negative', 'Any', 'GET /api/monitoring/patterns', '1. Login SME 2. Call API', 'No access', '403', 'No state change', 'Yes', 'src/app/api/monitoring/patterns/route.js:18', 'P2'),
  S('M-09', 'Monitoring', 'Threshold parity', 'Super Admin', 'Workflow', 'No clock-in before halfDayThreshold', 'Open /monitoring + dashboard card', '1. Check before threshold 2. Compare both', 'Not Arrived (grey) on both; Absent (red) only after threshold', '200', 'No state change', 'No', 'src/app/(protected)/monitoring/page.js:157; src/app/api/dashboard/route.js:141', 'P1'),
  S('M-10', 'Monitoring', 'Pending permissions', 'Admin', 'Workflow', 'Pending permission exists', 'Toggle Show Late + Pending', '1. Open Monitoring 2. Toggle checkbox', 'Pending rows hidden by default with warning banner', '200', 'No state change', 'No', 'src/app/(protected)/monitoring/page.js:276', 'P2'),

  // ── Tasks (T) ──
  S('T-01', 'Tasks', 'Create', 'Super Admin', 'Workflow', 'Project exists', 'POST /api/tasks', '1. Login Super Admin 2. Create task for any user', 'Task created', '201', 'Task created', 'No', 'src/app/api/tasks/route.js:47', 'P1'),
  S('T-02', 'Tasks', 'Create', 'Team Lead', 'Workflow', 'Same-dept employee target', 'POST /api/tasks', '1. Login Team Lead 2. Assign to team_admin/employee/intern/sme same dept', 'Task created', '201', 'Task created', 'No', 'src/lib/rbac.js:148', 'P1'),
  S('T-03', 'Tasks', 'Create', 'Team Admin', 'Workflow', 'Same-dept employee target', 'POST /api/tasks', '1. Login Team Admin 2. Assign to employee/intern/sme same dept', 'Task created', '201', 'Task created', 'No', 'src/lib/rbac.js:148', 'P1'),
  S('T-04', 'Tasks', 'Create deny', 'Employee', 'Negative', 'Any', 'POST /api/tasks', '1. Login Employee 2. Create task', 'No New Task button', '403', 'No record', 'Yes', 'src/app/api/tasks/route.js:47', 'P1'),
  S('T-05', 'Tasks', 'Create deny', 'Intern', 'Negative', 'Any', 'POST /api/tasks', '1. Login Intern 2. Create task', 'Denied', '403', 'No record', 'Yes', 'src/app/api/tasks/route.js:47', 'P1'),
  S('T-06', 'Tasks', 'No access', 'Recruiter', 'Negative', 'Any', 'GET /api/tasks', '1. Login Recruiter 2. Call API', 'Module hidden', '403', 'No state change', 'Yes', 'src/app/api/tasks/route.js:14', 'P1'),
  S('T-07', 'Tasks', 'Create deny', 'SME', 'Negative', 'Any', 'POST /api/tasks', '1. Login SME 2. Create task', 'Denied', '403', 'No record', 'Yes', 'src/app/api/tasks/route.js:47', 'P2'),
  S('T-08', 'Tasks', 'View scope', 'Employee', 'Scope', 'Tasks assigned to self + others', 'GET /api/tasks', '1. Login Employee 2. List tasks', 'Only assignedTo=self rows', '200 filtered', 'No state change', 'No', 'src/app/api/tasks/route.js:24', 'P1'),
  S('T-09', 'Tasks', 'Assign rank guard', 'Team Admin', 'Negative', 'Target is team_lead (higher rank)', 'POST /api/tasks assign to lead', '1. Login Team Admin 2. Assign to Team Lead', 'Assignee list excludes lead', '403', 'No record', 'Yes', 'src/lib/rbac.js:156', 'P1'),
  S('T-10', 'Tasks', 'Recruiter assignee', 'Super Admin', 'Negative', 'Target is recruiter', 'POST /api/tasks assign to recruiter', '1. Login Super Admin 2. Assign to recruiter', 'Blocked', '403 (recruiter never assignee)', 'No record', 'Yes', 'src/lib/rbac.js:149', 'P2'),
  S('T-11', 'Tasks', 'Status move', 'Employee', 'Negative', 'Own assigned task', 'Move to Blocked/Completed', '1. Login Employee 2. Change status', 'Blocked/Completed buttons hidden', '403 if attempted', 'No change', 'Yes', 'src/app/(protected)/tasks/page.js:672', 'P2'),

  // ── Projects (PRJ) ──
  S('PRJ-01', 'Projects', 'Create', 'Super Admin', 'Workflow', 'Departments seeded', 'POST /api/projects', '1. Login Super Admin 2. Create project', 'Project approved immediately', '201 approvalStatus=approved', 'Project created', 'No', 'src/app/api/projects/route.js:41,110', 'P1'),
  S('PRJ-02', 'Projects', 'Create cross-dept', 'Team Lead', 'Workflow', 'Two departments selected', 'POST /api/projects cross-dept', '1. Login Team Lead 2. Create spanning departments', 'approvalRequired=true, status pending', '201 pending', 'Project pending; approvers notified', 'No', 'src/app/api/projects/route.js:55,110', 'P1'),
  S('PRJ-03', 'Projects', 'Approve', 'Admin', 'Workflow', 'Pending cross-dept project', 'POST /api/projects/approval approve', '1. Login Admin 2. Approve', 'Status approved', '200', 'approvalStatus=approved', 'No', 'src/app/api/projects/approval/route.js:54', 'P1'),
  S('PRJ-04', 'Projects', 'Approve deny', 'Team Lead', 'Negative', 'Pending project', 'POST /api/projects/approval approve', '1. Login Team Lead 2. Attempt approve', 'No approve button', '403', 'No change', 'Yes', 'src/app/api/projects/approval/route.js:54', 'P1'),
  S('PRJ-05', 'Projects', 'Resubmit', 'Team Admin', 'Workflow', 'Own rejected project', 'POST /api/projects/approval resubmit', '1. Login creator 2. Resubmit', 'Back to pending (creator only)', '200', 'approvalStatus=pending', 'No', 'src/app/api/projects/approval/route.js:85', 'P2'),
  S('PRJ-06', 'Projects', 'Responsible guard', 'Team Lead', 'Negative', 'Target recruiter/sme', 'POST /api/projects responsible=recruiter', '1. Login Team Lead 2. Create with recruiter responsible', 'Blocked', '400/403', 'No record', 'Yes', 'src/app/api/projects/route.js:97', 'P2'),
  S('PRJ-07', 'Projects', 'View scope', 'Employee', 'Scope', 'Assigned + unassigned projects', 'GET /api/projects', '1. Login Employee 2. List', 'Only team/created rows (assigned)', '200 filtered', 'No state change', 'No', 'src/app/api/projects/route.js:15', 'P1'),
  S('PRJ-08', 'Projects', 'No access', 'Recruiter', 'Negative', 'Any', 'GET /api/projects', '1. Login Recruiter 2. Call API', 'Module hidden', '403', 'No state change', 'Yes', 'src/app/api/projects/route.js:13', 'P1'),
  S('PRJ-09', 'Projects', 'View scope', 'Intern', 'Scope', 'Assigned project', 'GET /api/projects', '1. Login Intern 2. List', 'Assigned rows only', '200 filtered', 'No state change', 'No', 'src/app/api/projects/route.js:15', 'P2'),
  S('PRJ-10', 'Projects', 'Create', 'Admin', 'Workflow', 'Any', 'POST /api/projects', '1. Login Admin 2. Create project', 'Project created (never cross-dept for admins)', '201', 'Project created', 'No', 'src/app/api/projects/route.js:41', 'P2'),

  // ── Payroll (PY) ──
  S('PY-01', 'Payroll', 'Run payroll', 'Super Admin', 'Workflow', 'Salary structures + attendance in cycle', 'POST /api/payroll/run {month}', '1. Login Super Admin 2. Run payroll', 'Drafts generated; finalized/approved untouched', '200 processed/skipped', 'Payroll drafts (runId)', 'No', 'src/app/api/payroll/run/route.js:19', 'P1'),
  S('PY-02', 'Payroll', 'Run payroll', 'Admin', 'Workflow', 'Same as PY-01', 'POST /api/payroll/run {month}', '1. Login Admin 2. Run payroll', 'Same as Super Admin', '200', 'Drafts created', 'No', 'src/app/api/payroll/run/route.js:19', 'P1'),
  S('PY-03', 'Payroll', 'Run deny', 'Team Lead', 'Negative', 'Any', 'POST /api/payroll/run', '1. Login Team Lead 2. Run payroll', 'No Run button', '403', 'No payroll created', 'Yes', 'src/app/api/payroll/run/route.js:19', 'P1'),
  S('PY-04', 'Payroll', 'Run deny', 'Team Admin', 'Negative', 'Any', 'POST /api/payroll/run', '1. Login Team Admin 2. Run payroll', 'Denied', '403', 'No payroll created', 'Yes', 'src/app/api/payroll/run/route.js:19', 'P1'),
  S('PY-05', 'Payroll', 'Approve/Finalize', 'Admin', 'Workflow', 'Draft payrolls exist', 'POST /api/payroll/approve {approve|finalize}', '1. Login Admin 2. Approve then Finalize', 'Status draft->approved->finalized', '200', 'Statuses updated', 'No', 'src/app/api/payroll/approve/route.js:13', 'P1'),
  S('PY-06', 'Payroll', 'Rules/Structure', 'Team Lead', 'Negative', 'Any', 'GET/POST /api/payroll/rules', '1. Login Team Lead 2. Call API', 'Tabs hidden', '403', 'No change', 'Yes', 'src/app/api/payroll/rules/route.js:11', 'P2'),
  S('PY-07', 'Payroll', 'My payslip', 'Employee', 'Access', 'Own payroll generated', 'Open /payroll myslip', '1. Login Employee 2. View slip', 'Own slip only (query forced to self)', '200 self rows', 'No state change', 'No', 'src/app/api/payroll/route.js:16', 'P1'),
  S('PY-08', 'Payroll', 'My payslip', 'SME', 'Access', 'Own payroll generated', 'Open /payroll myslip', '1. Login SME 2. View slip', 'Own slip only', '200 self rows', 'No state change', 'No', 'src/app/api/payroll/route.js:16', 'P2'),
  S('PY-09', 'Payroll', 'No access', 'Intern', 'Negative', 'Any', 'GET /api/payroll', '1. Login Intern 2. Open payroll', 'Module hidden; API forces self (empty)', '200 empty (matrix false)', 'No state change', 'Yes', 'src/app/api/payroll/route.js:16', 'P1'),
  S('PY-10', 'Payroll', 'No access', 'Recruiter', 'Negative', 'Any', 'POST /api/payroll/run', '1. Login Recruiter 2. Run payroll', 'Denied', '403', 'No payroll created', 'Yes', 'src/app/api/payroll/run/route.js:19', 'P1'),

  // ── Core HR (C) ──
  S('C-01', 'Core HR', 'Directory read', 'Super Admin', 'Access', 'Identities + profiles seeded', 'GET /api/core/profiles', '1. Login Super Admin 2. Open Core HR', 'Full directory', '200 all', 'No state change', 'No', 'src/app/api/core/profiles/route.js:32', 'P1'),
  S('C-02', 'Core HR', 'Directory read', 'Admin', 'Access', 'Same as C-01', 'GET /api/core/profiles', '1. Login Admin 2. Open Core HR', 'Full directory', '200 all', 'No state change', 'No', 'src/app/api/core/profiles/route.js:32', 'P1'),
  S('C-03', 'Core HR', 'Directory read', 'Recruiter', 'Access', 'Same as C-01', 'GET /api/core/profiles', '1. Login Recruiter 2. Open Core HR', 'Read-only directory (view)', '200 all', 'No state change', 'No', 'src/app/api/core/profiles/route.js:32', 'P1'),
  S('C-04', 'Core HR', 'Directory scope', 'Team Lead', 'Scope', 'Two departments', 'GET /api/core/profiles', '1. Login Team Lead 2. Open directory', 'Own + accessible departments / reporting line', '200 filtered', 'No state change', 'No', 'src/app/api/core/profiles/route.js:50', 'P1'),
  S('C-05', 'Core HR', 'Directory scope', 'Team Admin', 'Scope', 'Same as C-04', 'GET /api/core/profiles', '1. Login Team Admin 2. Open directory', 'Scoped to team', '200 filtered', 'No state change', 'No', 'src/app/api/core/profiles/route.js:50', 'P2'),
  S('C-06', 'Core HR', 'Directory deny', 'Employee', 'Negative', 'Any', 'GET /api/core/profiles', '1. Login Employee 2. Call API', 'Core HR hidden', '403', 'No state change', 'Yes', 'src/app/api/core/profiles/route.js:32', 'P1'),
  S('C-07', 'Core HR', 'Directory deny', 'Intern', 'Negative', 'Any', 'GET /api/core/profiles', '1. Login Intern 2. Call API', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/core/profiles/route.js:32', 'P1'),
  S('C-08', 'Core HR', 'Directory deny', 'SME', 'Negative', 'Any', 'GET /api/core/profiles', '1. Login SME 2. Call API', 'Denied', '403', 'No state change', 'Yes', 'src/app/api/core/profiles/route.js:32', 'P1'),
  S('C-09', 'Core HR', 'Create profile', 'Admin', 'Workflow', 'Identity exists', 'POST /api/core/profiles', '1. Login Admin 2. Create profile', 'Profile created', '201', 'EmpProfile created', 'No', 'src/app/api/core/profiles/route.js:103', 'P1'),
  S('C-10', 'Core HR', 'Create deny', 'Team Lead', 'Negative', 'Any', 'POST /api/core/profiles', '1. Login Team Lead 2. Create profile', 'Denied', '403 (write roles only)', 'No record', 'Yes', 'src/app/api/core/profiles/route.js:103', 'P1'),
  S('C-11', 'Core HR', 'Privileged role grant', 'Team Lead', 'Negative', 'Any', 'PUT /api/core/profiles/:id {rbacRole:team_admin}', '1. Login Team Lead 2. Grant manager role', 'Role dropdown restricted', '403 (admins only)', 'No change', 'Yes', 'src/app/api/core/profiles/[id]/route.js:79', 'P1'),
  S('C-12', 'Core HR', 'Lifecycle transition', 'Team Lead', 'Workflow', 'Profile in probation, same dept', 'POST /api/core/lifecycle/transition confirm_probation', '1. Login Team Lead 2. Confirm probation', 'Transition applied', '200', 'Lifecycle event recorded', 'No', 'src/app/api/core/lifecycle/transition/route.js:117', 'P1'),
  S('C-13', 'Core HR', 'Lifecycle deny', 'Employee', 'Negative', 'Any', 'POST /api/core/lifecycle/transition', '1. Login Employee 2. Attempt transition', 'Denied', '403', 'No change', 'Yes', 'src/app/api/core/lifecycle/transition/route.js:117', 'P1'),
  S('C-14', 'Core HR', 'Self-service review', 'Admin', 'Workflow', 'Pending permission/profile request', 'GET+PUT /api/core/self-service-requests', '1. Login Admin 2. Review queue 3. Approve/Reject', 'Queue visible; decision recorded', '200', 'Request status updated', 'No', 'src/app/api/core/self-service-requests/route.js:209,277', 'P1'),
  S('C-15', 'Core HR', 'Self-service deny', 'Team Lead', 'Negative', 'Any', 'GET /api/core/self-service-requests', '1. Login Team Lead 2. Open review queue', 'Denied (write roles only)', '403', 'No state change', 'Yes', 'src/app/api/core/self-service-requests/route.js:209', 'P2'),
];

// Workflow annex tables
const TASK_ASSIGN = [
  ['Assigner \\ Assignee', 'Super Admin', 'Admin', 'Team Lead', 'Team Admin', 'Employee', 'Intern', 'SME', 'Recruiter'],
  ['Super Admin', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes (same any dept)', 'Yes', 'Yes', 'Never'],
  ['Admin', 'No (rank)', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Never'],
  ['Team Lead', 'No', 'No', 'No', 'Yes (own dept)', 'Yes (own dept)', 'Yes (own dept)', 'Yes (own dept)', 'Never'],
  ['Team Admin', 'No', 'No', 'No', 'No', 'Yes (own dept)', 'Yes (own dept)', 'Yes (own dept)', 'Never'],
];
const LEAVE_FLOW = [
  ['Step', 'Who acts', 'Gate', 'Outcome'],
  ['Apply', 'Employee/Intern/Recruiter/SME/Team roles (not Super Admin UI)', 'Policy eligibility, overlap, permission clash', 'pending + workflowApprovals built'],
  ['Admin step', 'Super Admin / Admin', 'Legacy: adminApproval pending; Dynamic: role in step approverRoles', 'approved / held (+reason) / rejected'],
  ['Team Admin step', 'Team Admin (same dept)', 'Legacy: admin approved + teamAdmin pending; Dynamic: step role', 'approved / held / rejected'],
  ['Team Lead step', 'Team Lead (same dept)', 'Legacy: admin approved + tl pending; Dynamic: step role', 'approved / held / rejected'],
  ['Override', 'Super Admin / Admin on held|rejected downstream', 'hasObjection(l) true', 'Override Approve / Reject'],
  ['Resolve', 'System', 'Any rejected -> rejected; any held -> pending; all approve -> approved', 'Final status + balance/attendance updates'],
];
const LIFECYCLE_FLOW = [
  ['Transition', 'Allowed roles', 'Gate', 'Outcome'],
  ['confirm_probation', 'Team Lead / Team Admin / Admins', 'Same dept or reporting line; status onboarding|probation', 'active'],
  ['start_notice / finalize_exit', 'Team Lead / Team Admin / Admins', 'Same dept; notice_period for finalize', 'separated (+ clearance)'],
  ['rehire', 'Team Lead / Team Admin / Admins', 'Separated profile (locked profiles only rehire)', 'Rehired profile'],
  ['Promote to privileged role', 'Super Admin / Admin only', 'CORE_HR_PRIVILEGED_ROLES target', '403 for team roles'],
];

// ── Workbook build ────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
wb.creator = 'HRMS QA';
wb.created = new Date();

const headerFill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } });
const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const thinBorder = {
  top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
};
function styleHeader(row, hex = '1E293B') {
  row.eachCell((c) => {
    c.fill = headerFill(hex);
    c.font = headerFont;
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = thinBorder;
  });
  row.height = 22;
}
function styleCell(c, opts = {}) {
  c.border = thinBorder;
  c.alignment = { vertical: 'top', wrapText: true, ...(opts.alignment || {}) };
  if (opts.font) c.font = opts.font;
  if (opts.fill) c.fill = opts.fill;
  if (opts.numFmt) c.numFmt = opts.numFmt;
}

// ── Sheet 0: Cover ──
{
  const ws = wb.addWorksheet('Cover & How to Run');
  ws.columns = [{ width: 26 }, { width: 120 }];
  const title = ws.addRow(['HRMS 2.0 — RBAC Test Scenarios']);
  title.font = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
  ws.addRow(['Generated', new Date().toISOString().slice(0, 10)]);
  ws.addRow(['Roles covered', 'Super Admin, Admin, Recruiter, Team Lead, Team Admin, Employee, Intern, SME (8)']);
  ws.addRow(['Modules covered', 'Dashboard, Employees, Absence, Leave, Leave Policies, Bulk Import, Monitoring, Tasks, Projects, Payroll, Core HR']);
  ws.addRow([]);
  const rh = ws.addRow(['Role', 'Label / color']);
  styleHeader(rh, '1E293B');
  for (const [label, code, hex] of ROLES) {
    const r = ws.addRow([label, code]);
    styleCell(r.getCell(1), { font: { bold: true, color: { argb: 'FF' + hex } } });
    styleCell(r.getCell(2));
  }
  ws.addRow([]);
  const hh = ws.addRow(['How to run', 'Steps']);
  styleHeader(hh, '1E293B');
  const steps = [
    ['1. Seed', 'Run reset-and-seed (scripts/reset-and-seed.mjs) so every role has an account in 2 departments + one cross-dept visibleDepartments case + one SME link.'],
    ['2. Login per role', 'POST /api/auth/login per role; keep 8 bearer tokens. curl: curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" -d \'{"email":"<role>@test.local","password":"<pwd>"}\''],
    ['3. Execute', 'Work Scenarios sheet top-to-bottom filtered by Module; record Result/Evidence per row.'],
    ['4. Negative checks', 'Expect HTTP 403 + fail("Access denied") body; assert no DB write (re-query list endpoint).'],
    ['5. Threshold checks', 'Absence/Monitoring threshold rows need a shift with halfDayThreshold=180 and clock-times before/after threshold on the same day.'],
  ];
  for (const [a, b] of steps) {
    const r = ws.addRow([a, b]);
    styleCell(r.getCell(1), { font: { bold: true } });
    styleCell(r.getCell(2));
  }
  ws.addRow([]);
  const conv = ws.addRow(['Conventions', 'Meaning']);
  styleHeader(conv, '1E293B');
  for (const [a, b] of [
    ['Positive', 'Action allowed; expect 200/201 + UI element visible'],
    ['Negative', 'Action denied; expect 403 + no state change'],
    ['Scope', 'Data sliced by getDepartmentUserIds / getAccessibleDepartments / self'],
    ['Trace', 'file:line pointer into the gate that enforces the expectation'],
  ]) {
    const r = ws.addRow([a, b]);
    styleCell(r.getCell(1), { font: { bold: true } });
    styleCell(r.getCell(2));
  }
}

// ── Sheet 1: Matrix (from MODULE_ACCESS — no drift) ──
{
  const ws = wb.addWorksheet('Matrix');
  const modules = [
    ['Dashboard', 'dashboard'],
    ['Employees', 'employees'],
    ['Absence', 'absence'],
    ['Leave', 'leave'],
    ['Leave Policies', 'settings'],
    ['Bulk Import', null],
    ['Monitoring', 'monitoring'],
    ['Tasks', 'tasks'],
    ['Projects', 'projects'],
    ['Payroll', 'payroll'],
    ['Core HR', 'core_hr'],
  ];
  const head = ws.addRow(['Module', ...ROLE_LABELS]);
  styleHeader(head, '1E293B');
  ws.columns = [{ width: 18 }, ...ROLE_LABELS.map(() => ({ width: 14 }))];
  for (const [label, key] of modules) {
    const cells = [label];
    const fills = [null];
    for (const [, code] of ROLES) {
      let v;
      let fill = null;
      if (key === null) {
        const admin = code === 'super_admin' || code === 'admin_full';
        v = admin ? 'full' : '—';
        fill = admin ? headerFill('DCFCE7') : headerFill('FEE2E2');
      } else {
        v = MODULE_ACCESS[key]?.[code];
        if (v === false || v === undefined) {
          v = '—';
          fill = headerFill('FEE2E2');
        } else {
          fill = headerFill('DCFCE7');
        }
      }
      cells.push(String(v));
      fills.push(fill);
    }
    const r = ws.addRow(cells);
    r.height = 20;
    r.eachCell((c, n) => {
      styleCell(c, { font: n === 1 ? { bold: true } : {}, alignment: { vertical: 'middle', horizontal: n === 1 ? 'left' : 'center', wrapText: true } });
      if (n > 1 && fills[n - 1]) c.fill = fills[n - 1];
    });
  }
  const note = ws.addRow(['Note: Bulk Import gate = BULK_ADMIN_ROLES (super_admin, admin_full) in src/lib/leave/bulk-helpers.js:7 — not part of MODULE_ACCESS. Leave Policies gate = settings key + ADMIN_ROLES in settings/leave-policies routes.']);
  ws.mergeCells(`A${note.number}:I${note.number}`);
  styleCell(note.getCell(1), { font: { italic: true, color: { argb: 'FF64748B' } } });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'I1' };
}

// ── Sheet 2: Scenarios ──
const RESULT_COL = 'O';
{
  const ws = wb.addWorksheet('Scenarios');
  const headers = ['SC-ID', 'Module', 'Sub-module', 'Role', 'Category', 'Precondition', 'Action (UI or API)', 'Steps', 'Expected — UI', 'Expected — HTTP', 'Expected — DB/State', 'Negative?', 'Trace', 'Priority', 'Result', 'Evidence', 'Notes'];
  const widths = [10, 14, 18, 13, 11, 26, 26, 30, 30, 22, 26, 10, 40, 9, 11, 16, 20];
  ws.columns = widths.map((w) => ({ width: w }));
  const hr = ws.addRow(headers);
  styleHeader(hr, '1E293B');
  const priFill = { P1: headerFill('DBEAFE'), P2: headerFill('FEF3C7'), P3: headerFill('F1F5F9') };
  for (const row of SCENARIOS) {
    const r = ws.addRow([...row, '', '', '']);
    r.height = 52;
    r.eachCell((c, n) => {
      styleCell(c, { font: n === 1 || n === 4 ? { bold: true, size: 10 } : { size: 10 } });
    });
    const pri = row[13];
    if (priFill[pri]) r.getCell(14).fill = priFill[pri];
    if (row[11] === 'Yes') r.getCell(12).fill = headerFill('FEE2E2');
  }
  const last = ws.rowCount;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `Q1` };
  ws.dataValidations.add(`D2:D${last}`, { type: 'list', formulae: [`"${ROLE_LABELS.join(',')}"`], showErrorMessage: true, errorTitle: 'Role', error: 'Pick a role from the list' });
  ws.dataValidations.add(`E2:E${last}`, { type: 'list', formulae: ['"Access,Scope,Workflow,Edge,Negative"'], showErrorMessage: true });
  ws.dataValidations.add(`L2:L${last}`, { type: 'list', formulae: ['"Yes,No"'], showErrorMessage: true });
  ws.dataValidations.add(`N2:N${last}`, { type: 'list', formulae: ['"P1,P2,P3"'], showErrorMessage: true });
  ws.dataValidations.add(`${RESULT_COL}2:${RESULT_COL}${last}`, { type: 'list', formulae: ['"Not run,Pass,Fail,Blocked"'], showErrorMessage: true });
  for (let i = 2; i <= last; i++) ws.getCell(`${RESULT_COL}${i}`).value = 'Not run';
}

// ── Sheet 3: Workflow Annex ──
{
  const ws = wb.addWorksheet('Workflow Annex');
  ws.columns = [{ width: 26 }, { width: 26 }, { width: 34 }, { width: 40 }, { width: 24 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 }];
  const putTable = (title, trace, table) => {
    const t = ws.addRow([title]);
    t.font = { bold: true, size: 13, color: { argb: 'FF0F172A' } };
    const tr = ws.addRow([trace]);
    tr.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    const h = ws.addRow(table[0]);
    styleHeader(h, '334155');
    for (const row of table.slice(1)) {
      const r = ws.addRow(row);
      r.eachCell((c, n) => styleCell(c, { font: n === 1 ? { bold: true, size: 10 } : { size: 10 } }));
    }
    ws.addRow([]);
  };
  putTable('A. Task assignment matrix (rank + department)', 'src/lib/rbac.js:148 canAssignTask; recruiter never assignee', TASK_ASSIGN);
  putTable('B. Leave approval flow', 'src/app/(protected)/leave/page.js:192 canActOn; src/app/api/leave/[id]/route.js', LEAVE_FLOW);
  putTable('C. Core HR lifecycle transitions', 'src/app/api/core/lifecycle/transition/route.js:117,248', LIFECYCLE_FLOW);
}

// ── Sheet 4: Execution Log ──
{
  const ws = wb.addWorksheet('Execution Log');
  ws.columns = [{ width: 22 }, { width: 16 }, { width: 60 }];
  const h = ws.addRow(['Metric', 'Value', 'Formula']);
  styleHeader(h, '1E293B');
  const last = 2 + SCENARIOS.length; // Scenarios data ends here (header row 1 + N rows)
  const rows = [
    ['Total scenarios', SCENARIOS.length, 'Count of Scenarios rows'],
    ['Pass', { formula: `COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Pass")` }, `=COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Pass")`],
    ['Fail', { formula: `COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Fail")` }, `=COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Fail")`],
    ['Blocked', { formula: `COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Blocked")` }, `=COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Blocked")`],
    ['Not run', { formula: `COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Not run")` }, `=COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Not run")`],
    ['Pass rate', { formula: `IFERROR(COUNTIF(Scenarios!${RESULT_COL}2:${RESULT_COL}${last},"Pass")/COUNTA(Scenarios!A2:A${last}),0)` }, 'Pass / Total'],
  ];
  for (const [a, b, c] of rows) {
    const r = ws.addRow([a, b, c]);
    styleCell(r.getCell(1), { font: { bold: true } });
    styleCell(r.getCell(2), { font: { bold: true }, numFmt: typeof b === 'number' ? undefined : undefined });
    styleCell(r.getCell(3), { font: { color: { argb: 'FF64748B' }, size: 10 } });
  }
  ws.getCell('B7').numFmt = '0.0%';
  const n = ws.addRow(['Run notes', '', 'Date / tester / environment per execution round']);
  styleCell(n.getCell(1), { font: { bold: true } });
  styleCell(n.getCell(2));
  styleCell(n.getCell(3));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
await wb.xlsx.writeFile(OUT_FILE);
console.log(`Wrote ${OUT_FILE} (${SCENARIOS.length} scenarios)`);
