import { connectDB } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { BULK_ADMIN_ROLES, BULK_MAX_ROWS, resolveBulkEmployee } from '@/lib/leave/bulk-helpers';
import { resolvePolicyForUser, getOrCreateBalanceForYear } from '@/app/api/leave/balance/route';
import { Leave, Holiday, UserLeaveBalance, Document } from '@/lib/models/index';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import { getGlobalConfig, countWorkingDaysInRange, isWorkingDay } from '@/lib/payroll-cycle';
import { isEmployer } from '@/lib/permissions';
import { notify } from '@/lib/notify';

/** Fire-and-forget bell — summaries only, never blocks the import result. */
async function notifyBulkSafe(...args) {
  try { await notify(...args); } catch { /* non-fatal */ }
}

async function saveBalanceOrConflict(balance) {
  try {
    await balance.save();
  } catch (e) {
    if (e?.name === 'VersionError') {
      const err = new Error('Leave balance changed concurrently. Please retry.');
      err.statusCode = 409;
      throw err;
    }
    throw e;
  }
}

/**
 * Persist the Cloudinary-archived source file as an HR Document so the
 * original bulk file stays discoverable (Documents → HR) and deletable
 * via the existing trash flow. Non-fatal — never blocks the import result.
 */
async function saveBulkArchive({ type, mode, userId, cloudinary, fileName, committed }) {
  try {
    if (!cloudinary?.url || committed <= 0) return null;
    const ext = String(fileName || '').split('.').pop()?.toLowerCase() || 'xlsx';
    const stamp = new Date().toISOString().slice(0, 10);
    const doc = await Document.create({
      name: `Bulk Leave ${type === 'balance' ? 'Balance' : 'History'} (${mode}) — ${stamp}`,
      category: 'HR',
      fileUrl: cloudinary.url,
      fileType: ['xlsx', 'xls', 'csv'].includes(ext) ? ext : 'xlsx',
      mimeType: ext === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      access: 'admin',
      employeeId: null,
      expiry: null,
      cloudinaryPublicId: cloudinary.publicId || null,
      uploadedBy: userId,
    });
    return { documentId: String(doc._id), url: doc.fileUrl };
  } catch {
    return null;
  }
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!BULK_ADMIN_ROLES.includes(user.role)) return fail('Access denied', 403);
    await connectDB();

    const body = await req.json();
    const { type, mode, rows, cloudinary, fileName } = body || {};
    if (!['balance', 'leaves'].includes(type)) return fail('type must be balance or leaves', 400);
    if (!Array.isArray(rows) || rows.length === 0) return fail('rows[] from a validate preview is required', 400);
    if (rows.length > BULK_MAX_ROWS) return fail(`Max ${BULK_MAX_ROWS} rows per commit`, 400);
    const ip = req.headers.get('x-forwarded-for') || '';

    const committed = [];
    const failed = [];

    if (type === 'balance') {
      const m = String(mode || 'delta');
      if (!['delta', 'overwrite'].includes(m)) return fail('mode must be delta or overwrite', 400);

      for (const r of rows) {
        const d = r.data || {};
        const rowNum = r.rowNum ?? '?';
        try {
          const resolved = await resolveBulkEmployee({ employeeEmail: d.employeeEmail, employeeCode: d.employeeCode });
          if (resolved.error) throw new Error(resolved.error);
          const target = await User.findById(resolved.user._id).select('_id role');
          if (!target || isEmployer(target.role)) throw new Error('Employer accounts do not have leave balances');
          const policy = await resolvePolicyForUser(resolved.user);
          if (!policy) throw new Error('No active leave policy for this employee');
          const typeConfig = (policy.leaveTypeConfigs || []).find(c => c.code === d.typeCode);
          if (!typeConfig || !typeConfig.enabled) throw new Error(`Leave type ${d.typeCode} not enabled`);

          const balance = await getOrCreateBalanceForYear(resolved.user._id, policy, d.cycleYear);
          if (!balance) throw new Error('Could not resolve balance record');
          let entry = balance.balances.find(b => b.typeCode === d.typeCode);
          if (!entry) {
            balance.balances.push({
              typeCode: d.typeCode, allocated: 0, used: 0, pending: 0,
              carriedForward: 0, expiryDate: null, periodUsage: [],
            });
            entry = balance.balances.find(b => b.typeCode === d.typeCode);
          }

          if (m === 'delta') {
            entry.allocated = Math.max(0, Number((entry.allocated || 0) + Number(d.allocated || 0)));
            entry.used = Math.max(0, Number((entry.used || 0) + Number(d.used || 0)));
            entry.pending = Math.max(0, Number((entry.pending || 0) + Number(d.pending || 0)));
            entry.carriedForward = Math.max(0, Number((entry.carriedForward || 0) + Number(d.carriedForward || 0)));
          } else {
            // overwrite: absolute values; validate totals
            const a = Number(d.allocated || 0);
            const u = Number(d.used || 0);
            const p = Number(d.pending || 0);
            const c = Number(d.carriedForward || 0);
            if (a < 0 || u < 0 || p < 0 || c < 0) throw new Error('Values must be >= 0');
            if (u + p > a + c) throw new Error(`used+pending (${u + p}) exceeds allocated+carriedForward (${a + c})`);
            entry.allocated = a;
            entry.used = u;
            entry.pending = p;
            entry.carriedForward = c;
          }
          if (d.expiryDate) entry.expiryDate = new Date(`${d.expiryDate}T00:00:00`);
          await saveBalanceOrConflict(balance);
          committed.push({ rowNum, userId: String(resolved.user._id), typeCode: d.typeCode });
        } catch (e) {
          failed.push({ rowNum, error: e.statusCode === 409 ? 'Concurrent update — retry this row' : (e.message || 'Failed') });
        }
      }

      await auditLog(
        'Leave Balance Bulk Import', 'Leave', user._id,
        `${mode} import: ${committed.length} succeeded, ${failed.length} failed (${rows.length} rows)${cloudinary?.publicId ? `, Cloudinary: ${cloudinary.publicId}` : ''}`,
        'high', ip, null, null
      );
      const archive = await saveBulkArchive({ type, mode, userId: user._id, cloudinary, fileName, committed: committed.length });
      await notifyBulkSafe(
        user._id,
        'Bulk Leave Balances Imported',
        `${mode} — ${committed.length} succeeded, ${failed.length} failed${fileName ? ` — ${fileName}` : ''}`,
        'leave',
        archive?.documentId || null
      );
      return ok({ committed: committed.length, failed: failed.length, results: committed, errors: failed, archive });
    }

    // ── Leaves commit ──
    const leaveMode = String(mode || 'approved');
    if (!['approved', 'pending'].includes(leaveMode)) return fail('mode must be approved or pending', 400);
    const config = await getGlobalConfig();

    // Process sequentially per user to avoid VersionError contention
    const sorted = [...rows].sort((a, b) => String(a.data?.employeeEmail || a.data?.employeeCode || '').localeCompare(String(b.data?.employeeEmail || b.data?.employeeCode || '')));
    // First-step approver roles seen across rows (for one batched pending bell)
    const firstStepRoles = new Set();

    for (const r of sorted) {
      const d = r.data || {};
      const rowNum = r.rowNum ?? '?';
      try {
        const status = leaveMode; // file-level mode wins over per-row status for consistency
        const resolved = await resolveBulkEmployee({ employeeEmail: d.employeeEmail, employeeCode: d.employeeCode });
        if (resolved.error) throw new Error(resolved.error);
        if (isEmployer(resolved.user.role)) throw new Error('Employer accounts do not track leave');
        const fullUser = await User.findById(resolved.user._id).select('_id name role');
        if (!fullUser) throw new Error('Employee not found');

        const policy = await resolvePolicyForUser(resolved.user);
        if (!policy) throw new Error('No active leave policy for this employee');
        const typeConfig = (policy.leaveTypeConfigs || []).find(c => c.code === d.typeCode);
        if (!typeConfig || !typeConfig.enabled) throw new Error(`Leave type ${d.typeCode} not enabled`);

        const { from, to, reason } = d;
        if (!from || !to || !reason) throw new Error('from, to and reason are required');

        // Overlap guard (re-checked at commit time)
        const overlap = await Leave.findOne({
          userId: fullUser._id,
          status: { $in: ['pending', 'approved'] },
          from: { $lte: to },
          to: { $gte: from },
        }).lean();
        if (overlap) throw new Error(`Overlaps existing ${overlap.status} leave (${overlap.from} to ${overlap.to})`);

        const halfDay = !!d.halfDay;
        let days;
        if (halfDay) {
          days = 0.5;
        } else {
          const holidays = await Holiday.find({ date: { $gte: from, $lte: to } }).lean();
          days = countWorkingDaysInRange(from, to, config, holidays, {
            countWeekends: !!policy.countWeekends,
            countHolidays: !!policy.countHolidays,
          });
          if (typeConfig?.sandwichRule ?? policy.sandwichRule) {
            const calDays = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
            if (calDays > days && days > 0) days = calDays;
          }
          if (!(days > 0)) throw new Error('Dates contain only holidays/weekends');
        }

        let paidDays = d.paidDays !== null && d.paidDays !== undefined && d.paidDays !== '' ? Number(d.paidDays) : null;
        let unpaidDays = d.unpaidDays !== null && d.unpaidDays !== undefined && d.unpaidDays !== '' ? Number(d.unpaidDays) : null;
        if (paidDays === null || unpaidDays === null) {
          if (typeConfig.isPaid) { paidDays = days; unpaidDays = 0; }
          else { paidDays = 0; unpaidDays = days; }
        }

        const workflowDef = (typeConfig.useCustomWorkflow && typeConfig.approvalWorkflow?.length)
          ? typeConfig.approvalWorkflow
          : (policy.approvalWorkflow || []);
        const workflowApprovals = workflowDef.map(s => ({
          step: s.step, label: s.label || `Step ${s.step}`, action: 'pending',
          approvedBy: null, approvedAt: null, holdReason: '', actionType: s.actionType || 'approve',
        }));
        if (leaveMode === 'pending' && Array.isArray(workflowDef) && workflowDef[0]?.approverRoles) {
          for (const r of workflowDef[0].approverRoles) firstStepRoles.add(r);
        }

        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        const leave = await Leave.create({
          userId: fullUser._id,
          typeCode: d.typeCode,
          type: typeConfig.name,
          from, to, days, paidDays, unpaidDays,
          halfDay,
          halfDayType: halfDay ? d.halfDayType : null,
          reason,
          documents: [],
          policyId: policy._id,
          workflowApprovals,
          status,
          isRetroactive: from < todayStr,
          balanceApplied: false,
          adminApproval: status === 'approved' ? 'approved' : 'pending',
          teamAdminApproval: 'pending',
          tlApproval: 'pending',
        });

        // Balance movement
        const cycleYear = new Date(`${from}T00:00:00`).getFullYear();
        if (typeConfig.isPaid && paidDays > 0) {
          const balance = await getOrCreateBalanceForYear(fullUser._id, policy, cycleYear);
          if (balance) {
            const entry = balance.balances.find(b => b.typeCode === d.typeCode);
            if (entry) {
              if (status === 'approved') {
                entry.used = Number(entry.used || 0) + Number(paidDays);
                if (typeConfig.maxUsagePerPeriod > 0) {
                  const { recordPeriodUsage } = await import('@/lib/leave/accrual');
                  recordPeriodUsage(entry, typeConfig.usagePeriod, balance.cycleStart, new Date(`${from}T00:00:00`), paidDays);
                }
              } else {
                entry.pending = Number(entry.pending || 0) + Number(paidDays);
              }
              await saveBalanceOrConflict(balance);
            }
          }
        }
        if (status === 'approved') {
          leave.balanceApplied = true;
          await leave.save();
          // Attendance rows for working days
          try {
            const holidays = await Holiday.find({ date: { $gte: from, $lte: to } }).lean();
            const f = new Date(`${from}T00:00:00`);
            const t = new Date(`${to}T00:00:00`);
            for (let cur = new Date(f); cur <= t; cur.setDate(cur.getDate() + 1)) {
              const ds = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
              if (!isWorkingDay(ds, config, holidays)) continue;
              const isHalf = halfDay && from === to;
              await Attendance.findOneAndUpdate(
                { userId: fullUser._id, date: ds },
                { $set: { userId: fullUser._id, date: ds, status: isHalf ? 'half_day' : 'leave', relatedLeaveId: leave._id, approvedHalfDayLeave: isHalf } },
                { upsert: true, new: true }
              );
            }
          } catch { /* non-fatal */ }
        }

        committed.push({ rowNum, leaveId: String(leave._id), userId: String(fullUser._id) });
      } catch (e) {
        failed.push({ rowNum, error: e.statusCode === 409 ? 'Concurrent update — retry this row' : (e.message || 'Failed') });
      }
    }

    await auditLog(
      'Leave History Bulk Import', 'Leave', user._id,
      `${leaveMode} import: ${committed.length} succeeded, ${failed.length} failed (${rows.length} rows)${cloudinary?.publicId ? `, Cloudinary: ${cloudinary.publicId}` : ''}`,
      'high', ip, null, null
    );
    const archive = await saveBulkArchive({ type, mode: leaveMode, userId: user._id, cloudinary, fileName, committed: committed.length });
    await notifyBulkSafe(
      user._id,
      leaveMode === 'pending' ? 'Bulk Leave History Import — Pending' : 'Bulk Leave History Import — Approved',
      `${leaveMode} — ${committed.length} succeeded, ${failed.length} failed${fileName ? ` — ${fileName}` : ''}`,
      'leave',
      archive?.documentId || null
    );
    if (leaveMode === 'pending' && committed.length > 0 && firstStepRoles.size > 0) {
      try {
        const approverIds = await User.find(
          { role: { $in: [...firstStepRoles] }, status: 'active' },
          '_id'
        ).lean().then(docs => docs
          .map(d => String(d._id))
          .filter(id => id !== String(user._id)));
        if (approverIds.length > 0) {
          await notifyBulkSafe(
            approverIds,
            'Bulk Leave Import — Approvals Needed',
            `${committed.length} pending requests need your review${fileName ? ` — ${fileName}` : ''}`,
            'leave',
            archive?.documentId || null
          );
        }
      } catch { /* non-fatal */ }
    }
    return ok({ committed: committed.length, failed: failed.length, results: committed, errors: failed, archive });
  } catch (e) {
    return fail(e.message || 'Bulk commit failed', 500);
  }
}
