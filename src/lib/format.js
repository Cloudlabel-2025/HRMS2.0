export function formatMins(mins) {
  if (!mins) return '--';
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}
