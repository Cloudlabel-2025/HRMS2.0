# Employee Module Guide

This project treats the employee record as the center of the HR lifecycle. A person starts in recruitment, becomes an employee after hiring, then moves through onboarding, attendance, leave, tasks, performance, documents, payroll, and finally an exit state. The codebase does not yet model a formal resignation or termination workflow, so this guide explains both what is implemented and what is still missing.

## 1. What the employee module actually is

There are two related records:

- `User` is the authentication and access-control record.
- `Employee` is the HR profile record used by the directory, profile page, attendance, leave, payroll, and reporting chain.

Creating an employee creates both records together, which means the employee module is not just a list of people. It is the profile layer that connects a logged-in user to everything they can do in the system.

## 2. Lifecycle from recruitment to exit

### Recruitment stage

Recruitment begins in the recruitment module, where jobs and applicants are managed.

- Job postings are created through `POST /api/recruitment/jobs`.
- Applicants are created through `POST /api/recruitment/applicants`.
- Applicants move through these stages: `Applied`, `Screening`, `Interview`, `Offer`, `Hired`, `Rejected`.
- When an applicant is moved to `Hired`, the person is ready to become an employee record.

Relevant files:

- [src/app/recruitment/page.js](src/app/recruitment/page.js)
- [src/app/api/recruitment/jobs/route.js](src/app/api/recruitment/jobs/route.js)
- [src/app/api/recruitment/applicants/route.js](src/app/api/recruitment/applicants/route.js)

### Employee creation and onboarding

Employees are created through `POST /api/employees`.

What happens at creation:

- A `User` auth record is created first.
- An `Employee` profile record is created second.
- If no password is supplied, the system generates a temporary password.
- `isFirstLogin` is set to `true`, which implies a first-login onboarding/reset flow.
- The employee starts with `status: active` unless another status is provided.
- The department is auto-created if it does not already exist.
- The department member count is incremented.

Relevant file:

- [src/app/api/employees/route.js](src/app/api/employees/route.js)

### Active employment

Once hired, the employee can participate in the working modules that make up daily HR operations:

- attendance clock-in and clock-out
- attendance regularization requests
- leave requests and approvals
- task assignment and status updates
- goal tracking and performance reviews
- document access
- payroll and payslips
- asset visibility in the profile view

Relevant employee-facing files:

- [src/app/employees/page.js](src/app/employees/page.js)
- [src/app/employees/[id]/page.js](src/app/employees/[id]/page.js)

### Exit state

There is no dedicated resignation or termination workflow in the codebase today.

What exists instead:

- The employee record can be updated to `inactive`.
- The delete action removes the `Employee` record and marks the linked `User` as `inactive`.
- The `User.status` field also supports `alumni`, but the current employee delete path does not use it.

That means the project currently supports deactivation, but not a formal offboarding lifecycle with resignation dates, termination reasons, final settlement, notice periods, or rehire rules.

Relevant file:

- [src/app/api/employees/[id]/route.js](src/app/api/employees/[id]/route.js)

## 3. What an employee can do day to day

This section is the practical part of the guide: the things an employee interacts with most often.

### Attendance

Employees can clock in and clock out from the attendance APIs.

- `POST /api/attendance/clock` handles clock in and clock out.
- The system blocks clock-in if the person is on approved leave for that date.
- Late arrivals are flagged after a 15 minute threshold past 9:00 AM.
- Attendance records are unique per user and day.
- Employees can also request attendance regularization for missed or corrected punches.

If a manager approves a regularization request, the system updates the underlying attendance record.

Relevant files:

- [src/app/api/attendance/clock/route.js](src/app/api/attendance/clock/route.js)
- [src/app/api/attendance/regularize/route.js](src/app/api/attendance/regularize/route.js)
- [src/lib/models/Attendance.js](src/lib/models/Attendance.js)

### Leave

Employees can request leave and track whether it is pending, approved, rejected, or held during review.

Important rules:

- Leave requests require a type, date range, days, and reason.
- An employee cannot submit a second pending leave while one is unresolved.
- Overlapping pending or approved leave requests are blocked.
- Interns are restricted to `Casual Leave` and `Sick Leave`.
- Approved leave reduces the employee leave balance unless it is `Loss of Pay`.
- If a leave is cancelled after approval, the balance is restored.

Approval flow:

- Admin approval is first.
- Team admin and team lead can then review and either approve, hold, or reject with reasons.
- Notifications are sent through the leave flow when status changes.

Relevant files:

- [src/app/api/leave/route.js](src/app/api/leave/route.js)
- [src/app/api/leave/[id]/route.js](src/app/api/leave/[id]/route.js)
- [src/lib/models/Leave.js](src/lib/models/Leave.js)
- [src/lib/models/User.js](src/lib/models/User.js)

### Tasks and delivery work

Tasks are a core everyday employee workflow.

- Managers can create tasks and assign them to employees.
- Team leads can only assign tasks to people in their own team.
- Employees and interns can only update the status of tasks assigned to them.
- Managers can update the full task record.

