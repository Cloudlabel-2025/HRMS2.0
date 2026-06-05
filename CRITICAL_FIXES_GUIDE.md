# HRMS CRITICAL FIXES - IMPLEMENTATION GUIDE

**Project**: Admin Panel 2.0 (HRMS)  
**Date**: May 31, 2026  
**Purpose**: Step-by-step fixes for broken modules

---

## PRIORITY 1: CRITICAL FIXES

### FIX #1: Leave Balance Deduction (Severity: CRITICAL)

**Problem**: When leave is approved, the employee's leave balance is NOT deducted. This allows unlimited leave applications.

**Location**: `src/app/api/leave/[id]/route.js`

**Current Issue**:
```javascript
// CURRENT - Missing leave balance update
export async function PUT(req) {
  // ... code ...
  const updated = await Leave.findByIdAndUpdate(id, { ...body }, { new: true });
  return ok(updated);
}
```

**Solution**:
```javascript
import dbConnect from '@/lib/db';
import Leave from '@/lib/models/Leave';
import User from '@/lib/models/User';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await dbConnect();

    const { id } = new URL(req.url).pathname.split('/').slice(-1);
    const body = await req.json();
    const leave = await Leave.findById(id);
    
    if (!leave) return fail('Leave not found', 404);

    // Get previous status to detect approval
    const previousStatus = leave.mgmtApproval;
    const newStatus = body.mgmtApproval;

    // Update leave record
    const updated = await Leave.findByIdAndUpdate(id, { ...body }, { new: true })
      .populate('userId', 'name email');

    // ✅ CRITICAL FIX: Deduct leave balance when approved
    if (newStatus === 'approved' && previousStatus !== 'approved') {
      const leaveUser = await User.findById(leave.userId);
      if (leaveUser) {
        const daysToDeduct = leave.days || 1;
        const newBalance = Math.max(0, leaveUser.leaveBalance - daysToDeduct);
        
        await User.findByIdAndUpdate(leave.userId, {
          leaveBalance: newBalance,
        });

        // Audit log
        await AuditLog.create({
          action: 'LEAVE_APPROVED_BALANCE_DEDUCTED',
          module: 'leave',
          userId: user._id,
          details: `Leave approved for ${leaveUser.name}. Balance deducted: ${daysToDeduct} days. New balance: ${newBalance}`,
          severity: 'low',
        });
      }
    }

    // If rejected, restore balance if it was previously approved
    if (newStatus === 'rejected' && previousStatus === 'approved') {
      const leaveUser = await User.findById(leave.userId);
      if (leaveUser) {
        const daysToRestore = leave.days || 1;
        await User.findByIdAndUpdate(leave.userId, {
          $inc: { leaveBalance: daysToRestore },
        });

        await AuditLog.create({
          action: 'LEAVE_REJECTED_BALANCE_RESTORED',
          module: 'leave',
          userId: user._id,
          details: `Leave rejected. Balance restored: ${daysToRestore} days`,
          severity: 'low',
        });
      }
    }

    return ok(updated);
  } catch (e) {
    return fail(e.message, 500);
  }
}
```

**Testing**:
```javascript
// Test case
1. Create employee with leaveBalance = 12
2. Apply for 2-day leave (from: 2024-06-15, to: 2024-06-16)
3. Approve leave as management
4. Check employee leaveBalance - should be 10
5. Reject the same leave
6. Check employee leaveBalance - should be 12 again
```

**Effort**: 1-2 hours
**Status**: ❌ Not Started

---

### FIX #2: Payroll LOP Calculation (Severity: CRITICAL)

**Problem**: Payroll doesn't calculate Loss of Pay (LOP) for unapproved absences. This results in incorrect salary calculations.

**Location**: `src/app/api/payroll/run/route.js`

**Current Issue**:
```javascript
// CURRENT - Missing LOP calculation
export async function POST(req) {
  // ... code ...
  const payroll = await Payroll.create({
    userId,
    month,
    basic,
    hra,
    gross: basic + hra,
    netPay: gross - deductions,
  });
}
```

