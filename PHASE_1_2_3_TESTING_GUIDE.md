# Phase 1 to Phase 3 Testing Guide

This guide explains how to verify the UI and API changes introduced across Phases 1, 2, and 3.

## Before you start

- Ensure `MONGODB_URI` is configured in `.env.local`.
- Start the app and sign in with a `super_admin` or `admin_full` account for full-path verification.
- Use a second `employee` account to validate self-service behavior.

## Phase 1 verification: Core identity and data layer

### What to check

- New identity and employment profile records can be created.
- PAN and Aadhaar values are masked and hashed through the privacy helpers.
- Lifecycle history entries are written for create and update actions.
- Auth user records stay linked to the new identity/profile records.

### API checks

1. Create a core identity with `POST /api/core/identities`.
2. Create an employment profile with `POST /api/core/profiles` using the returned identity id.
3. Fetch profiles with `GET /api/core/profiles` and confirm the record appears.
4. Fetch lifecycle entries with `GET /api/core/lifecycle` and confirm the create event exists.
5. Update the identity with `PUT /api/core/identities/:id` and confirm another history entry is written.

### UI checks

- Open the sidebar and confirm the `Core HR` entry is visible for authorized users.
- Open `/core-hr` and confirm the lifecycle workspace loads.

### Pass criteria

- No validation errors.
- Identity and profile are linked.
- Audit and lifecycle entries exist.

## Phase 2 verification: Employment lifecycle operations

### What to check

- Probation confirmation updates the profile to `active`.
- Transfers change department, designation, and reporting line data.
- Promotions update the designation and compensation snapshot.
- Rehire increments the rehire counter and resets the employment state.
- Suspension and separation write lifecycle history and update user status.

### API checks

1. Open `/core-hr` as an HR/admin user.
2. Select an active or probation profile.
3. Run a probation confirmation transition and confirm the status changes to `active`.
4. Run a transfer and verify the department and designation update.
5. Run a separation and confirm the profile status changes correctly for the selected separation type.
6. Open `GET /api/core/lifecycle?profileId=:id` and verify the transition entries appear.

### UI checks

- Open `/core-hr`.
- Confirm the profile list loads.
- Confirm the action buttons and the history panel refresh after each transition.

### Pass criteria

- UI actions save successfully.
- The profile list refreshes.
- Lifecycle entries are recorded.
- The auth user and legacy employee state stay aligned.

## Phase 3 verification: Self-service and HR review

### What to check

- Employees can open their own profile page.
- Employees can submit safe profile requests.
- Employees can submit resignation requests.
- HR can review pending requests from a queue.
- Approved resignation requests update the lifecycle state.

### Employee UI checks

1. Sign in as an `employee` or `intern`.
2. Open `/self-service`.
3. Confirm the current profile snapshot is visible.
4. Submit a profile update request.
5. Submit an address or emergency contact request.
6. Submit a resignation request.
7. Confirm the request history updates with pending entries.

### HR UI checks

1. Sign in as `super_admin` or `admin_full`.
2. Open `/core-hr/requests`.
3. Confirm pending self-service requests are listed.
4. Approve a profile update request and verify the identity updates.
5. Approve a resignation request and verify the profile changes to separated and the auth user becomes inactive.

### API checks

1. `GET /api/self-service/me` should return the signed-in employee's identity, profile, and requests.
2. `POST /api/self-service/requests` should create a pending request.
3. `GET /api/core/self-service-requests?status=pending` should list pending requests for HR.
4. `PUT /api/core/self-service-requests` should approve or reject a request.

### Pass criteria

- Employees can create requests without seeing other employees' data.
- HR can review and close requests.
- Approved resignation requests write lifecycle history and deactivate the user.

## Practical debugging checklist

- If a page does not load, confirm the route exists and the user has access in RBAC.
- If a request fails validation, check the payload against `src/lib/validation.js`.
- If data updates but the UI does not refresh, reload the page and check the API response.
- If history is missing, inspect `emp_lifecycle_histories` in MongoDB Compass.

## What a working system looks like

- Phase 1: identity, employment profile, and history records are created and linked.
- Phase 2: HR can move employees through lifecycle states.
- Phase 3: employees can make safe requests and HR can review them.

## Suggested test roles

- `super_admin` for full-path testing.
- `admin_full` for lifecycle and request approvals.
- `team_lead` or `team_admin` for scoped Phase 2 access.
- `employee` for self-service testing.

## Manual testing scenarios

Use these scenarios to verify that each phase works end to end, not just at the API level.

### Phase 1 scenarios: Core identity and data layer

#### Scenario 1: Create a new employee identity

- Role: `super_admin` or `admin_full`
- Steps:
	1. Open the core identity creation flow.
	2. Enter legal name, preferred name, email, phone, DOB, and gender.
	3. Add address and emergency contact details.
	4. Submit the form.
- Expected result:
	- The identity is created successfully.
	- A display name or legal name is shown in the UI.
	- The record appears in the identity list.
	- A lifecycle history entry is created.

#### Scenario 2: Create an employment profile for the identity

- Role: `super_admin` or `admin_full`
- Steps:
	1. Open the employment profile creation flow.
	2. Select the identity created in Scenario 1.
	3. Enter employee type, department, designation, location, and reporting line.
	4. Submit the form.
- Expected result:
	- The profile is created and linked to the identity.
	- An employee number is generated.
	- The profile shows an initial status such as probation or active.
	- The profile appears in the core HR list.

#### Scenario 3: Verify sensitive fields are protected

- Role: `super_admin` or `admin_full`
- Steps:
	1. Open the created identity record.
	2. Enter PAN and Aadhaar values if the form supports them.
	3. Save the record.
	4. Reopen the record and inspect the displayed values.
