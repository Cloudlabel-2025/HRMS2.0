import { SystemConfig } from '@/lib/models/index';

export async function getTzTime() {
  let timezone = 'Asia/Kolkata';
  try {
    const doc = await SystemConfig.findOne({ key: 'global_config' }).lean();
    if (doc?.value?.timezone) {
      timezone = doc.value.timezone;
    }
  } catch (e) {
    // Ignore
  }
  const now = new Date();
  const localTimeStr = now.toLocaleString('en-US', { timeZone: timezone });
  return new Date(localTimeStr);
}
