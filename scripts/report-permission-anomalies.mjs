// Report-only audit of the attendance permission module.
// Lists data anomalies WITHOUT writing anything. Review the output, then
// decide whether a follow-up fix-up script is needed.
//
// Usage:  MONGODB_URI="mongodb+srv://..." node scripts/report-permission-anomalies.mjs
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

function toMins(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const requests = db.collection('self_service_requests');
  const attendance = db.collection('attendances');

  const now = new Date();
  const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const section = (t) => console.log('\n=== ' + t + ' ===');

  // ── 1. Permission requests ──────────────────────────────────────────
  const perms = await requests.find({ requestType: 'permission' }).toArray();
  section(`Permission requests (total ${perms.length})`);

  const pendingPast = perms.filter(r => r.status === 'pending' && r.payload?.date && r.payload.date < todayStr);
  console.log(`Pending with past date:              ${pendingPast.length}`);
  for (const r of pendingPast.slice(0, 20)) {
    console.log(`  - ${r._id} date=${r.payload?.date} window=${r.payload?.startTime}-${r.payload?.endTime} created=${r.createdAt?.toISOString?.() || r.createdAt}`);
  }

  const approvedElapsed = perms.filter(r => {
    if (r.status !== 'approved' || !r.payload?.date) return false;
    if (r.payload.date < todayStr) return true;
    if (r.payload.date !== todayStr) return false;
    const e = toMins(r.payload.endTime);
    return e !== null && nowMins > e;
  });
  console.log(`Approved with elapsed window:        ${approvedElapsed.length}`);
  for (const r of approvedElapsed.slice(0, 20)) {
    console.log(`  - ${r._id} date=${r.payload?.date} window=${r.payload?.startTime}-${r.payload?.endTime}`);
  }

  const badShape = perms.filter(r => {
    const p = r.payload || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) return true;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.startTime || ''))) return true;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.endTime || ''))) return true;
    return (Number(p.duration) || 0) > 120;
  });
  console.log(`Malformed or >120min requests:       ${badShape.length}`);
  for (const r of badShape.slice(0, 20)) {
    console.log(`  - ${r._id} status=${r.status} date=${r.payload?.date} window=${r.payload?.startTime}-${r.payload?.endTime} duration=${r.payload?.duration}`);
  }

  // ── 2. Attendance rows carrying a permission ────────────────────────
  const rows = await attendance.find({ $or: [{ 'permission.requestId': { $ne: null } }, { 'permission.startTime': { $ne: null } }] }).toArray();
  section(`Attendance rows with a permission subdoc (total ${rows.length})`);

  const noRow = rows.filter(r => !(r.workProgress || []).some(w => w.type === 'permission'));
  console.log(`Missing permission workProgress row: ${noRow.length}`);
  for (const r of noRow.slice(0, 20)) {
    console.log(`  - user=${r.userId} date=${r.date} clockIn=${r.clockIn || '-'} clockOut=${r.clockOut || '-'} window=${r.permission?.startTime}-${r.permission?.endTime}`);
  }

  const openRows = rows.filter(r => (r.workProgress || []).some(w => w.type === 'permission' && w.startTime && !w.endTime) && !r.permission?.endedAt && !r.clockOut);
  console.log(`Open permission row, not ended:      ${openRows.length}`);

  const overrun = rows.filter(r => {
    if (r.permission?.endedAt || r.clockOut || !r.permission?.endTime) return false;
    if (String(r.date) < todayStr) return true;
    if (String(r.date) !== todayStr) return false;
    const e = toMins(r.permission.endTime);
    return e !== null && nowMins > e;
  });
  console.log(`Window elapsed but never ended:      ${overrun.length}`);
  for (const r of overrun.slice(0, 20)) {
    console.log(`  - user=${r.userId} date=${r.date} window=${r.permission?.startTime}-${r.permission?.endTime} status=${r.status}`);
  }

  const masked = rows.filter(r => r.status === 'present' && !r.permission?.endedAt && r.permission?.endTime && (
    String(r.date) < todayStr || (String(r.date) === todayStr && (() => { const e = toMins(r.permission.endTime); return e !== null && nowMins > e; })())
  ));
  console.log(`Forced Present on elapsed window:    ${masked.length}  (would now be Late)`);

  const orphanEnded = rows.filter(r => r.clockOut && !r.permission?.endedAt && (r.workProgress || []).some(w => w.type === 'permission' && w.startTime && !w.endTime));
  console.log(`Clocked out with row still open:     ${orphanEnded.length}`);

  const driftRows = rows.filter(r => (r.workProgress || []).some(w => w.type === 'permission' && !w.permissionRequestId));
  console.log(`Permission rows w/o permissionRequestId (schema drift): ${driftRows.length}`);

  const driftEnded = rows.filter(r => r.permission && !('endedAt' in r.permission));
  console.log(`Permission subdocs w/o endedAt field (schema drift):    ${driftEnded.length}`);

  console.log('\nDone. No writes were made.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
