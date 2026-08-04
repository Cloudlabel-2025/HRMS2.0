import mongoose from 'mongoose';
import { Shift } from './models/index';

export async function resolveShift(user, { asLean = true } = {}) {
  if (!user) return null;
  const shiftId = user.shiftId && mongoose.Types.ObjectId.isValid(String(user.shiftId)) ? user.shiftId : null;
  if (shiftId) {
    const byId = asLean ? await Shift.findById(shiftId).lean() : await Shift.findById(shiftId);
    if (byId) return byId;
  }
  if (user.shift) {
    const byName = asLean ? await Shift.findOne({ name: user.shift }).lean() : await Shift.findOne({ name: user.shift });
    if (byName) return byName;
  }
  return null;
}

export function getShiftEndMinutes(shiftDoc, config) {
  const endTime = shiftDoc?.endTime;
  if (!endTime || typeof endTime !== 'string') return 600;
  const [eh, em] = endTime.split(':').map(Number);
  if (isNaN(eh) || isNaN(em)) return 600;
  let endMins = eh * 60 + em;
  const startTime = shiftDoc?.startTime;
  if (startTime && typeof startTime === 'string') {
    const [sh, sm] = startTime.split(':').map(Number);
    if (!isNaN(sh) && !isNaN(sm) && endMins < sh * 60 + sm) endMins += 24 * 60;
  }
  return endMins;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Lenient off-day check: only a shift that explicitly lists its working days can
// exclude a date. Empty/undefined days means every day is a working day.
export function isShiftWorkingDay(shiftDoc, dateStr) {
  const days = shiftDoc?.days;
  if (!Array.isArray(days) || days.length === 0) return true;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return true;
  return days.includes(WEEKDAY_NAMES[d.getDay()]);
}
