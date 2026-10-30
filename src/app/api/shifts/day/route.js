import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { requireAuth } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import User from '@/lib/models/User';
import Attendance from '@/lib/models/Attendance';
import Shift from '@/lib/models/Shift';
import ShiftDayOverride from '@/lib/models/ShiftDayOverride';
import Leave from '@/lib/models/Leave';
import { SelfServiceRequest, Holiday, AttendanceRegularization } from '@/lib/models/index';
import { Payroll } from '@/lib/models/Payroll';
import { getGlobalConfig, isWorkingDay } from '@/lib/payroll-cycle';
import { affectedPayrollMonths } from '@/lib/payroll-reopen';
import { getTzDateStr, getTzTime } from '@/lib/timezone';
import { resolveShiftForDate, resolveShiftAtTime } from '@/lib/shift-utils';
import { validScheduleDate, snapshotShift, adjacentDate, overlapsAdjacent, overrideValidation, shiftFromOverride } from '@/lib/shift-schedule';
import { correctedAttendance } from '@/lib/shift-correction';
import { runPayrollForMonth } from '@/lib/payroll-run-engine';

const admin = user => ['super_admin', 'admin_full'].includes(user.role);
function reject(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function validate(userId, date) {
  if (!mongoose.isValidObjectId(userId) || !validScheduleDate(date)) reject('A valid employee and date are required.', 400);
}

export async function GET(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    const params = new URL(req.url).searchParams;
    if (params.get('current') === '1') {
      const resolved = await resolveShiftAtTime(user, await getTzTime());
      const record = await Attendance.findOne({ userId: user._id, date: resolved.date }).select('scheduleSnapshot shiftId').lean();
      return ok({ date: resolved.date, schedule: record?.scheduleSnapshot || resolved.shift });
    }
    if (params.get('roster') === '1') {
      if (!admin(user)) return fail('Access denied', 403);
      return ok(await User.find({ status: 'active', role: { $ne: 'super_admin' } }).select('name department').sort({ name: 1 }).lean());
    }
    const userId = params.get('userId') || String(user._id);
    const date = params.get('date');
    validate(userId, date);
    if (!admin(user) && userId !== String(user._id)) return fail('Access denied', 403);
    const employee = await User.findById(userId).select('name shift shiftId').lean();
    if (!employee) return fail('Employee not found', 404);
    const [schedule, override, shifts, today] = await Promise.all([
      resolveShiftForDate(employee, date),
      ShiftDayOverride.findOne({ userId, date }).lean(),
      admin(user) ? Shift.find({}).select('name startTime endTime expectedHours parentShiftId').sort({ name: 1 }).lean() : [],
      getTzDateStr(),
    ]);
    return ok({ employee, date, schedule, override, shifts, editable: admin(user) && date !== today, today });
  } catch (e) { return fail(e.message, e.status || 500); }
}

