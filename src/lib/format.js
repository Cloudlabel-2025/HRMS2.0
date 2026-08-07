export function formatMins(mins) {
  if (!mins) return '--';
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

/**
 * Normalize a stored identity address into edit-form fields.
 * Handles legacy shapes where the whole address was crammed into `line1`
 * ("street, city, PIN xxxxxx") or the city/PIN were parked in `line2`/`landmark`,
 * and placeholder values like city "N/A" / postalCode "000000".
 */
export function parseStoredAddress(a = {}) {
  let line1 = String(a.line1 || '').trim();
  let line2 = String(a.line2 || '').trim();
  let line3 = String(a.landmark || '').trim();
  let city  = String(a.city || '').trim();
  let pin   = String(a.postalCode || '').trim();

  if (city === 'N/A') city = '';
  if (pin === '000000' || pin === 'N/A') pin = '';

  const stripPin = (s) => {
    const m = String(s).match(/PIN\s*[:\-]?\s*(\d{4,6})/i);
    if (!m) return s;
    if (!pin) pin = m[1];
    return s.replace(m[0], '').replace(/[,;\s]+$/, '').trim();
  };
  line1 = stripPin(line1);
  line2 = stripPin(line2);
  line3 = stripPin(line3);

  if (!city && line2 && /^[A-Za-z][A-Za-z\s]{1,}$/.test(line2)) {
    city = line2;
    line2 = '';
  }

  if (!city && line1.includes(',')) {
    const parts = line1.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (/^[A-Za-z][A-Za-z\s]{1,}$/.test(last)) {
        city = last;
        line1 = parts.slice(0, -1).join(', ').trim();
      }
    }
  }

  return { line1, line2, line3, cityTown: city, pinCode: pin };
}