**Solution**:
```javascript
import dbConnect from '@/lib/db';
import { Payroll, SalaryStructure } from '@/lib/models/Payroll';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import User from '@/lib/models/User';
import { Employee } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await dbConnect();

    const { month, employees } = await req.json();
    if (!month) return fail('Month is required (YYYY-MM)');

    const payrolls = [];
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    // Process each employee
    const empIds = employees || await Employee.find({ status: 'active' }).select('userId');

    for (const emp of empIds) {
      const userId = emp.userId || emp;
      const salaryStructure = await SalaryStructure.findOne({ userId });
      
      if (!salaryStructure) continue; // Skip if no salary structure

      const { basic, hra, allowances, pf, esi, tds } = salaryStructure;
      
      // ✅ CRITICAL FIX: Calculate LOP from attendance
      const startDate = `${month}-01`;
      const endDate = `${month}-${daysInMonth}`;

      // Get unapproved absences (without approved leave)
      const absences = await Attendance.find({
        userId,
        date: { $gte: startDate, $lte: endDate },
        status: 'absent',
      });

      // Get approved leaves for this month
      const approvedLeaves = await Leave.find({
        userId,
        status: 'approved',
        from: { $lte: endDate },
        to: { $gte: startDate },
      });

      // Count leave days
      let leaveCount = 0;
      for (const leave of approvedLeaves) {
        const leaveStart = new Date(leave.from);
        const leaveEnd = new Date(leave.to);
        const leaveRange = Math.ceil((leaveEnd - leaveStart) / (1000 * 60 * 60 * 24)) + 1;
        leaveCount += leaveRange;
      }

      // Absence days = total absences - approved leave days
      const lopDays = Math.max(0, absences.length - leaveCount);

      // ✅ LOP Calculation
      const lossPay = (basic / daysInMonth) * lopDays;

      // Calculate gross salary
      const gross = basic + hra + (allowances || 0);

      // Calculate total deductions
      const totalDeductions = (pf || 0) + (esi || 0) + (tds || 0) + lossPay;

      // Calculate net pay
      const netPay = gross - totalDeductions;

      // Create payroll record
      const payroll = await Payroll.create({
        userId,
        month,
        basic,
        hra,
        allowances: allowances || 0,
        gross,
        pf: pf || 0,
        esi: esi || 0,
        tds: tds || 0,
        lossPay, // ✅ NEW FIELD
        lopDays, // ✅ NEW FIELD
        totalDeductions,
        netPay,
        status: 'pending',
        generatedBy: user._id,
        comments: `Generated for ${month}. LOP Days: ${lopDays}, LOP Amount: ₹${lossPay.toFixed(2)}`,
      });

      payrolls.push(payroll);

      // Audit log
      await AuditLog.create({
        action: 'PAYROLL_GENERATED',
        module: 'payroll',
        userId: user._id,
        details: `Payroll generated for ${month}. Employee: ${userId}, LOP Days: ${lopDays}, Net Pay: ₹${netPay}`,
        severity: 'medium',
      });
    }

    return ok({ payrolls, count: payrolls.length }, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}
```

**Database Schema Update**:
```javascript
// Add to Payroll schema in src/lib/models/Payroll.js
const PayrollSchema = new mongoose.Schema({
  // ... existing fields ...
  lossPay: { type: Number, default: 0 },      // ✅ NEW
  lopDays: { type: Number, default: 0 },      // ✅ NEW
  totalDeductions: { type: Number, default: 0 }, // ✅ NEW
  // ... rest of schema ...
});
```

**Testing**:
```javascript
// Test case
1. Employee: John (basic = 30000)
2. Month: June 2024 (30 days)
3. Absences: 5 days without approved leave
4. Run payroll
5. Check: 
   - lopDays = 5
   - lossPay = (30000/30) * 5 = 5000
   - Net Pay should include 5000 deduction
```

**Effort**: 4-5 hours
**Status**: ❌ Not Started

---

### FIX #3: Settings Persistence (Severity: CRITICAL)

**Problem**: Settings changes are not saved to the database. All changes are lost on server restart.

**Location**: 
- Backend: `src/app/api/settings/route.js`
- Frontend: `src/app/settings/page.js`

**Backend Fix**:
```javascript
import dbConnect from '@/lib/db';
import { Department, Shift, Holiday, SystemConfig } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';

const MODEL_MAP = {
  departments: Department,
  shifts: Shift,
  holidays: Holiday,
  config: SystemConfig,
};

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await dbConnect();

    const type = new URL(req.url).searchParams.get('type');
    if (!MODEL_MAP[type]) return fail('Invalid type', 400);

    const data = await MODEL_MAP[type].find();
    return ok(data);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await dbConnect();

    const { type, id, ...body } = await req.json();
    if (!MODEL_MAP[type]) return fail('Invalid type', 400);

    // ✅ FIXED: Proper update logic
    if (type === 'config') {
      // For config, use key-value pattern
      const doc = await SystemConfig.findOneAndUpdate(
        { key: body.key || id },
        { key: body.key, value: body.value, updatedAt: new Date() },
        { new: true, upsert: true }
      );
      return ok(doc);
    } else {
      // For other types, update by id
      if (!id) return fail('ID is required', 400);
      const doc = await MODEL_MAP[type].findByIdAndUpdate(id, body, { new: true });
      if (!doc) return fail('Record not found', 404);
      return ok(doc);
    }
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await dbConnect();

    const { type, ...body } = await req.json();
    if (!MODEL_MAP[type]) return fail('Invalid type', 400);

    const doc = await MODEL_MAP[type].create(body);
    return ok(doc, 201);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await dbConnect();

    const { type, id } = await req.json();
    if (!MODEL_MAP[type] || type === 'config') return fail('Invalid type', 400);
    if (!id) return fail('ID is required', 400);
    
    await MODEL_MAP[type].findByIdAndDelete(id);
    return ok({ message: 'Deleted successfully' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
```

