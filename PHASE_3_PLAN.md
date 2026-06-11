# Phase 3 Plan

Phase 3 should focus on employee self-service, exit hardening, and migration depth. At this point the core model and lifecycle operations exist, so the next step is to make the new structure complete enough for day-to-day employee use while reducing reliance on the legacy employee document.

## Phase 3 goal

Build the employee self-service layer and complete the operational edges around the lifecycle model so the platform can handle routine employee use without forcing HR to operate everything manually.

## Phase 3 scope

### 1. Employee self-service dashboard

Add a dedicated employee-facing area for:

- viewing identity and employment profile details
- checking current employment status
- viewing manager and team reporting lines
- reviewing joined dates, probation status, and separation history where allowed
- viewing assigned documents and notices

### 2. Self-service lifecycle requests

Allow employees to initiate controlled requests for:

- profile edits to safe fields
- address changes
- emergency contact updates
- resignation requests
- rehire acknowledgment flows when applicable

### 3. Exit and offboarding workflow

Add proper handling for the final stage of employment:

- resignation submission
- termination approvals
- last working date capture
- final settlement status
- exit interview status
- clearance checklist
- record locking after finalization

### 4. Legacy module migration cleanup

Reduce reliance on the old combined employee record by progressively routing reads and writes through the new core model for:

- employee directory
- profile screens
- manager relationships
- status checks
- lifecycle summaries

### 5. Reporting and traceability

Add lifecycle reporting views that can answer:

- who changed status
- when a person transferred
- how often a person was rehired
- how many employees are in each lifecycle stage
- who is pending separation or confirmation

### 6. Security and access refinement

Extend the existing RBAC model where needed for:

- employee self-service access
- exit management access
- separation approval access
- audit visibility rules

## Recommended implementation order

1. Employee self-service routes and UI
2. Safe profile edit workflows
3. Resignation and exit routes
4. Clearance and final settlement records
5. Read-model migration away from legacy employee fields
6. Lifecycle reporting screens

## Phase 3 deliverables

- employee self-service page
- controlled profile update APIs
- resignation and separation request APIs
- offboarding UI for HR/admins
- lifecycle summary widgets and reports
- stricter post-exit record behavior

## Validation strategy

Every Phase 3 slice should be validated with:

- route-level authorization checks
- schema validation checks
- transition integrity checks
- audit/history entry verification
- compatibility checks against existing attendance, leave, payroll, and task modules

## Completion definition

Phase 3 is complete when an employee can self-manage safe data, request an exit cleanly, and the HR team can process the full separation lifecycle without falling back to the legacy employee document except for compatibility reads.