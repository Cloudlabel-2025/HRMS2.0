import mongoose from 'mongoose';

const AttendanceSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:       { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  clockIn:    { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  clockOut:   { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  hoursWorked:{ type: Number, default: 0 },              // in minutes
  payableHours:{ type: Number, default: 0 },              // capped daily credit, in minutes
  shortHours: { type: Boolean, default: false },          // informational only; never creates LOP
  // Why the day is short hours — the two additive triggers behind `shortHours`.
  // Kept alongside it so the UI can say "short by 60m" instead of a bare badge.
  shortfallMins:   { type: Number, default: 0 },          // clock-out before scheduled shift end
  breakExcessMins: { type: Number, default: 0 },          // break time taken over the allowances
  baseHoursWorked: { type: Number, default: 0 },
  breakDeduction: { type: Number, default: 0 },
  breaks: [{
    type: { type: String, required: true },
    name: { type: String, default: '' },
    ruleIdx: { type: Number, default: null },
    start: { type: String, default: '' },
    end: { type: String, default: null },
  }],
  workProgress: [{
    type: { type: String, default: 'task' },
    taskDetails: { type: String, default: '' },
    startTime: { type: String, default: '' },
    endTime: { type: String, default: null },
    status: { type: String, enum: ['pending', 'work_in_progress', 'completed', 'task_blocked', 'stopped'], default: 'work_in_progress' },
    remarks: { type: String, default: '' },
    feedback: { type: String, default: '' },
    duration: { type: Number, default: null },
    carriedForward: { type: Boolean, default: false },
    completedAt: { type: String, default: null },
    completedDate: { type: String, default: null },
    tries: { type: Number, default: null },
    // Permission lifecycle bookkeeping (written by permission-work.js):
    // rows are matched to requests by permissionRequestId, and rows
    // created when a permission ends carry resumedAfter: 'permission'.
    permissionRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'SelfServiceRequest', default: null },
    resumedAfter: { type: String, default: null },
    scheduledEndTime: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endedLate: { type: Boolean, default: false },
    overrunMins: { type: Number, default: null },
  }],
  status:     { type: String, enum: ['present','absent','late','leave','half_day','holiday'], default: 'absent' },
  lateFlag:   { type: Boolean, default: false },
  halfDayThresholdExceeded: { type: Boolean, default: false },
  // Absent-row provenance: written by the calendar sync / daily sweep when an
  // elapsed working day has no clock-in and no approved leave. Manual edits
  // (admin marking absent with a reason) set source 'manual'.
  absentMarkedAt: { type: Date, default: null },
  absentSource:   { type: String, enum: ['system', 'manual', 'import'], default: null },
  // Frozen per-day shift snapshot (written at clock-in). Past rows are judged
  // by these values and are immune to later shift edits. Nullable for back-compat.
  shiftId:             { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', default: null },
  shiftName:           { type: String, default: null },
  shiftStartTime:      { type: String, default: null },
  shiftEndTime:        { type: String, default: null },
  shiftLateThreshold:  { type: Number, default: null },
  note:       { type: String, default: '' },
  absenceReason: { type: String, default: '' },
  autoLoggedOut: { type: Boolean, default: false },
  regularizationOutOpen: { type: Boolean, default: false },
  lateLogoutReason: { type: String, default: '' },
  lateLogoutReasonProvidedAt: { type: Date, default: null },
  // Overtime minutes from a late clock-out. STORED ONLY — no calculation rule
  // exists yet (see computeOvertimeMinutes in attendance-constants.js). This
  // field must not be read by any money code until that rule is defined; it
  // does not affect presentDays, lopDays, or net pay today.
  overtimeMinutes: { type: Number, default: 0 },
  smeId:      { type: mongoose.Schema.Types.ObjectId, ref: 'SME', default: null },
  earlyLogin: { type: Boolean, default: false },
  geoLocation: {
    lat: { type: Number },
    lng: { type: Number },
  },
  leaveOverride: {
    status:     { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  approvedHalfDayLeave: { type: Boolean, default: false },
  // Which half was actually worked (clockIn side of the split), independent
  // of Leave.halfDayType (the leave's declared half). Set at clock-in.
  workedHalf: { type: String, enum: ['first_half', 'second_half'], default: null },
  relatedLeaveId: { type: mongoose.Schema.Types.ObjectId, ref: 'Leave', default: null },
  // Admin-imported presence correction (bulk attendance import). A day the
  // employee physically worked but never clocked in. The status stays
  // 'present' and payroll credits a full day via this flag — clockIn is NOT
  // required for credit, so never fake clock times to force it.
  importedPresence: {
    source:   { type: String, enum: ['bulk_upload'], default: null },
    reason:   { type: String, default: '' },
    by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byEmail:  { type: String, default: '' },
    at:       { type: Date, default: null },
    batchRef: { type: String, default: '' },
  },
  nonWorkingDayType: { type: String, enum: ['none', 'holiday', 'weekly_off'], default: 'none' },
  permission: {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'SelfServiceRequest', default: null },
    startTime: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    duration: { type: Number, default: null },
    grantedDuration: { type: Number, default: null },
    usedDuration: { type: Number, default: null },
    refundedDuration: { type: Number, default: null },
    actualClockIn: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    effectiveClockIn: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    applied: { type: Boolean, default: false },
    isMidDay: { type: Boolean, default: false },
    status: { type: String, enum: ['approved'], default: 'approved' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    // Permission end bookkeeping (written by permission-work.js, read by the
    // attendance page; a permission stays active until one of these is set):
    endedAt: { type: String, default: null, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endedEarly: { type: Boolean, default: false },
    endedLate: { type: Boolean, default: false },
    endedLateMins: { type: Number, default: null },
    // Minutes past the requested end. Only requested time counts as
    // permission time; the remainder is ordinary (late) worked time.
    overrunMins: { type: Number, default: null },
    endedBy: { type: String, enum: ['manual', 'clockout', 'auto_logout', 'approval_overdue', 'sweep_overdue'], default: null },
  },
}, { timestamps: true });

AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

if (mongoose.models.Attendance) {
  const existing = mongoose.models.Attendance;
  const wpSchema = existing.schema.path('workProgress')?.schema;
  if (!existing.schema.path('shiftStartTime') || !existing.schema.path('importedPresence') || !existing.schema.path('halfDayThresholdExceeded') || !existing.schema.path('absentMarkedAt') || !existing.schema.path('permission.endedAt') || !existing.schema.path('permission.endedBy') || !existing.schema.path('shortfallMins') || !existing.schema.path('breakExcessMins') || !wpSchema?.path('permissionRequestId')) {
    delete mongoose.models.Attendance;
    if (mongoose.connection.models.Attendance) delete mongoose.connection.models.Attendance;
  }
}

export default mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
