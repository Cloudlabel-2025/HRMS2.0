/**
 * Backfill confirmed historical shift assignments into shiftchanges.
 * Dry-run by default. Add --apply to write to the configured MongoDB database.
 *
 * Timeline:
 *   2026-07-08: After Noon Shift for the nine affected employees
 *   2026-08-07: Night Shift for the five Oracle employees
 *   2026-08-18: After Noon Shift for the five Oracle employees
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
if (!process.env.MONGODB_URI) dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is missing from .env.local/.env');
const APPLY = process.argv.includes('--apply');
const oid = (id) => new mongoose.Types.ObjectId(id);

const oracleIds = [
  '6a4d93486fe260561f2afeb7', // Oracle Functional
  '6a4d941ce24a8defc8412f93', // Oracle Functional
  '6a4d957aad9303fc59a455a0', // Oracle Technical
  '6a4d9194c7a6804a76e88289', // Oracle Technical
  '6a4d967bc11d5996900e4993', // Oracle Functional
];
const otherIds = [
  '6a58b9c46dfd11006f17cf12',
  '6a4e2ce1430b321f8b3786fd',
  '6a4d9764e55e01018a638fca',
  '6a4d929fda99c5be9201765d',
];
const actorId = '6a4d7f5bf7f27535e6552f8a';

function shiftSnapshot(shift) {
  return {
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    expectedHours: shift.expectedHours ?? 480,
    absentThreshold: shift.absentThreshold ?? 240,
    lateThreshold: shift.lateThreshold ?? 15,
    earlyLoginWindow: shift.earlyLoginWindow ?? 120,
    breaks: shift.breaks || [],
    autoLogoutAfterShiftEnd: shift.autoLogoutAfterShiftEnd ?? 360,
    halfDayThreshold: shift.halfDayThreshold ?? 180,
  };
}

async function main() {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  console.log(`Connected to ${new URL(uri).hostname}/${db.databaseName}; mode=${APPLY ? 'APPLY' : 'DRY'}`);
  if (db.databaseName !== 'test') throw new Error(`Expected database "test" from the confirmed Compass breadcrumb; refusing to seed "${db.databaseName}"`);

  const shifts = db.collection('shifts');
  const users = db.collection('users');
  const changes = db.collection('shiftchanges');
  const afternoonId = oid('6a4d8e80c7a6804a76e88285');
  const nightId = oid('6a75d6d1f36f9765105ca559');
  const [afternoon, night] = await Promise.all([
    shifts.findOne({ _id: afternoonId }),
    shifts.findOne({ _id: nightId }),
  ]);
  if (!afternoon || afternoon.name !== 'After Noon Shift' || afternoon.startTime !== '14:00' || afternoon.endTime !== '22:00') {
    throw new Error('After Noon Shift ID/name/times do not match the confirmed shift details');
  }
  if (!night || night.name !== 'Night Shift.' || night.startTime !== '17:00' || night.endTime !== '05:00') {
    throw new Error('Night Shift ID/name/times do not match the confirmed shift details');
  }

  const allIds = [...new Set([...oracleIds, ...otherIds])];
  const foundUsers = await users.find({ _id: { $in: allIds.map(oid) } }).project({ _id: 1 }).toArray();
  const foundSet = new Set(foundUsers.map(u => String(u._id)));
  const missing = allIds.filter(id => !foundSet.has(id));
  if (missing.length) throw new Error(`Expected all nine confirmed users; missing ${missing.join(', ')}`);

  const actorExists = await users.findOne({ _id: oid(actorId) }, { projection: { _id: 1 } });
  const events = [
    {
      key: 'historical-shift-seed-2026-07-08-afternoon-v1',
      effectiveDate: '2026-07-08',
      shift: afternoon,
      users: allIds,
      priorShift: null,
    },
    {
      key: 'historical-shift-seed-2026-08-07-oracle-night-v1',
      effectiveDate: '2026-08-07',
      shift: night,
      users: oracleIds,
      priorShift: afternoon,
    },
    {
      key: 'historical-shift-seed-2026-08-18-oracle-afternoon-v1',
      effectiveDate: '2026-08-18',
      shift: afternoon,
      users: oracleIds,
      priorShift: night,
    },
  ];

  let inserted = 0;
  for (const event of events) {
    const existing = await changes.findOne({ reason: event.key });
    if (existing) {
      console.log(`SKIP ${event.effectiveDate} ${event.shift.name}: already seeded (${existing._id})`);
      continue;
    }

    const userAssignments = event.users.map(userId => ({
      userId: oid(userId),
      fromShiftId: event.priorShift?._id || null,
      fromShiftName: event.priorShift?.name || '',
      fromShiftSnapshot: event.priorShift ? shiftSnapshot(event.priorShift) : null,
      targetShiftId: event.shift._id,
      targetShiftName: event.shift.name,
      targetShiftSnapshot: shiftSnapshot(event.shift),
    }));
    const doc = {
      targetShiftId: event.shift._id,
      targetShiftName: event.shift.name,
      fromShiftId: event.priorShift?._id || null,
      departments: '',
      roles: '',
      userIds: event.users.map(oid),
      userAssignments,
      exactUserIds: true,
      effectiveDate: event.effectiveDate,
      reason: event.key,
      status: 'applied',
      appliedAt: new Date(`${event.effectiveDate}T12:00:00+05:30`),
      appliedCount: event.users.length,
      createdBy: actorExists ? oid(actorId) : null,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    };

    console.log(`${APPLY ? 'INSERT' : 'WOULD INSERT'} ${event.effectiveDate} ${event.shift.name} ${event.shift.startTime}-${event.shift.endTime}: ${event.users.length} employees`);
    if (APPLY) {
      const result = await changes.insertOne(doc);
      console.log(`  inserted _id=${result.insertedId}`);
      inserted++;
    }
  }

  console.log(APPLY ? `Seed complete: inserted=${inserted}` : 'Dry-run only. No documents written. Add --apply to seed.');
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