This means the module supports both collaborative work assignment and self-service task progress updates.

Relevant files:

- [src/app/api/tasks/route.js](src/app/api/tasks/route.js)
- [src/app/api/tasks/[id]/route.js](src/app/api/tasks/[id]/route.js)
- [src/lib/models/Task.js](src/lib/models/Task.js)

### Performance

Performance is split into goals and reviews.

- Employees can create and view goals for themselves.
- Managers can also create goals for employees.
- Reviews support self score, peer score, and manager score.
- The review API calculates an overall score from the available inputs.
- Team-admin, team-lead, admin_full, and super_admin roles can see broader team review data.

Relevant files:

- [src/app/performance/page.js](src/app/performance/page.js)
- [src/app/api/performance/goals/route.js](src/app/api/performance/goals/route.js)
- [src/app/api/performance/reviews/route.js](src/app/api/performance/reviews/route.js)
- [src/lib/models/index.js](src/lib/models/index.js)

### Documents

Documents are shared between HR and employees with access controls.

- Admins can upload documents.
- Employees can view documents that are marked `all` or targeted to their employee profile.
- Documents can be categorized as policy, employee, contract, HR, or other.

Relevant files:

- [src/app/api/documents/route.js](src/app/api/documents/route.js)
- [src/lib/models/index.js](src/lib/models/index.js)

### Payroll

Payroll is connected to attendance and leave.

- Admins can generate payroll for a month.
- The system pulls attendance records for the month.
- Approved leave is counted into paid leave when it is not loss of pay.
- Loss of pay is calculated from missing working days.
- Payroll moves through `pending` → `draft` → `approved` → `finalized`.
- Employees can view their own payroll records.

Relevant files:

- [src/app/api/payroll/route.js](src/app/api/payroll/route.js)
- [src/app/api/payroll/run/route.js](src/app/api/payroll/run/route.js)
- [src/app/api/payroll/approve/route.js](src/app/api/payroll/approve/route.js)
- [src/app/api/payroll/structure/route.js](src/app/api/payroll/structure/route.js)
- [src/lib/models/Payroll.js](src/lib/models/Payroll.js)

### Assets and profile data

The employee profile page also exposes related operational data:

- reporting chain: team admin and team lead
- leave balance
- recent leave requests
- attendance history
- assets assigned to the employee
- documents connected to the employee or uploaded by them
- payslips, when the role is allowed to see them

Relevant file:

- [src/app/api/employees/[id]/details/route.js](src/app/api/employees/[id]/details/route.js)

## 4. Employee profile screens

The employee UI is split into two main screens.

### Employee directory

The directory is the list view where HR and authorized managers can search, filter, add, edit, and toggle status.

It supports:

- searching by name, email, department, and designation
- department filtering
- status filtering
- role filtering
- directory and org-chart style views
- add employee flow with temporary password handling

Relevant file:

- [src/app/employees/page.js](src/app/employees/page.js)

### Employee profile

The profile view shows the person as a full HR entity, not just a name on a list.

It contains tabs for:

- overview
- attendance
- assets and documents
- payroll

It also shows:

- job title and department
- shift schedule
- skills and competencies
- reporting chain
- status badge
- contact details and joining date

Relevant file:

- [src/app/employees/[id]/page.js](src/app/employees/[id]/page.js)

## 5. Role-based access in plain English

Not every employee sees the same things.

- `super_admin` and `admin_full` have the broadest access.
- `recruiter` handles hiring and can access employee records in the employee module.
- `team_admin` and `team_lead` can see and manage their teams in scoped ways.
- `employee` and `intern` mainly see their own records, their assigned work, and self-service workflows.

The access matrix is enforced centrally in RBAC, so the same rules apply across the app.

Relevant file:

- [src/lib/rbac.js](src/lib/rbac.js)

## 6. Data model summary

The important fields to understand are:

- `User.status`: `active`, `inactive`, `alumni`
- `Employee.status`: `active`, `inactive`, `alumni`
- `Employee.leaveBalance`: leave days remaining
- `Leave.status`: `pending`, `approved`, `rejected`
- `Attendance.status`: `present`, `absent`, `late`, `leave`, `holiday`
- `Payroll.status`: `pending`, `draft`, `approved`, `finalized`

This is why the employee module feels broad: it is not one page, it is the backbone for several operational records.

## 7. What is missing today

If you are documenting the employee lifecycle for stakeholders, these gaps should be called out clearly:

- no formal resignation submission flow
- no termination reason or exit approval flow
- no notice-period tracking
- no final settlement or clearance workflow
- no rehire flow
- no explicit probation-to-confirmation state machine

The architecture notes in the repo already call this out as a lifecycle gap, so this is a real product limitation, not just a missing document.

## 8. Short version for non-technical readers

The employee module is the operational record of a worker in the company. Recruitment creates the person, the employee profile stores who they are inside the company, attendance and leave track presence, tasks and performance track work output, documents store HR paperwork, payroll handles compensation, and the profile page ties everything together. The current project supports active employment and deactivation, but not a fully modeled resignation or termination process.