**Frontend Fix** (Settings Page):
```javascript
// In settings/page.js - Update save handler

const handleSaveGeneralSettings = async () => {
  try {
    setSaving(true);
    
    // Save each setting individually
    const settingsToSave = [
      { key: 'timeZone', value: generalSettings.timeZone },
      { key: 'lateThreshold', value: generalSettings.lateThreshold },
      { key: 'workHours', value: generalSettings.workHours },
      { key: 'attendanceFormat', value: generalSettings.attendanceFormat },
    ];

    for (const setting of settingsToSave) {
      await api.put('/api/settings', {
        type: 'config',
        id: setting.key,
        key: setting.key,
        value: setting.value,
      });
    }

    showToast('Settings saved successfully!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setSaving(false);
  }
};

const handleSaveNotifications = async () => {
  try {
    setSaving(true);

    const notifSettings = [
      { key: 'emailOnLeaveApproval', value: notifications.emailOnLeaveApproval },
      { key: 'emailOnPayroll', value: notifications.emailOnPayroll },
      { key: 'emailOnAttendance', value: notifications.emailOnAttendance },
      { key: 'emailOnTasks', value: notifications.emailOnTasks },
    ];

    for (const setting of notifSettings) {
      await api.put('/api/settings', {
        type: 'config',
        id: setting.key,
        key: setting.key,
        value: setting.value,
      });
    }

    showToast('Notification settings saved!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    setSaving(false);
  }
};
```

**Effort**: 2 hours
**Status**: ❌ Not Started

---

### FIX #4: Email Service Integration (Severity: CRITICAL)

**Problem**: Password reset emails are not sent. Reset links only logged to console.

**Location**: `src/app/api/auth/forgot-password/route.js`

**Installation**:
```bash
npm install nodemailer dotenv
```

**.env.local** (Add):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@hrms.com
APP_URL=http://localhost:3000
```

**Solution**:
```javascript
import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import { ok, fail } from '@/lib/jwt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

