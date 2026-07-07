export function checkAndApplyAutoLogout(record, now = new Date()) {
  if (!record.clockIn || record.clockOut) return false;

  const [ih, im] = record.clockIn.split(':').map(Number);
  // Parse clockIn time on the record's date
  const recordDate = new Date(record.date + 'T' + record.clockIn + ':00');

  // If elapsed time is greater than or equal to 10 hours (600 minutes)
  if (now - recordDate >= 10 * 60 * 60 * 1000) {
    const clockOutMinutes = ih * 60 + im + 600; // 10 hours = 600 minutes
    const oh = Math.floor(clockOutMinutes / 60) % 24;
    const om = clockOutMinutes % 60;
    const clockOutTime = String(oh).padStart(2, '0') + ':' + String(om).padStart(2, '0');

    record.clockOut = clockOutTime;
    record.autoLoggedOut = true;

    // Close open breaks
    if (record.breaks) {
      record.breaks = record.breaks.map(b => {
        if (b.start && !b.end) {
          return { type: b.type, start: b.start, end: clockOutTime };
        }
        return b;
      });
    }

    // Close open workProgress
    if (record.workProgress) {
      record.workProgress = record.workProgress.map(w => {
        if (w.startTime && !w.endTime) {
          return {
            type: w.type,
            taskDetails: w.taskDetails,
            startTime: w.startTime,
            endTime: clockOutTime,
            status: w.status === 'work_in_progress' ? 'stopped' : w.status,
            remarks: w.remarks || '',
            feedback: w.feedback || ''
          };
        }
        return w;
      });
    }

    // Calculate base, deduction and final hours worked
    const base = 600; // 10 hours
    record.baseHoursWorked = base;

    const toMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };
    
    const diffMins = (start, end) => {
      if (!start || !end) return 0;
      const s = toMinutes(start), e = toMinutes(end);
      return e > s ? e - s : 0;
    };

    const BREAK_ALLOWANCE_MINS = 30;
    const LUNCH_ALLOWANCE_MINS = 60;

    const breaks = record.breaks || [];
    const breakOver = breaks.filter(b => b.type === 'break' && b.end)
      .reduce((acc, b) => acc + Math.max(0, diffMins(b.start, b.end) - BREAK_ALLOWANCE_MINS), 0);
    const lunchOver = breaks.filter(b => b.type === 'lunch' && b.end)
      .reduce((acc, b) => acc + Math.max(0, diffMins(b.start, b.end) - LUNCH_ALLOWANCE_MINS), 0);

    record.breakDeduction = breakOver + lunchOver;
    const finalHours = Math.min(480, Math.max(0, base - record.breakDeduction)); // Capped at 8 hours (480 mins)
    record.hoursWorked = finalHours;

    if (finalHours < 240) {
      record.status = 'absent';
    } else {
      record.status = 'present';
    }

    return true;
  }
  return false;
}