async function previewChange(body, session = null) {
  const { userId, date, shiftId, action = 'replace' } = body;
  validate(userId, date);
  if (!['replace', 'cancel'].includes(action)) reject('Invalid action.', 400);
  const today = await getTzDateStr();
  if (date === today) reject('Today may have active attendance. Choose a completed past date or a future date.');
  if (date > adjacentDate(today, 366)) reject('Choose a date within the next year.', 400);
  const employee = await User.findById(userId).session(session).lean();
  if (!employee || employee.status !== 'active') reject('Active employee not found.', 404);
  if (employee.joinDate && date < new Date(employee.joinDate).toISOString().slice(0, 10)) reject('Choose a date on or after the employee joined.');
  const existing = await ShiftDayOverride.findOne({ userId, date }).session(session).lean();
  if (action === 'cancel' && existing?.status !== 'active') reject('There is no active override to cancel.');
  const config = await getGlobalConfig();
  const months = affectedPayrollMonths(date, date, config);
  const identityFilters = [];
  if (employee.identityId) identityFilters.push({ identityId: employee.identityId });
  if (employee.profileId) identityFilters.push({ profileId: employee.profileId });
  // Transactions must not execute parallel operations on the same session.
  const attendance = await Attendance.findOne({ userId, date }).session(session).lean();
  const leave = await Leave.findOne({ userId, status: { $in: ['approved', 'pending'] }, from: { $lte: date }, to: { $gte: date } }).session(session).lean();
  const permission = identityFilters.length ? await SelfServiceRequest.exists({ $or: identityFilters, requestType: 'permission',
    status: { $in: ['approved', 'pending'] }, 'payload.date': date }).session(session) : null;
  const payrolls = await Payroll.find({ userId, month: { $in: months } }).session(session).lean();
  const regularization = await AttendanceRegularization.exists({ userId, date, status: 'pending' }).session(session);
  const holidays = await Holiday.find({ date }).session(session).lean();
  if (attendance && date > today) reject('Attendance already exists for this future date. Resolve it before changing the schedule.');
  if (attendance && ((!!attendance.clockIn !== !!attendance.clockOut) || attendance.regularizationOutOpen ||
    attendance.breaks?.some(b => b.start && !b.end) || attendance.workProgress?.some(w => w.startTime && !w.endTime))) {
    reject('Complete the open attendance, break or work session before changing this historical shift.');
  }
  if (leave?.status === 'pending' || (leave && date > today) || permission || attendance?.permission?.startTime) reject('This day has a pending leave or a permission request. Resolve that request before changing the schedule.');
  if (regularization) reject('Review the pending attendance regularization before changing this shift.');
  if (!isWorkingDay(date, config, holidays)) reject('This is a non-working day. A shift override cannot change the holiday or weekly-off policy.');
  let shift;
  if (action === 'replace') {
    if (!mongoose.isValidObjectId(shiftId)) reject('Choose a valid shift.', 400);
    shift = await Shift.findById(shiftId).session(session).lean();
    const invalid = overrideValidation(shift);
    if (invalid) reject(invalid, 400);
  } else {
    // Resolve the assignment without the cancelled override.
    shift = await resolveShiftForDate(employee, date, { ignoreDayOverride: true });
  }
  const invalidSchedule = overrideValidation(shift);
  if (invalidSchedule) reject(invalidSchedule, 400);
  const dates = [adjacentDate(date, -1), adjacentDate(date, 1)];
  const neighbours = [];
  for (const day of dates) {
    const recorded = await Attendance.findOne({ userId, date: day }).session(session).lean();
    const override = await ShiftDayOverride.findOne({ userId, date: day, status: 'active' }).session(session).lean();
    neighbours.push(recorded?.scheduleSnapshot || (override ? shiftFromOverride(override) : await resolveShiftForDate(employee, day, { ignoreDayOverride: true })));
  }
  if (overlapsAdjacent(shift, ...neighbours)) reject('This schedule overlaps the previous or next day. Choose a different shift.');
  const snapshot = snapshotShift(shift);
  const correction = date < today && attendance ? correctedAttendance(attendance, shift, config, leave) : null;
  const revision = existing?.revision || 0;
  const token = createHash('sha256').update(JSON.stringify({ userId, date, action, shiftId, snapshot, revision,
    attendance, leave, correction, payrolls,
    neighbours: neighbours.map(snapshotShift) })).digest('hex');
  return { employee, existing, shift, snapshot, revision, token, attendance, correction, payrolls, timezone: config.timezone || 'Asia/Kolkata' };
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!admin(user)) return fail('Access denied', 403);
    const body = await req.json();
    const bulk = body.userIds !== undefined;
    if (bulk && (!Array.isArray(body.userIds) || !body.userIds.length || body.userIds.length > 50 ||
      new Set(body.userIds).size !== body.userIds.length)) return fail('Select between 1 and 50 different employees.', 400);
    const ids = bulk ? [...body.userIds].sort() : [body.userId];
    for (const id of ids) validate(id, body.date);
    if (body.preview === true) {
      if (bulk) {
        const results = [];
        for (const userId of ids) {
          try {
            const checked = await previewChange({ ...body, userId });
            results.push({ userId, name: checked.employee.name, ...previewResponse(checked, body.date) });
          } catch (e) {
            if (!e.status || e.status >= 500) throw e;
            results.push({ userId, error: e.message });
          }
        }
        return ok({ results, canApply: results.every(row => !row.error) });
      }
      const result = await previewChange(body);
      return ok(previewResponse(result, body.date));
    }
    if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.length > 500) return fail('Provide a reason between 5 and 500 characters.', 400);
    if (bulk && (!Array.isArray(body.previews) || body.previews.length !== ids.length ||
      new Set(body.previews.map(row => row?.userId)).size !== ids.length ||
      body.previews.some(row => !ids.includes(row?.userId)))) return fail('Preview every selected employee before saving.', 400);
    // Serialize edits for the same employee, including adjacent dates, then
    // recheck the preview inside the transaction. Fail closed if unsupported.
    await ShiftDayOverride.init();
    const result = await mongoose.connection.transaction(async session => {
      const checkedRows = [];
      // Lock in stable order and validate the entire group before writing any
      // schedules. All employee corrections commit or roll back together.
      for (const userId of ids) {
        await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(userId) }, { $inc: { scheduleRevision: 1 } }, { session });
        const checked = await previewChange({ ...body, userId }, session);
        const proof = bulk ? body.previews.find(row => row.userId === userId) : body;
        if (proof.previewToken !== checked.token || proof.revision !== checked.revision) reject('The schedule or attendance changed. Preview the selected employees again before saving.');
        checkedRows.push({ userId, checked });
      }
      const results = [];
      for (const { userId, checked } of checkedRows) {
      const revision = checked.revision + 1;
      const action = body.action === 'cancel' ? 'cancel' : 'replace';
      const record = await ShiftDayOverride.findOneAndUpdate({ userId, date: body.date }, {
        $set: { shiftId: action === 'cancel' ? checked.existing.shiftId : checked.shift._id,
          snapshot: action === 'cancel' ? checked.existing.snapshot : checked.snapshot,
          timezone: checked.timezone, status: action === 'cancel' ? 'cancelled' : 'active',
          reason: body.reason.trim(), updatedBy: user._id, revision },
        $push: { history: { revision, action, reason: body.reason.trim(), snapshot: checked.snapshot, actor: user._id, at: new Date(),
          attendanceBefore: checked.correction ? checked.attendance : null, attendanceAfter: checked.correction,
          payrollBefore: checked.payrolls } },
      }, { upsert: true, new: true, runValidators: true, session });
      if (checked.correction) {
        const updated = await Attendance.updateOne({ _id: checked.attendance._id, updatedAt: checked.attendance.updatedAt }, {
          $set: { ...checked.correction, dayOverrideId: action === 'cancel' ? null : record._id, scheduleRevision: revision },
          $inc: { timelineRevision: 1 },
        }, { session, runValidators: true });
        if (updated.matchedCount !== 1) reject('Attendance changed. Preview again before saving.');
      }
      results.push({ userId, override: record, schedule: checked.snapshot });
      }
      const payrollGroups = new Map();
      for (const { userId, checked } of checkedRows) {
        for (const payroll of checked.payrolls) {
          if (!payrollGroups.has(payroll.month)) payrollGroups.set(payroll.month, new Set());
          payrollGroups.get(payroll.month).add(userId);
        }
      }
      let payrollsUpdated = 0;
      for (const [month, group] of payrollGroups) {
        const summary = await runPayrollForMonth({ month, userIds: [...group], actor: user, force: true, session });
        if (summary.processed !== group.size || summary.skipped.length) reject('Payroll could not be recalculated for every employee. No changes were saved.');
        payrollsUpdated += summary.processed;
      }
      return bulk ? { results, updated: results.length, payrollsUpdated } : { ...results[0], payrollsUpdated };
    });
    return ok(result);
  } catch (e) { return fail(e.code === 11000 ? 'The schedule changed. Refresh and try again.' : e.message, e.status || (e.code === 11000 ? 409 : 500)); }
}

function previewResponse(result, date) {
  return { schedule: result.snapshot, revision: result.revision, previewToken: result.token,
    date, timezone: result.timezone,
    payrolls: result.payrolls.map(row => ({ month: row.month, status: row.status })),
    attendance: result.correction ? { before: result.attendance, after: { ...result.attendance, ...result.correction } } : null };
}
