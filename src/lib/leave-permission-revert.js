import { SelfServiceRequest } from '@/lib/models/index';
import Attendance from '@/lib/models/Attendance';
import User from '@/lib/models/User';
import { notify } from '@/lib/notify';
import { auditLog } from '@/lib/middleware';

/** Expand an inclusive YYYY-MM-DD range into a date array. */
export function expandDates(from, to) {
  const out = [];
  try {
    const d = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    while (d <= end) {
      out.push(
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
      );
      d.setDate(d.getDate() + 1);
    }
  } catch { /* return what we have */ }
  return out;
}

/**
 * Revert (cancel + refund) permission requests colliding with an approved
 * FULL-DAY leave. A day holds either a leave or a permission, never both —
 * leave wins, so every approved/pending permission on the leave dates is
 * cancelled, its minutes returned to the monthly allowance (allowance
 * accounting only counts approved/pending requests), and everyone is told.
 *
 * @param {Object} args
 * @param {string|ObjectId} args.applicantUserId - auth User _id of the employee
 * @param {string[]|null} args.profileIds - EmpProfile _ids to match requests
 * @param {string[]|null} args.identityIds - UsrIdentity _ids to match requests
 * @param {string[]} args.dates - YYYY-MM-DD leave dates (full-day only by caller)
 * @param {string} args.leaveLabel - e.g. 'Sick Leave (2026-10-05 to 2026-10-05)'
 * @param {Object} [args.actor] - approver user (for attribution/audit)
 * @param {string} [args.ip] - request IP for audit
 * @param {string} [args.reason] - override note; defaults to leave-cover note
 * @returns {{ cancelled: Array, totalRefunded: number }}
 */
export async function revertPermissionsForLeave({
  applicantUserId,
  profileIds = [],
  identityIds = [],
  dates = [],
  leaveLabel = '',
  actor = null,
  ip = '',
  reason = null,
}) {
  const result = { cancelled: [], totalRefunded: 0 };
  if (!dates.length) return result;

  const orClauses = [];
  for (const p of (profileIds || []).filter(Boolean)) orClauses.push({ profileId: p });
  for (const id of (identityIds || []).filter(Boolean)) orClauses.push({ identityId: id });
  if (!orClauses.length) return result;

  const clashes = await SelfServiceRequest.find({
    $or: orClauses,
    requestType: 'permission',
    status: { $in: ['approved', 'pending'] },
    'payload.date': { $in: dates },
  }).lean();
  if (!clashes.length) return result;

  // Recipients: the employee + every active super_admin / admin_full +
  // the employee's own team_admin / team_lead (strong notification).
  let applicant = null;
  try {
    applicant = await User.findById(applicantUserId).select('_id name teamLeadId teamAdminId').lean();
  } catch { /* notify whoever resolves */ }
  let adminIds = [];
  try {
    const admins = await User.find({ role: { $in: ['super_admin', 'admin_full'] }, status: 'active' }).select('_id').lean();
    adminIds = admins.map((a) => a._id);
  } catch { /* non-fatal */ }
  const managerIds = [applicant?.teamLeadId, applicant?.teamAdminId].filter(Boolean);

  for (const clash of clashes) {
    const date = clash.payload?.date;
    const window = `${clash.payload?.startTime || '--:--'}-${clash.payload?.endTime || '--:--'}`;
    const granted = Number(clash.payload?.duration || 0) || 0;
    const used = clash.payload?.usedDuration;
    const refunded = clash.status === 'approved' ? (used === null || used === undefined ? granted : Number(used) || 0) : granted;
    const note = reason
      || `Auto-cancelled: full-day leave approved (${leaveLabel}) covers ${date}. ${refunded} min(s) returned to your permission allowance.`;

    await SelfServiceRequest.updateOne(
      { _id: clash._id, status: { $in: ['approved', 'pending'] } },
      {
        $set: {
          status: 'cancelled',
          reviewNote: note,
          reviewerUserId: actor?._id || null,
          reviewedAt: new Date(),
          cancelledAt: new Date(),
        },
      },
    );

    // mirrored attendance footprint: drop it only when the day was never
    // worked (nothing factual to preserve); a worked day keeps its history
    // and leave-wins logic already ignores the permission there.
    try {
      const row = await Attendance.findOne({ userId: applicantUserId, date }).select('clockIn permission').lean();
      if (row && !row.clockIn && (row.permission?.requestId || row.permission?.startTime)) {
        const reqMatch = !row.permission?.requestId || String(row.permission.requestId) === String(clash._id);
        if (reqMatch) {
          await Attendance.updateOne({ _id: row._id }, { $unset: { permission: 1 } });
        }
      }
    } catch { /* non-fatal */ }

    result.cancelled.push({ requestId: clash._id, date, window, priorStatus: clash.status, refundedMins: refunded });
    result.totalRefunded += refunded;

    const title = 'Permission auto-cancelled — full-day leave approved';
    const message = `Your permission request for ${date} (${window}, ${granted} min) was automatically cancelled because a full-day leave (${leaveLabel}) was approved covering that date. ${refunded} min(s) has been returned to your permission allowance.`;
    const targets = [...new Set([String(applicantUserId), ...adminIds.map(String), ...managerIds.map(String)])];
    try {
      await notify(targets, title, message, 'self_service', clash._id);
    } catch { /* non-fatal */ }
  }

  try {
    await auditLog(
      'Permission Auto-Cancelled (Leave Conflict)',
      'SelfService',
      actor?._id || null,
      `${result.cancelled.length} permission(s) auto-cancelled for leave ${leaveLabel}: ` +
        result.cancelled.map((c) => `${c.date} (${c.window}, was ${c.priorStatus}, refunded ${c.refundedMins}m)`).join('; '),
      'high',
      ip || '',
      null,
      applicantUserId,
    );
  } catch { /* non-fatal */ }

  return result;
}
