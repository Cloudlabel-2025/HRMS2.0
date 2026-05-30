# Implementation Plan: Fixing Critical System Bugs

This plan outlines the steps to resolve the top-priority, critically broken issues in the HRMS application. By focusing on these first, we ensure data integrity, security, and basic system functionality.

> [!CAUTION]
> **User Review Required:**
> 1. **Forgot Password:** Currently, the system lacks an email package (like `nodemailer` or an API like Resend). Should I implement a basic reset link that is logged to the server console for now, or would you prefer I add an email provider?
> 2. **Login Rate Limiting:** I plan to implement a simple in-memory rate limiter (e.g., max 5 attempts per 15 mins per IP/email) to prevent brute force attacks. Is this acceptable, or do you want a database-backed solution (Redis/Mongo)?
> 3. **Payroll LOP (Loss of Pay):** I will fetch unapproved absences from the `Attendance` or `Leave` modules to calculate LOP days during a payroll run. Does your organization use a specific formula for LOP calculation?

## Proposed Changes

---

### Authentication & Security Fixes

#### [NEW] `src/app/api/auth/forgot-password/route.js`
- Create an endpoint that accepts an email, generates a unique reset token (saved to the user model with an expiry), and (pending your answer above) sends an email or logs the link.

#### [NEW] `src/app/api/auth/reset-password/route.js`
- Endpoint to accept the token and a new password, verify the token's validity and expiry, and update the user's password.

#### [NEW] `src/app/login/forgot-password/page.js` & `src/app/login/reset-password/page.js`
- Build the frontend UI for users to request a reset link and enter their new password.

#### [MODIFY] `src/app/api/auth/login/route.js`
- Implement an in-memory rate-limiting dictionary.
- Track failed attempts by email/IP. Lock the account or block the IP for 15 minutes after 5 failed attempts.

---

### Data Integrity: Leave & Finance

#### [MODIFY] `src/app/api/leave/[id]/route.js`
- **Leave Balance Deduction:** When a leave is fully approved by Management (`action === 'approved'` by `super_admin` or `admin_full`), calculate the number of days requested.
- Fetch the associated `User` document and decrement their `leaveBalance` by the calculated days.

#### [MODIFY] `src/app/api/finance/expenses/[id]/route.js`
- **Budget Sync:** When an expense is marked as `approved`, find the relevant `Budget` for the user's department and current year.
- Add the expense `amount` to the budget's `spent` field.

---

### Payroll Data Sync

#### [MODIFY] `src/app/api/payroll/run/route.js`
- **Attendance LOP Data:** Before calculating `netPay`, query the `Attendance` collection for the given month.
- Count the number of `absent` days (without an approved leave) and calculate the LOP deduction based on the employee's `basic` salary.

---

### Settings Persistence

#### [MODIFY] `src/app/settings/page.js`
- **General Tab:** Currently, the `Save Settings` button only shows a toast. Update the `onClick` handler to send a `PUT /api/settings` request with type `config` to save the global config (timezone, late threshold, etc.).
- **Notifications Tab:** Update the toggles to persist state to the database instead of being static UI elements.

#### [MODIFY] `src/app/api/settings/route.js`
- Ensure the `config` and `notifications` schema is properly mapped to `SystemConfig` so that the `PUT` endpoint updates the global system configuration correctly.

---

## Verification Plan

### Automated Tests
- N/A (Project does not currently have a test suite configured).

### Manual Verification
1. **Security:** Intentionally fail login 5 times and verify lockout. Test the full forgot-password flow.
2. **Leave Balance:** Submit a leave, approve it as Super Admin, and check the employee's leave balance card on the dashboard to ensure it decreased.
3. **Budget Sync:** Approve a $500 expense and verify the department budget's `spent` amount increases by $500.
4. **Settings Persistence:** Change the "Late Login Threshold" in settings, restart the Next.js development server, and verify the setting persists.
5. **Payroll:** Run payroll for a month where an employee has an absence, and verify LOP deductions appear on the generated payslip.
