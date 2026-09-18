import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import {
  BULK_ADMIN_ROLES,
  BULK_MAX_ROWS,
  BULK_MAX_BYTES,
  parseCsvBuffer,
  parseXlsxBuffer,
  rowsToObjects,
  resolveBulkEmployee,
  coerceDateStr,
  isValidDateStr,
  coerceNumber,
  coerceBool,
} from '@/lib/leave/bulk-helpers';
import { resolvePolicyForUser } from '@/app/api/leave/balance/route';
import { Leave, Holiday, UserLeaveBalance } from '@/lib/models/index';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { getGlobalConfig, countWorkingDaysInRange } from '@/lib/payroll-cycle';
import { isEmployer } from '@/lib/permissions';
import { uploadFile } from '@/lib/cloudinary';
import { auditLog } from '@/lib/middleware';
import { calculatePeriodAllowance } from '@/lib/leave/accrual';

const BULK_FOLDER = process.env.CLOUDINARY_BULK_FOLDER || 'hrms_bulk_leaves';

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!BULK_ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    const form = await req.formData();
    const file = form.get('file');
    const type = String(form.get('type') || 'balance').trim();
    let skipEligibility = String(form.get('skipEligibility') || '') === '1';
    // Gate skipEligibility to super_admin with audit — mirrors single POST which never skips
    if (skipEligibility && user.role !== 'super_admin') {
      return fail('Skip eligibility is restricted to super_admin', 403);
    }
    if (skipEligibility) {
      await auditLog('Bulk Leave Validate Skip Eligibility', 'Leave', user._id, 'super_admin bypassed eligibilityRules on bulk validate preview', 'high', req.headers.get('x-forwarded-for') || '', null, null);
    }
    if (!['balance', 'leaves'].includes(type)) return fail('type must be balance or leaves', 400);
    if (!file || typeof file.arrayBuffer !== 'function') return fail('Excel/CSV file is required', 400);
    if (file.size > BULK_MAX_BYTES) return fail('File must be under 3 MB (split into smaller files)', 400);

    const name = String(file.name || '').toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    let headers = [];
    let rawRows = [];
    if (name.endsWith('.csv')) {
      const parsed = parseCsvBuffer(buf);
      headers = parsed.headers;
      rawRows = parsed.rows;
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const parsed = await parseXlsxBuffer(buf);
      headers = parsed.headers;
      rawRows = parsed.rows;
    } else {
      return fail('Only .xlsx, .xls or .csv files are accepted', 400);
    }

    if (!headers.length) return fail('Could not read header row. Use the downloaded template.', 400);
    if (rawRows.length === 0) return fail('File has no data rows', 400);
    if (rawRows.length > BULK_MAX_ROWS) return fail(`Max ${BULK_MAX_ROWS} rows per file. Split and retry.`, 400);

    // ── Archive the source file to Cloudinary (non-blocking; audit trail) ──
    let cloudinaryFile = null;
    let cloudinaryError = null;
    try {
      const up = await uploadFile(buf, {
        fileName: String(file.name || `leave-${type}-bulk`),
        folder: BULK_FOLDER,
      });
      cloudinaryFile = { url: up.url, publicId: up.publicId };
    } catch (e) {
      cloudinaryError = e?.message || 'Cloudinary archive failed';
    }

    const objects = rowsToObjects(headers, rawRows, type);
    const results = [];

    if (type === 'balance') {
      const seen = new Set();
      for (const obj of objects) {
        const errors = [];
        const warnings = [];
        const email = String(obj.employeeEmail ?? '').trim();
        const code = String(obj.employeeCode ?? '').trim();
        const typeCode = String(obj.typeCode ?? '').trim().toUpperCase();
        const reason = String(obj.reason ?? '').trim();

        const resolved = await resolveBulkEmployee({ employeeEmail: email, employeeCode: code });
        let targetUser = null;
        let policy = null;
        if (resolved.error) {
          errors.push(resolved.error);
        } else {
          targetUser = resolved.user;
          if (targetUser.status !== 'active') warnings.push(`Employee is ${targetUser.status}`);
          if (isEmployer(targetUser.role)) {
            errors.push('Employer accounts do not have leave balances');
          } else {
            policy = await resolvePolicyForUser(targetUser);
            if (!policy) errors.push('No active leave policy found for this employee');
          }
        }

        if (!typeCode) errors.push('typeCode is required');
        let typeConfig = null;
        if (policy && typeCode) {
          typeConfig = (policy.leaveTypeConfigs || []).find(c => c.code === typeCode);
          if (!typeConfig || !typeConfig.enabled) errors.push(`Leave type ${typeCode} is not enabled in policy ${policy.name}`);
        }

        const nums = {};
        for (const f of ['allocated', 'used', 'pending', 'carriedForward']) {
          const raw = obj[f];
          if (raw === '' || raw === null || raw === undefined) { nums[f] = 0; continue; }
          const n = coerceNumber(raw);
          if (Number.isNaN(n) || n < 0) errors.push(`${f} must be a number >= 0`);
          else nums[f] = Math.round(n * 100) / 100;
        }

        let expiryDate = '';
        if (obj.expiryDate !== '' && obj.expiryDate !== null && obj.expiryDate !== undefined) {
          expiryDate = coerceDateStr(obj.expiryDate);
          if (!isValidDateStr(expiryDate)) errors.push('expiryDate must be YYYY-MM-DD');
        }

        let cycleYear = new Date().getFullYear();
        if (obj.cycleYear !== '' && obj.cycleYear !== null && obj.cycleYear !== undefined) {
          const y = coerceNumber(obj.cycleYear);
          if (!Number.isInteger(y) || y < 2000 || y > 2100) errors.push('cycleYear must be a valid year');
          else cycleYear = y;
        }

        if (!reason || reason.length < 5) errors.push('reason is required (min 5 characters)');
        else if (reason.length > 500) errors.push('reason must be under 500 characters');

        if (typeConfig && !typeConfig.carryForwardAllowed && nums.carriedForward > 0) {
          errors.push(`Carry forward is not allowed for ${typeCode}`);
        }
        if (typeConfig && typeConfig.carryForwardAllowed && typeConfig.carryForwardMaxDays > 0 && nums.carriedForward > typeConfig.carryForwardMaxDays) {
          errors.push(`carriedForward exceeds max ${typeConfig.carryForwardMaxDays} for ${typeCode}`);
        }

        if (targetUser && typeCode) {
          const key = `${targetUser._id}:${typeCode}:${cycleYear}`;
          if (seen.has(key)) errors.push('Duplicate row for same employee + type + year in this file');
          else seen.add(key);
        }

        results.push({
          rowNum: obj.__rowNum,
          data: {
            employeeEmail: email, employeeCode: code, typeCode,
            allocated: nums.allocated ?? 0, used: nums.used ?? 0,
            pending: nums.pending ?? 0, carriedForward: nums.carriedForward ?? 0,
            expiryDate, cycleYear, reason,
          },
          user: targetUser ? { _id: String(targetUser._id), name: targetUser.name, email: targetUser.email } : null,
          policyName: policy?.name || null,
          errors,
          warnings,
        });
      }
    } else {
      // ── Leaves validation ──
      const config = await getGlobalConfig();
      const seenRanges = [];
      for (const obj of objects) {
        const errors = [];
        const warnings = [];
        const email = String(obj.employeeEmail ?? '').trim();
        const code = String(obj.employeeCode ?? '').trim();
        const typeCode = String(obj.typeCode ?? '').trim().toUpperCase();
        const reason = String(obj.reason ?? '').trim();

        const resolved = await resolveBulkEmployee({ employeeEmail: email, employeeCode: code });
        let targetUser = null;
        let policy = null;
        if (resolved.error) {
          errors.push(resolved.error);
        } else {
          targetUser = resolved.user;
          if (targetUser.status !== 'active') warnings.push(`Employee is ${targetUser.status}`);
          if (isEmployer(targetUser.role)) {
            errors.push('Employer accounts do not track leave');
          } else {
            policy = await resolvePolicyForUser(targetUser);
            if (!policy) errors.push('No active leave policy found for this employee');
          }
        }

        if (!typeCode) errors.push('typeCode is required');
        let typeConfig = null;
        if (policy && typeCode) {
          typeConfig = (policy.leaveTypeConfigs || []).find(c => c.code === typeCode);
          if (!typeConfig || !typeConfig.enabled) errors.push(`Leave type ${typeCode} is not enabled in policy ${policy?.name || ''}`);
        }

        const from = coerceDateStr(obj.from);
        const to = coerceDateStr(obj.to);
        if (!isValidDateStr(from)) errors.push('from must be YYYY-MM-DD');
        if (!isValidDateStr(to)) errors.push('to must be YYYY-MM-DD');
        if (isValidDateStr(from) && isValidDateStr(to) && to < from) errors.push('to must be on or after from');

        let halfDay = false;
        const hb = coerceBool(obj.halfDay);
        if (hb === null) errors.push('halfDay must be TRUE or FALSE');
        else halfDay = hb;
        let halfDayType = String(obj.halfDayType ?? '').trim();
        if (halfDay) {
          if (from !== to) errors.push('Half-day leave must be a single day (from = to)');
          if (!['first_half', 'second_half'].includes(halfDayType)) errors.push('halfDayType must be first_half or second_half when halfDay is TRUE');
          if (typeConfig && !typeConfig.allowHalfDay) errors.push(`${typeCode} does not allow half-day leaves`);
        } else if (halfDayType) {
          warnings.push('halfDayType ignored because halfDay is FALSE');
          halfDayType = '';
        }

        if (!reason || reason.length < 5) errors.push('reason is required (min 5 characters)');
        else if (reason.length > 500) errors.push('reason must be under 500 characters');

        const status = String(obj.status ?? 'approved').trim().toLowerCase() || 'approved';
        if (!['approved', 'pending'].includes(status)) errors.push('status must be approved or pending');

        let paidDays = null;
        let unpaidDays = null;
        if (obj.paidDays !== '' && obj.paidDays !== null && obj.paidDays !== undefined) {
          paidDays = coerceNumber(obj.paidDays);
          if (Number.isNaN(paidDays) || paidDays < 0) errors.push('paidDays must be a number >= 0');
        }
        if (obj.unpaidDays !== '' && obj.unpaidDays !== null && obj.unpaidDays !== undefined) {
          unpaidDays = coerceNumber(obj.unpaidDays);
          if (Number.isNaN(unpaidDays) || unpaidDays < 0) errors.push('unpaidDays must be a number >= 0');
        }

        // Eligibility (gender + dynamic rules)
        if (targetUser && typeConfig && !skipEligibility) {
          try {
            const { buildEmployeeContext, evaluateEligibility } = await import('@/lib/leave/eligibility');
            const ctx = await buildEmployeeContext(targetUser._id);
            if (typeConfig.genderRestriction && typeConfig.genderRestriction !== 'all') {
              const g = String(ctx.gender || '').toLowerCase();
              if (['male', 'paternity'].includes(typeConfig.genderRestriction) && g !== 'male') {
                errors.push(`This leave type is only for male employees`);
              }
              if (['female', 'maternity'].includes(typeConfig.genderRestriction) && g !== 'female') {
                errors.push(`This leave type is only for female employees`);
              }
            }
            const elig = evaluateEligibility(typeConfig.eligibilityRules, ctx);
            if (!elig.eligible) errors.push(`Not eligible: ${elig.failedRule}`);
          } catch (e) {
            warnings.push(`Eligibility check skipped: ${e.message}`);
          }
        }

        // Overlap with existing DB leaves
        if (targetUser && isValidDateStr(from) && isValidDateStr(to)) {
          try {
            const overlap = await Leave.findOne({
              userId: targetUser._id,
              status: { $in: ['pending', 'approved'] },
              from: { $lte: to },
              to: { $gte: from },
            }).select('_id from to status').lean();
            if (overlap) errors.push(`Overlaps existing ${overlap.status} leave (${overlap.from} to ${overlap.to})`);
          } catch { /* non-fatal */ }
          // Overlap within file
          const clash = seenRanges.find(r => r.uid === String(targetUser._id) && !(to < r.from || from > r.to));
          if (clash) errors.push(`Overlaps row ${clash.rowNum} in this file (${clash.from} to ${clash.to})`);
          else seenRanges.push({ uid: String(targetUser._id), from, to, rowNum: obj.__rowNum });
        }

        // Compute expected working days for preview
        let computedDays = null;
        if (policy && isValidDateStr(from) && isValidDateStr(to) && !halfDay) {
          try {
            const holidays = await Holiday.find({ date: { $gte: from, $lte: to } }).lean();
            computedDays = countWorkingDaysInRange(from, to, config, holidays, {
              countWeekends: !!policy.countWeekends,
              countHolidays: !!policy.countHolidays,
            });
            if (computedDays <= 0) warnings.push('Dates contain only holidays/weekends (0 working days)');
          } catch { /* non-fatal */ }
        } else if (halfDay && isValidDateStr(from)) {
          computedDays = 0.5;
        }

        // ── Dynamic policy gates (mirror single POST /api/leave) ──
        if (policy && typeConfig && isValidDateStr(from) && isValidDateStr(to) && computedDays > 0) {
          const days = computedDays;
          // 1. Probation gate
          try {
            if (policy.requireProbationCompletion && targetUser) {
              const prof = targetUser.profileId
                ? await EmpProfile.findById(targetUser.profileId).select('employmentStatus').lean()
                : null;
              if (prof && ['onboarding', 'probation'].includes(prof.employmentStatus)) {
                errors.push('Must complete probation before applying under this policy');
              }
            }
          } catch { /* non-fatal */ }
          // 2. Per-half-day granularity
          if (halfDay) {
            if (halfDayType === 'first_half' && typeConfig.allowFirstHalf === false) errors.push('First Half is not enabled for this leave type');
            if (halfDayType === 'second_half' && typeConfig.allowSecondHalf === false) errors.push('Second Half is not enabled for this leave type');
          }
          // 3. Advance notice
          if ((typeConfig.noticePeriodDays || 0) > 0) {
            const today0 = new Date(); today0.setHours(0, 0, 0, 0);
            const from0 = new Date(`${from}T00:00:00`);
            const diffDays = Math.ceil((from0 - today0) / 86400000);
            if (diffDays < typeConfig.noticePeriodDays) errors.push(`Requires ${typeConfig.noticePeriodDays} days advance notice (applied with ${diffDays} day(s))`);
          }
          // 4. Supporting documents
          const needsDocs = !!typeConfig.requiresDocuments || ((typeConfig.requireDocsIfConsecutiveDays || 0) > 0 && days >= typeConfig.requireDocsIfConsecutiveDays);
          if (needsDocs) errors.push(`Supporting documents required for ${typeConfig.name}${typeConfig.requireDocsIfConsecutiveDays > 0 ? ` (${typeConfig.requireDocsIfConsecutiveDays}+ days)` : ''} — attach via single apply`);
          // 5. Max consecutive
          if ((typeConfig.maxConsecutiveDays || 0) > 0 && days > typeConfig.maxConsecutiveDays) errors.push(`Maximum ${typeConfig.maxConsecutiveDays} consecutive days allowed for ${typeConfig.name}`);
          // 6. Max pending applications (policy-level)
          if ((policy.maxPendingApplications || 0) > 0 && targetUser) {
            try {
              const pendingCount = await Leave.countDocuments({ userId: targetUser._id, status: 'pending' });
              if (pendingCount >= policy.maxPendingApplications) errors.push(`Already has ${pendingCount} pending application(s). Max ${policy.maxPendingApplications} allowed.`);
            } catch { /* non-fatal */ }
          }
          // 7. Min gap between same-type approved leaves
          if ((typeConfig.minGapDays || 0) > 0 && targetUser) {
            try {
              const recent = await Leave.findOne({ userId: targetUser._id, typeCode, status: 'approved', to: { $lt: from } }).sort({ to: -1 }).select('to').lean();
              if (recent) {
                const gap = Math.ceil((new Date(`${from}T00:00:00`) - new Date(`${recent.to}T00:00:00`)) / 86400000) - 1;
                if (gap < typeConfig.minGapDays) errors.push(`Minimum ${typeConfig.minGapDays} day(s) gap required between ${typeConfig.name} applications`);
              }
            } catch { /* non-fatal */ }
          }
          // 8. Period cap + overall availability (paid split preview)
          if (typeConfig.isPaid && targetUser) {
            try {
              const yr = new Date(`${from}T00:00:00`).getFullYear();
              const bal = await UserLeaveBalance.findOne({ userId: targetUser._id, cycleStart: new Date(yr, 0, 1) }).lean();
              if (bal) {
                const entry = (bal.balances || []).find(b => b.typeCode === typeCode);
                if (entry) {
                  const allowed = calculatePeriodAllowance(typeConfig, entry, bal.cycleStart, new Date(`${from}T00:00:00`));
                  const overall = Math.max(0, (entry.allocated || 0) + (entry.carriedForward || 0) - (entry.used || 0) - (entry.pending || 0));
                  const allowedPaid = Math.min(overall, allowed);
                  if (days > allowedPaid) {
                    const unpaid = Number((days - allowedPaid).toFixed(2));
                    warnings.push(`Only ${allowedPaid} of ${days} day(s) paid under ${policy.name} (period/overall cap); ${unpaid} unpaid (LOP)`);
                  }
                }
              }
            } catch { /* non-fatal */ }
          }
          // 9. Permission-vs-leave mutual exclusion
          try {
            const { SelfServiceRequest } = await import('@/lib/models/index');
            const permConflict = await SelfServiceRequest.findOne({
              profileId: targetUser.profileId || undefined,
              requestType: 'permission',
              status: { $in: ['pending', 'approved'] },
              'payload.date': { $gte: from, $lte: to },
            }).lean();
            if (permConflict) errors.push(`Overlaps ${permConflict.status} permission request on ${permConflict.payload?.date}`);
          } catch { /* non-fatal */ }
        }

        results.push({
          rowNum: obj.__rowNum,
          data: {
            employeeEmail: email, employeeCode: code, typeCode, from, to,
            halfDay, halfDayType: halfDay ? halfDayType : '',
            reason, status, paidDays, unpaidDays,
          },
          user: targetUser ? { _id: String(targetUser._id), name: targetUser.name, email: targetUser.email } : null,
          policyName: policy?.name || null,
          computedDays,
          errors,
          warnings,
        });
      }
    }

    const valid = results.filter(r => r.errors.length === 0).length;
    return ok({
      total: results.length,
      valid,
      invalid: results.length - valid,
      rows: results,
      cloudinary: cloudinaryFile,
      cloudinaryError,
    });
  } catch (e) {
    return fail(e.message || 'Validation failed', 500);
  }
}
