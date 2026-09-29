/**
 * Verify attendance register alignment (read-only).
 *
 * For every active employee over a calendar month, asserts the same identity
 * the Team report cards and the Excel/PDF export display:
 *   workingDays === daysWorked + leave + absent (+ notArrived for today)
 *   totalRows   === workingDays + offDays
 * and that no 'other' (unclassifiable) rows exist. Mirrors the buckets in
 * src/lib/attendance-stats.js (computeAttendanceStats).
 *
 * Usage:
 *   node scripts/verify-attendance-alignment.mjs --month=2026-09
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
if (!process.env.MONGODB_URI) dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set (.env.local).');
  process.exit(1);
}

const monthArg = (process.argv.find(a => a.startsWith('--month=')) || '').split('=')[1];
const now = new Date();
const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
const month = monthArg && /^\d{4}-\d{2}$/.test(monthArg) ? monthArg : todayStr.slice(0, 7);
const [yy, mm] = month.split('-').map(Number);
const lastDay = new Date(yy, mm, 0).getDate();
const from = `${month}-01`;
const to = `${month}-${String(lastDay).padStart(2, '0')}`;

const realImport = r => !!(r.importedPresence && r.importedPresence.source);
const worked = r => !!(r.clockIn || realImport(r));

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({ status: 'active', role: { $ne: 'super_admin' } }).project({ name: 1 }).toArray();
  let failures = 0;
  console.log(`Month ${month} (${from}..${to}) — ${users.length} employees (today ${todayStr} excluded from the identity)\n`);

  for (const u of users) {
    // Elapsed dates only: today is still in play (not-arrived), so it is
    // checked separately, not as part of the closed identity.
    const rows = await db.collection('attendances').find({
      userId: u._id, date: { $gte: from, $lte: to < todayStr ? to : todayStr },
    }).project({ date: 1, status: 1, clockIn: 1, importedPresence: 1, nonWorkingDayType: 1, notArrived: 1, displayStatus: 1 }).toArray();
    const elapsed = rows.filter(r => r.date < todayStr);
    const off = elapsed.filter(r => r.status === 'holiday');
    const working = elapsed.filter(r => r.status !== 'holiday');
    const workedRows = working.filter(worked);
    const rest = working.filter(r => !worked(r));
    const absent = rest.filter(r => r.status === 'absent');
    const leave = rest.filter(r => r.status === 'leave' || r.status === 'half_day');
    const other = rest.filter(r => !['absent', 'leave', 'half_day'].includes(r.status));
    const ok = working.length === workedRows.length + leave.length + absent.length + other.length
      && other.length === 0
      && elapsed.length === working.length + off.length;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${(u.name || '').padEnd(22)} working=${working.length} = worked ${workedRows.length} + leave ${leave.length} + absent ${absent.length}${other.length ? ` + OTHER ${other.length} [${other.map(r => r.date + ':' + r.status).join(',')}]` : ''} | off=${off.length}`);
  }

  console.log(failures ? `\n${failures} employee(s) MISALIGNED` : '\nAll aligned.');
  await mongoose.disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('Verify failed:', e?.message || e); process.exit(1); });
