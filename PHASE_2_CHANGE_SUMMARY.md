# Phase 2 Change Summary

Phase 2 extended the new decoupled HR core into a working employment lifecycle operations layer. Phase 1 introduced the new identity/profile/history data model; Phase 2 made that model actionable by adding lifecycle transitions, scoped visibility, and a management UI for operational HR changes.

## What was added

### 1. RBAC extension for lifecycle operations

The existing RBAC structure was kept intact. I added one new module key, `core_hr`, in both the server-side and client-side access matrices so the new lifecycle screens and APIs can be permissioned cleanly without introducing a second authorization system.

Relevant files:

- [src/lib/rbac.js](src/lib/rbac.js)
- [src/lib/auth.js](src/lib/auth.js)

### 2. Lifecycle transition API

A production route was added at `POST /api/core/lifecycle/transition` to handle the core employment state transitions:

- probation confirmation
- department or reporting-line transfer
- promotion
- rehire
- suspension
- separation

This endpoint validates each action, checks scope, mutates the profile state, syncs the auth user, updates the legacy employee record for backward compatibility, and writes an append-only lifecycle record.

Relevant file:

- [src/app/api/core/lifecycle/transition/route.js](src/app/api/core/lifecycle/transition/route.js)

### 3. Scoped core profile listing

The core profile list endpoint was tightened so non-admin managers can only see profiles they should control. Search and filter behavior was preserved while keeping the result set constrained by department and reporting-line scope.

Relevant file:

- [src/app/api/core/profiles/route.js](src/app/api/core/profiles/route.js)

### 4. Lifecycle management UI

A new operating screen was added for HR and managers to manage lifecycle actions from one place. It provides:

- profile selection
- current employment snapshot
- action picker
- action-specific form fields
- recent lifecycle history

Relevant file:

- [src/app/core-hr/page.js](src/app/core-hr/page.js)

### 5. Navigation exposure

The new lifecycle operations screen was surfaced in the app sidebar through the existing module navigation structure.

Relevant file:

- [src/components/Sidebar.js](src/components/Sidebar.js)

## Functional behavior delivered

### Employment lifecycle states

The new layer now models the working transitions after hiring:

- onboarding -> active through probation confirmation
- active -> transferred or promoted
- active -> suspended
- active or suspended -> separated
- separated -> rehired

### Data synchronization

When a lifecycle transition occurs, the system now keeps the following aligned:

- `UsrIdentity`
- `EmpProfile`
- `User`
- legacy `Employee` record
- append-only `EmpLifecycleHistory`

### Audit and history

Every mutation path now writes a lifecycle history record with:

- actor user
- actor role
- event type
- from state and to state
- reason
- structured change list
- request metadata

## Validation notes

All touched files were validated and no syntax errors were reported on the final pass.

## Implementation notes

- The existing RBAC design was considered good enough to reuse and extend.
- No parallel authorization model was introduced.
- The Phase 2 workflow intentionally preserves compatibility with the legacy employee module while the new model becomes the primary lifecycle source.

## Outcome

Phase 2 turned the identity/profile foundation into a usable HR operations layer. The project can now support lifecycle-driven employment changes instead of only static employee records.