// Initialize email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendResetEmail(email, resetToken) {
  try {
    const resetUrl = `${process.env.APP_URL}/login/reset-password?token=${resetToken}&email=${email}`;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Password Reset Request - HRMS',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>We received a request to reset your password. Click the link below to set a new password:</p>
          <p><a href="${resetUrl}" style="background: #3b82f6; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Reset Password</a></p>
          <p>Or copy this link: ${resetUrl}</p>
          <p>This link will expire in 15 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr>
          <p style="color: #999; font-size: 12px;">HRMS - Human Resource Management System</p>
        </div>
      `,
    });
    
    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

export async function POST(req) {
  try {
    const { email } = await req.json();
    if (!email) return fail('Email is required');

    await dbConnect();
    const user = await User.findOne({ email });
    
    // Always return same message to prevent email enumeration
    if (!user) {
      return ok({ message: 'If an account with that email exists, we sent a password reset link.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 mins

    await user.save();

    // ✅ Send email
    const emailSent = await sendResetEmail(email, resetToken);

    if (!emailSent) {
      console.warn('Failed to send email, but token was generated');
    }

    // Log for debugging (in production, remove this)
    console.log(`Password reset requested for ${email}`);

    return ok({
      message: 'If an account with that email exists, we sent a password reset link.',
      sent: emailSent,
    });
  } catch (e) {
    console.error('Forgot password error:', e);
    return fail(e.message, 500);
  }
}
```

**Effort**: 4-6 hours (including testing)
**Status**: ❌ Not Started

---

### FIX #5: Missing Invoice Routes (Severity: CRITICAL)

**Problem**: Invoice update endpoint is missing, preventing edit/status changes.

**Location**: `src/app/api/finance/invoices/[id]/route.js` (CREATE THIS FILE)

**Solution**:
```javascript
import { connectDB } from '@/lib/db';
import { Invoice } from '@/lib/models/index';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { AuditLog } from '@/lib/models/index';

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    await connectDB();

    const id = new URL(req.url).pathname.split('/').pop();
    const invoice = await Invoice.findById(id).populate('createdBy', 'name');
    
    if (!invoice) return fail('Invoice not found', 404);
    return ok(invoice);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function PUT(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await connectDB();

    const id = new URL(req.url).pathname.split('/').pop();
    const body = await req.json();

    const invoice = await Invoice.findByIdAndUpdate(id, body, { new: true })
      .populate('createdBy', 'name');

    if (!invoice) return fail('Invoice not found', 404);

    // Audit log
    await AuditLog.create({
      action: 'INVOICE_UPDATED',
      module: 'finance',
      userId: user._id,
      details: `Invoice ${invoice.invoiceNo} updated. Status: ${body.status}`,
      severity: 'low',
    });

    return ok(invoice);
  } catch (e) {
    return fail(e.message, 500);
  }
}

export async function DELETE(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    
    await connectDB();

    const id = new URL(req.url).pathname.split('/').pop();
    const invoice = await Invoice.findByIdAndDelete(id);

    if (!invoice) return fail('Invoice not found', 404);

    // Audit log
    await AuditLog.create({
      action: 'INVOICE_DELETED',
      module: 'finance',
      userId: user._id,
      details: `Invoice ${invoice.invoiceNo} deleted`,
      severity: 'medium',
    });

    return ok({ message: 'Invoice deleted successfully' });
  } catch (e) {
    return fail(e.message, 500);
  }
}
```

**Effort**: 1-2 hours
**Status**: ❌ Not Started

---

## IMPLEMENTATION CHECKLIST

### Phase 1: Critical Fixes (Week 1)
- [ ] Fix Leave Balance Deduction
  - [ ] Update `/api/leave/[id]` route
  - [ ] Add user balance deduction logic
  - [ ] Add audit logging
  - [ ] Test with 3 scenarios

- [ ] Fix Payroll LOP Calculation
  - [ ] Update Payroll schema
  - [ ] Update `/api/payroll/run` route
  - [ ] Implement attendance query
  - [ ] Test LOP calculation

- [ ] Fix Settings Persistence
  - [ ] Update `/api/settings` routes
  - [ ] Update Settings page component
  - [ ] Test settings save/load

- [ ] Setup Email Service
  - [ ] Install nodemailer
  - [ ] Configure SMTP
  - [ ] Update forgot-password endpoint
  - [ ] Test email sending

- [ ] Add Invoice Routes
  - [ ] Create `/api/finance/invoices/[id]/route.js`
  - [ ] Implement GET, PUT, DELETE
  - [ ] Add audit logging
  - [ ] Test CRUD operations

### Phase 2: Testing (Week 1-2)
- [ ] Unit tests for each fix
- [ ] Integration tests
- [ ] End-to-end tests
- [ ] User acceptance testing
- [ ] Security audit

### Phase 3: Deployment (Week 2)
- [ ] Deploy to staging
- [ ] Final testing
- [ ] Deploy to production
- [ ] Monitor for issues

---

## ROLLBACK PLAN

If issues arise:
1. Identify which fix caused the issue
2. Revert the specific route/component
3. Redeploy
4. Re-run tests
5. Investigate root cause

---

## MONITORING & VALIDATION

After fixes are deployed:

```javascript
// Validate Leave Balance Fix
db.users.find({ leaveBalance: { $gt: 24 } }) // Should be 0 (max is 24)
db.leaves.find({ status: 'approved' }).count() // Cross-check with user balance changes

// Validate Payroll LOP Fix
db.payrolls.find({ month: '2024-06' }).forEach(p => {
  console.log(`Employee: ${p.userId}, LOP Days: ${p.lopDays}, LOP Amount: ${p.lossPay}`);
})

// Validate Settings Fix
db.systemconfigs.find() // Should have all configs

// Validate Email Fix
// Check email logs: Check SMTP_USER inbox for test emails

// Validate Invoice Routes
// Test: POST, GET, PUT, DELETE on /api/finance/invoices/[id]
```

---

## SUCCESS CRITERIA

- [ ] Leave balance decreases by approved leave days
- [ ] Payroll includes LOP calculations
- [ ] Settings save and persist after server restart
- [ ] Password reset emails sent successfully
- [ ] Invoice endpoints fully functional
- [ ] No data loss during fixes
- [ ] All audit logs created
- [ ] No breaking changes to existing functionality