- Expected result:
	- Sensitive values are not shown in full in normal UI fields.
	- Masked or sanitized values are visible instead.
	- The stored data remains usable for later updates.

#### Scenario 4: Confirm legacy auth linkage

- Role: `super_admin`
- Steps:
	1. Create or open the linked auth user.
	2. Verify the user record is connected to the new identity and profile.
	3. Change the identity display name or profile designation.
	4. Refresh the user view or related summary panel.
- Expected result:
	- The auth user stays linked to the HR records.
	- The updated name, department, or designation is reflected consistently.

### Phase 2 scenarios: Lifecycle transitions

#### Scenario 1: Confirm probation completion

- Role: `admin_full` or `super_admin`
- Steps:
	1. Open `/core-hr`.
	2. Select a profile that is still in probation.
	3. Choose the probation confirmation transition.
	4. Submit the transition.
- Expected result:
	- The profile status changes to `active`.
	- A lifecycle record is written.
	- The updated status is visible in the profile list.

#### Scenario 2: Transfer an employee

- Role: `admin_full` or `super_admin`
- Steps:
	1. Select an active profile.
	2. Open the transfer action.
	3. Change department, designation, or reporting manager.
	4. Save the transition.
- Expected result:
	- The profile reflects the new department or reporting line.
	- The change appears in the lifecycle history.
	- The UI refreshes with the new values.

#### Scenario 3: Promote an employee

- Role: `admin_full` or `super_admin`
- Steps:
	1. Open the promotion action for an active profile.
	2. Update the designation and compensation snapshot.
	3. Save the transition.
- Expected result:
	- The designation changes.
	- The compensation snapshot updates.
	- A promotion event is added to lifecycle history.

#### Scenario 4: Rehire a separated employee

- Role: `super_admin`
- Steps:
	1. Open a separated profile.
	2. Select the rehire action.
	3. Confirm the rehire details.
	4. Submit the form.
- Expected result:
	- The employment state returns to active or probation depending on configuration.
	- The rehire count increases.
	- The original hire date is preserved or restored according to the form rules.

#### Scenario 5: Suspend and separate an employee

- Role: `super_admin`
- Steps:
	1. Open an active profile.
	2. Apply a suspension transition.
	3. Then apply a separation transition with a valid reason.
	4. Confirm the final state.
- Expected result:
	- Suspension is logged in history.
	- Separation updates the employment status.
	- The linked auth user becomes inactive if the workflow requires it.

### Phase 3 scenarios: Self-service and HR review

#### Scenario 1: Employee opens their own profile page

- Role: `employee`
- Steps:
	1. Sign in as the employee.
	2. Open `/self-service`.
	3. Review the snapshot panel and request history.
- Expected result:
	- Only the signed-in employee's information is visible.
	- The page loads without access errors.
	- The current requests list is visible.

#### Scenario 2: Employee updates contact details

- Role: `employee`
- Steps:
	1. Open the profile update form.
	2. Change preferred name or phone number.
	3. Submit the request.
	4. Refresh the page.
- Expected result:
	- A pending request appears in request history.
	- The underlying identity does not change until HR approves it.
	- The request can be reviewed from the HR queue.

#### Scenario 3: Employee updates address or emergency contact

- Role: `employee`
- Steps:
	1. Open the address or emergency contact form.
	2. Add a new address or contact entry.
	3. Submit the request.
- Expected result:
	- The request is stored as pending.
	- HR can see the submitted changes in the review queue.

#### Scenario 4: Employee submits resignation

- Role: `employee`
- Steps:
	1. Open the resignation form.
	2. Enter the reason, notice period, and last working date if required.
	3. Submit the request.
- Expected result:
	- The resignation request is marked pending.
	- The request history shows the resignation entry.
	- The employee can no longer directly finalize the separation.

#### Scenario 5: HR reviews and approves a request

- Role: `super_admin` or `admin_full`
- Steps:
	1. Open `/core-hr/requests`.
	2. Find the pending employee request.
	3. Review the details and approve it.
	4. Reload the employee profile page.
- Expected result:
	- The request moves from pending to approved.
	- The employee record updates only after approval.
	- The history trail includes the approval action.

#### Scenario 6: HR rejects an invalid request

- Role: `super_admin` or `admin_full`
- Steps:
	1. Open `/core-hr/requests`.
	2. Select a request that should not be approved.
	3. Reject it with a short reason.
- Expected result:
	- The request becomes rejected.
	- No identity or profile data is changed.
	- The employee can still see the rejected status in request history.

## End-to-end acceptance scenarios

Run these after all three phases to confirm the system behaves as one flow.

#### Scenario 1: New hire to active employee

- Create a new identity.
- Create an employment profile.
- Confirm probation.
- Verify the employee appears as active in the core HR view.

#### Scenario 2: Employee self-service update approved by HR

- Sign in as an employee.
- Submit a contact update request.
- Sign in as HR.
- Approve the request.
- Confirm the identity record reflects the change.

#### Scenario 3: Employee resignation workflow

- Sign in as an employee.
- Submit a resignation request.
- Sign in as HR.
- Approve the request.
- Confirm the profile is separated and the auth user is inactive.

#### Scenario 4: Audit trace completeness

- Create or change an identity.
- Update a profile.
- Apply a lifecycle transition.
- Submit and approve a self-service request.
- Confirm all four actions appear in history or audit logs.

## Quick pass/fail checklist

- Identity creation works.
- Profile creation works.
- Lifecycle transitions work.
- Self-service requests work.
- HR approval and rejection work.
- Sensitive fields are masked.
- Legacy auth/user links stay synchronized.
- Audit and lifecycle history records are written.
