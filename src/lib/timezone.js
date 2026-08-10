import { SystemConfig } from '@/lib/models/index';

let cachedTimezone = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getTimezone() {
  if (!cachedTimezone || Date.now() - cacheTime > CACHE_TTL) {
    let timezone = 'Asia/Kolkata';
    try {
      const doc = await SystemConfig.findOne({ key: 'global_config' }).lean();
      if (doc?.value?.timezone) timezone = doc.value.timezone;
    } catch (e) {
      // Fall through to default
    }
    cachedTimezone = timezone;
    cacheTime = Date.now();
  }
  return cachedTimezone;
}

// Return a Date whose LOCAL components (getHours/getMinutes/getFullYear/...)
// match the instant's wall-clock components in the configured timezone.
function formatInTimezone(instant, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

  const year = get('year');
  const month = get('month') - 1;
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  return new Date(year, month, day, hour, minute, second);
}

export async function getTzTime() {
  try {
    const timezone = await getTimezone();
    return formatInTimezone(new Date(), timezone);
  } catch (e) {
    return new Date();
  }
}

// Convert an arbitrary instant (e.g. a client-provided ISO timestamp) into the
// configured timezone's wall-clock components.
export async function toTzLocal(instant) {
  try {
    const timezone = await getTimezone();
    return formatInTimezone(instant, timezone);
  } catch (e) {
    return instant instanceof Date ? instant : new Date(instant);
  }
}
