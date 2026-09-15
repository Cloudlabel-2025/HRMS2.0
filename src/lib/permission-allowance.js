import { getGlobalConfig, getCycleMonth, getCycleRange } from '@/lib/payroll-cycle';
import { SelfServiceRequest } from '@/lib/models/index';

export const DEFAULT_PERMISSION_ALLOWANCE_MINS = 120;

export function getPermissionAllowanceMins(config) {
  const v = Number(config?.permissionMonthlyAllowanceMins ?? config?.permissionAllowanceMins ?? DEFAULT_PERMISSION_ALLOWANCE_MINS);
  if (Number.isNaN(v) || v < 0) return DEFAULT_PERMISSION_ALLOWANCE_MINS;
  return v;
}

export function toMins(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function permissionDurationMins(startTime, endTime) {
  const s = toMins(startTime);
  const e = toMins(endTime);
  if (s === null || e === null) return 0;
  let d = e - s;
  if (d < 0) d += 24 * 60;
  return d;
}

/**
 * A permission window only covers late arrival when it includes the shift start.
 * e.g. shift 09:00, permission 09:00-11:00 => covers; permission 14:00-16:00 => mid-day.
 */
export function permissionCoversShiftStart(permissionStart, shiftStartMins, lateThreshold = 15) {
  const s = toMins(permissionStart);
  if (s === null || shiftStartMins === null || shiftStartMins === undefined) return false;
  // Permission must start at or before shift start + late threshold to act as arrival cover.
  return s <= shiftStartMins + lateThreshold;
}

/**
 * Used minutes: amount of the permission window actually consumed by lateness,
 * measured from permission start (per product decision), capped by granted.
 * Mid-day permissions (not covering shift start) consume the full grant.
 */
export function computePermissionUsage({ actualClockIn, permStart, permEnd, grantedDuration, shiftStartMins, lateThreshold }) {
  const granted = Number(grantedDuration || 0) || 0;
  if (granted <= 0) return { used: 0, refunded: 0, applied: false, isMidDay: true };
  const actual = toMins(actualClockIn);
  const start = toMins(permStart);
  const end = toMins(permEnd);
  if (actual === null || start === null || end === null) return { used: granted, refunded: 0, applied: false, isMidDay: true };
  const covers = permissionCoversShiftStart(permStart, shiftStartMins, lateThreshold);
  if (!covers) return { used: granted, refunded: 0, applied: false, isMidDay: true };
  // Early arrival (at/before shift start, or before permission start): on time, consume nothing.
  if (actual <= shiftStartMins) return { used: 0, refunded: granted, applied: false, isMidDay: false };
  if (actual <= start) return { used: 0, refunded: granted, applied: false, isMidDay: false };
  // Arrival inside window: used = arrival - permission start, capped by granted.
  if (actual <= end) {
    const used = Math.min(granted, Math.max(0, actual - start));
    return { used, refunded: Math.max(0, granted - used), applied: true, isMidDay: false };
  }
  // Arrival after window: permission failed to cover; grant stays consumed (no refund).
  return { used: granted, refunded: 0, applied: false, isMidDay: false };
}

export async function getCycleRangeForDate(dateStr, config) {
  const cfg = config || await getGlobalConfig();
  const startDay = Number(cfg.payrollStartDay || 26);
  const endDay = Number(cfg.payrollEndDay || 25);
  const { year, month } = getCycleMonth(dateStr, startDay);
  return getCycleRange(startDay, endDay, year, month);
}

/**
 * Monthly permission usage for a payroll cycle. No carry-forward by design:
 * query is strictly bounded to [fromDate, toDate].
 * Approved requests count `usedDuration ?? duration` (refunded time frees balance);
 * pending requests count full `duration` (reserved).
 */
export async function getPermissionUsageForCycle(profileId, fromDate, toDate) {
  const rows = await SelfServiceRequest.find({
    profileId,
    requestType: 'permission',
    status: { $in: ['approved', 'pending'] },
    'payload.date': { $gte: fromDate, $lte: toDate },
  }).select('status payload').lean();
  let approvedUsed = 0;
  let pendingReserved = 0;
  for (const r of rows) {
    const granted = Number(r.payload?.duration || 0) || 0;
    if (r.status === 'approved') {
      const used = r.payload?.usedDuration;
      approvedUsed += (used === null || used === undefined) ? granted : (Number(used) || 0);
    } else {
      pendingReserved += granted;
    }
  }
  return { rows, approvedUsed, pendingReserved, totalUsed: approvedUsed + pendingReserved };
}

export async function getPermissionBalance(profileId, dateStr, config) {
  const cfg = config || await getGlobalConfig();
  const allowance = getPermissionAllowanceMins(cfg);
  const { fromDate, toDate } = await getCycleRangeForDate(dateStr, cfg);
  const usage = await getPermissionUsageForCycle(profileId, fromDate, toDate);
  const remaining = Math.max(0, allowance - usage.totalUsed);
  return { allowance, ...usage, remaining, fromDate, toDate };
}
