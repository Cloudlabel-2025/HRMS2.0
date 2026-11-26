function datePart(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// The recorded employment date is authoritative. Account creation and older
// activity are only fallbacks for legacy accounts with no joining date.
export function employmentStartDay(user, activityDates = []) {
  const joined = datePart(user?.joinDate) || datePart(user?.hireDate);
  if (joined) return joined;
  return [datePart(user?.createdAt), ...activityDates.map(datePart)]
    .filter(Boolean).sort()[0] || null;
}

export function isBeforeEmployment(date, user) {
  const start = employmentStartDay(user);
  return !!start && date < start;
}
