import { SystemConfig } from '@/lib/models/index';

let cachedTimezone = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getTzTime() {
  let timezone = 'Asia/Kolkata';
  try {
    if (!cachedTimezone || Date.now() - cacheTime > CACHE_TTL) {
      const doc = await SystemConfig.findOne({ key: 'global_config' }).lean();
      if (doc?.value?.timezone) cachedTimezone = doc.value.timezone;
      cacheTime = Date.now();
    }
    if (cachedTimezone) timezone = cachedTimezone;
  } catch (e) {
    // Fall through to default
  }

  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

    const year = get('year');
    const month = get('month') - 1;
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');

    return new Date(year, month, day, hour, minute, second);
  } catch (e) {
    return new Date();
  }
}
