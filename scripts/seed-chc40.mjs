/**
 * Seed 40 employees for full-HRMS testing.
 *
 * Departments: Management (common, 4 x admin_full)
 *              Production / Functional / Technical (each: 2 team_lead, 3 team_admin, 4 employee, 3 intern)
 * Total: 4 + 12*3 = 40
 * Password for ALL: Chc@2025  |  isFirstLogin: true  |  past-only history (no future dates)
 *
 * Usage:
 *   node scripts/seed-chc40.mjs --dry-run   # preview, no writes
 *   node scripts/seed-chc40.mjs              # fail-closed seed
 *   node scripts/seed-chc40.mjs --force      # delete cohort (40 emails) then re-seed
 *
 * Idempotency: default mode aborts if any cohort email exists.
 * --force deletes ONLY the 40 cohort emails + their linked docs (never super_admin).
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI missing in .env.local');
  process.exit(1);
}

const PASSWORD = 'Chc@2025';
const DOMAIN = 'hrms.com';
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

// ── Roster: [name, emailLocal, role, department, designation, employmentType, grossLPA] ──
const ROSTER = [
  // Management — 4 x admin_full
  ['Vikram Desai', 'vikram.desai', 'admin_full', 'Management', 'Admin - Operations', 'full_time', 900000],
  ['Priya Nair', 'priya.nair', 'admin_full', 'Management', 'Admin - HR Operations', 'full_time', 900000],
  ['Rohan Mehta', 'rohan.mehta', 'admin_full', 'Management', 'Admin - Finance', 'full_time', 900000],
  ['Anjali Rao', 'anjali.rao', 'admin_full', 'Management', 'Admin - Compliance', 'full_time', 900000],
  // Production — 2 TL, 3 TA, 4 Emp, 3 Intern
  ['Arjun Reddy', 'arjun.reddy', 'team_lead', 'Production', 'Production Lead', 'full_time', 720000],
  ['Kavya Pillai', 'kavya.pillai', 'team_lead', 'Production', 'Sr Production Lead', 'full_time', 720000],
  ['Suresh Kumar', 'suresh.kumar', 'team_admin', 'Production', 'Production Coordinator', 'full_time', 540000],
  ['Neha Gupta', 'neha.gupta', 'team_admin', 'Production', 'Production Coordinator', 'full_time', 540000],
  ['Manoj Singh', 'manoj.singh', 'team_admin', 'Production', 'Production Coordinator', 'full_time', 540000],
  ['Aditi Sharma', 'aditi.sharma', 'employee', 'Production', 'Production Executive', 'full_time', 420000],
  ['Harsha Patil', 'harsha.patil', 'employee', 'Production', 'Production Engineer', 'full_time', 420000],
  ['Divya Joshi', 'divya.joshi', 'employee', 'Production', 'Production Executive', 'full_time', 420000],
  ['Kiran Shah', 'kiran.shah', 'employee', 'Production', 'Production Engineer', 'full_time', 420000],
  ['Aman Verma', 'aman.verma', 'intern', 'Production', 'Production Intern', 'intern', 180000],
  ['Sneha Kulkarni', 'sneha.kulkarni', 'intern', 'Production', 'Production Intern', 'intern', 180000],
  ['Rahul Joshi', 'rahul.joshi', 'intern', 'Production', 'Production Intern', 'intern', 180000],
  // Functional — 2 TL, 3 TA, 4 Emp, 3 Intern
  ['Meera Iyer', 'meera.iyer', 'team_lead', 'Functional', 'Functional Lead', 'full_time', 720000],
  ['Siddharth Bose', 'siddharth.bose', 'team_lead', 'Functional', 'Sr Functional Lead', 'full_time', 720000],
  ['Pooja Agarwal', 'pooja.agarwal', 'team_admin', 'Functional', 'Functional Coordinator', 'full_time', 540000],
  ['Vivek Menon', 'vivek.menon', 'team_admin', 'Functional', 'Functional Coordinator', 'full_time', 540000],
  ['Aisha Khan', 'aisha.khan', 'team_admin', 'Functional', 'Functional Coordinator', 'full_time', 540000],
  ['Nikhil Jain', 'nikhil.jain', 'employee', 'Functional', 'Functional Analyst', 'full_time', 420000],
  ['Shruti Das', 'shruti.das', 'employee', 'Functional', 'Functional Analyst', 'full_time', 420000],
  ['Karthik Narayan', 'karthik.narayan', 'employee', 'Functional', 'Functional Consultant', 'full_time', 420000],
  ['Swati Mishra', 'swati.mishra', 'employee', 'Functional', 'Functional Consultant', 'full_time', 420000],
  ['Varun Bhat', 'varun.bhat', 'intern', 'Functional', 'Functional Intern', 'intern', 180000],
  ['Nisha Patel', 'nisha.patel', 'intern', 'Functional', 'Functional Intern', 'intern', 180000],
  ['Deepak Yadav', 'deepak.yadav', 'intern', 'Functional', 'Functional Intern', 'intern', 180000],
  // Technical — 2 TL, 3 TA, 4 Emp, 3 Intern
  ['Sameer Choudhary', 'sameer.choudhary', 'team_lead', 'Technical', 'Technical Lead', 'full_time', 720000],
  ['Ishita Kapoor', 'ishita.kapoor', 'team_lead', 'Technical', 'Sr Technical Lead', 'full_time', 720000],
  ['Amit Trivedi', 'amit.trivedi', 'team_admin', 'Technical', 'Tech Coordinator', 'full_time', 540000],
  ['Ritu Malhotra', 'ritu.malhotra', 'team_admin', 'Technical', 'Tech Coordinator', 'full_time', 540000],
  ['Sanjay Gowda', 'sanjay.gowda', 'team_admin', 'Technical', 'Tech Coordinator', 'full_time', 540000],
  ['Karun Nair', 'karun.nair', 'employee', 'Technical', 'Software Engineer', 'full_time', 420000],
  ['Jagadeesh Kumar', 'jagadeesh.kumar', 'employee', 'Technical', 'Senior Engineer', 'full_time', 480000],
  ['Ravi Patel', 'ravi.patel', 'employee', 'Technical', 'Software Engineer', 'full_time', 420000],
  ['Ananya Singh', 'ananya.singh', 'employee', 'Technical', 'Software Engineer', 'full_time', 420000],
  ['Rohit Saini', 'rohit.saini', 'intern', 'Technical', 'Tech Intern', 'intern', 180000],
  ['Tara Hegde', 'tara.hegde', 'intern', 'Technical', 'Tech Intern', 'intern', 180000],
  ['Mohit Arora', 'mohit.arora', 'intern', 'Technical', 'Tech Intern', 'intern', 180000],
];

const COHORT_EMAILS = ROSTER.map(([, local]) => `${local}@${DOMAIN}`.toLowerCase());

const toYYYYMMDD = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const initials = (name) => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const pad2 = (n) => String(n).padStart(2, '0');
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function main() {
  console.log(`Roster: ${ROSTER.length} employees | password: ${PASSWORD} | domain: ${DOMAIN}`);
  if (ROSTER.length !== 40) throw new Error(`Expected 40, got ${ROSTER.length}`);

  // Duplicate check inside roster
  const dupes = COHORT_EMAILS.filter((e, i) => COHORT_EMAILS.indexOf(e) !== i);
  if (dupes.length) throw new Error(`Duplicate emails in roster: ${dupes.join(',')}`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN (no DB writes) ---');
    const counts = {};
    for (const [, , role, dept] of ROSTER) counts[`${dept}/${role}`] = (counts[`${dept}/${role}`] || 0) + 1;
    console.table(counts);
    console.log('\nSample rows (first 5):');
    ROSTER.slice(0, 5).forEach(([n, l, r, d, des]) =>
      console.log(`  ${n} | ${l}@${DOMAIN} | ${r} | ${d} | ${des} | pwd=${PASSWORD} | isFirstLogin=true`));
    console.log('\nHistory plan: attendance last 45 weekdays (past only), 2 approved past leaves each,');
    console.log('payroll for last 2 elapsed months, 3 past-due tasks each, 1 past project per dept.');
    console.log('Linkage: employee/intern teamLeadId+teamAdminId -> same-dept TL/TA (round-robin).');
    return;
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const existing = await db.collection('users').find({ email: { $in: COHORT_EMAILS } }).project({ email: 1 }).toArray();
  if (existing.length && !FORCE) {
    console.error(`\nABORT: ${existing.length} cohort users already exist (e.g. ${existing[0].email}).`);
    console.error('Re-run with --force to delete ONLY this cohort and re-seed, or remove them manually.');
    await mongoose.disconnect();
    process.exit(2);
  }

  if (FORCE && existing.length) {
    console.log(`\n--force: removing ${existing.length} existing cohort users + linked docs...`);
    const ids = (await db.collection('users').find({ email: { $in: COHORT_EMAILS } }).project({ _id: 1 }).toArray()).map((u) => u._id);
    const idSet = new Set(ids.map(String));
    // linked identity/profile ids
    const usersFull = await db.collection('users').find({ _id: { $in: ids } }).project({ identityId: 1, profileId: 1 }).toArray();
    const identityIds = usersFull.map((u) => u.identityId).filter(Boolean);
    const profileIds = usersFull.map((u) => u.profileId).filter(Boolean);
    const del = async (col, filter) => { try { const r = await db.collection(col).deleteMany(filter); console.log(`  cleared ${r.deletedCount} from ${col}`); } catch (e) { console.log(`  skip ${col}: ${e.message}`); } };
    await del('users', { _id: { $in: ids } });
    await del('usr_identites', { _id: { $in: identityIds } });
    await del('usr_identities', { _id: { $in: identityIds } });
    await del('emp_profiles', { _id: { $in: profileIds } });
    await del('employees', { userId: { $in: ids } });
    await del('salarystructures', { userId: { $in: ids } });
    await del('attendances', { userId: { $in: ids } });
    await del('leaves', { userId: { $in: ids } });
    await del('payrolls', { userId: { $in: ids } });
    await del('goals', { userId: { $in: ids } });
    await del('reviews', { userId: { $in: ids } });
    await del('tasks', { assignedTo: { $in: ids } });
    await del('userleavebalances', { userId: { $in: ids } });
    await del('notifications', { userId: { $in: ids } });
    // projects created by cohort tag
    await del('projects', { name: { $in: ['ProdOps', 'FuncTransform', 'TechPlatform'] } });
    console.log(`  (super_admin untouched; ${idSet.size} cohort ids removed)`);
  }

  // ── Upsert departments + shift ──
  for (const dept of ['Management', 'Production', 'Functional', 'Technical']) {
    await db.collection('departments').findOneAndUpdate(
      { name: dept },
      { $setOnInsert: { name: dept, head: '', visibleDepartments: [], createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true }
    );
  }
  await db.collection('shifts').findOneAndUpdate(
    { name: 'Morning (9AM-6PM)' },
    { $setOnInsert: { name: 'Morning (9AM-6PM)', startTime: '09:00', endTime: '18:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true }
  );
  const adminUser = await db.collection('users').findOne({ role: 'super_admin' });

  // One shared bcrypt hash for the common password (compare() still passes for every user)
  console.log('Hashing password (bcrypt 12)...');
  const hashedPassword = await bcrypt.hash(PASSWORD, 12);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Hire dates: deterministic past spread 2022-2024 (never future)
  const hireFor = (i) => new Date(2022 + (i % 3), (i * 5) % 12, 1 + ((i * 7) % 27));

  // ── Pass 1: create users (no links yet) ──
  console.log('Creating 40 users...');
  const byEmail = new Map();
  const userDocs = ROSTER.map(([name, local, role, department, designation], i) => {
    const _id = new mongoose.Types.ObjectId();
    const email = `${local}@${DOMAIN}`.toLowerCase();
    const doc = {
      _id, name, email, password: hashedPassword, role,
      identityId: null, profileId: null,
      department, designation,
      teamLeadId: null, teamAdminId: null,
      phone: `98${String(76540000 + i)}`,
      shift: 'Morning (9AM-6PM)', shiftId: null,
      avatar: initials(name), profilePhoto: '', skills: [],
      joinDate: hireFor(i), status: 'active', smeId: null,
      isFirstLogin: true, firstLoginAt: null,
      loginAttempts: 0, lockUntil: null,
      resetToken: null, resetTokenExpiry: null,
      leaveBalance: 24,
      createdAt: now, updatedAt: now,
    };
    byEmail.set(email, doc);
    return doc;
  });
  await db.collection('users').insertMany(userDocs, { ordered: false });

  const idOf = (email) => byEmail.get(email)._id;
  const deptTL = {}; const deptTA = {};
  for (const [, local, role, dept] of ROSTER) {
    const email = `${local}@${DOMAIN}`;
    if (role === 'team_lead') (deptTL[dept] = deptTL[dept] || []).push(idOf(email));
    if (role === 'team_admin') (deptTA[dept] = deptTA[dept] || []).push(idOf(email));
  }

  // ── Pass 2: wire teamLeadId / teamAdminId ──
  console.log('Wiring reporting lines (employee/intern -> same-dept TL/TA)...');
  const bulkUser = [];
  let linkIdx = 0;
  for (const [, local, role, dept] of ROSTER) {
    const email = `${local}@${DOMAIN}`;
    const leads = deptTL[dept] || []; const admins = deptTA[dept] || [];
    let teamLeadId = null; let teamAdminId = null;
    if (role === 'team_admin' && leads.length) teamLeadId = leads[linkIdx % leads.length];
    if ((role === 'employee' || role === 'intern') && dept !== 'Management') {
      if (leads.length) teamLeadId = leads[linkIdx % leads.length];
      if (admins.length) teamAdminId = admins[linkIdx % admins.length];
      linkIdx++;
    }
    byEmail.get(email).teamLeadId = teamLeadId;
    byEmail.get(email).teamAdminId = teamAdminId;
    bulkUser.push({ updateOne: { filter: { _id: idOf(email) }, update: { $set: { teamLeadId, teamAdminId } } } });
  }
  if (bulkUser.length) await db.collection('users').bulkWrite(bulkUser);

  // ── Pass 3: identity + employment profile + legacy employee + salary ──
  console.log('Creating identities, profiles, employee records, salary structures...');
  const year = now.getFullYear();
  const existingProfiles = await db.collection('emp_profiles').countDocuments();
  let seq = existingProfiles + 1;
  const identities = []; const profiles = []; const employees = []; const salaries = [];
  const userLinkOps = [];
  ROSTER.forEach(([name, local, role, department, designation, employmentType, grossLPA], i) => {
    const email = `${local}@${DOMAIN}`;
    const userId = idOf(email);
    const parts = name.trim().split(/\s+/);
    const identityId = new mongoose.Types.ObjectId();
    const profileId = new mongoose.Types.ObjectId();
    const employeeNumber = `CHC-${hireFor(i).getFullYear()}-${String(seq++).padStart(4, '0')}`;
    const hireDate = hireFor(i);
    const leads = deptTL[department] || []; const admins = deptTA[department] || [];

    identities.push({
      _id: identityId, identityCode: `UID-${Date.now()}-${i}${rand(100, 999)}`, authUserId: userId,
      legalFirstName: parts[0], legalMiddleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
      legalLastName: parts.length > 1 ? parts[parts.length - 1] : '',
      legalName: name, preferredName: parts[0], displayName: name,
      primaryEmail: email, personalPhone: `98${String(76540000 + i)}`,
      dateOfBirth: null, gender: 'prefer_not_to_say', maritalStatus: 'prefer_not_to_say',
      nationality: 'Indian', bloodGroup: '',
      identifiers: { pan: {}, aadhaar: {} },
      addressHistory: [{ addressType: 'current', line1: `${100 + i} Main Road`, line2: '', city: 'Bengaluru', state: 'Karnataka', country: 'India', postalCode: '560001', landmark: '', isCurrent: true, effectiveFrom: hireDate, effectiveTo: null, source: 'manual' }],
      emergencyContacts: [{ name: `${parts[0]} Family`, relation: 'Family', phone: `99${String(87650000 + i)}`, email: '', isPrimary: true }],
      recordStatus: 'active', sourceSystem: 'manual', customAttributes: {}, notes: 'Seeded CHC40 cohort',
      createdAt: now, updatedAt: now,
    });

    profiles.push({
      _id: profileId, identityId, employeeNumber,
      employmentType, employmentStatus: 'active',
      department, designation, businessUnit: department, workLocation: 'Bengaluru',
      shift: 'Morning (9AM-6PM)', shiftId: null, rbacRole: role,
      hireDate, probationStartDate: hireDate,
      probationEndDate: addDays(hireDate, 180), probationEndNotifiedAt: null,
      confirmationDate: addDays(hireDate, 180), rehireCount: 0, originalHireDate: hireDate,
      reportingLine: {
        teamLeadIdentityId: null, teamAdminIdentityId: null,
      },
      compensationSnapshot: { currency: 'INR', grade: '', payGroup: '', band: '' },
      separation: {}, separationHistory: [],
      sourceSystem: 'manual', notes: 'Seeded CHC40 cohort', isLocked: false,
      createdAt: now, updatedAt: now,
    });

    employees.push({
      userId, name, email, phone: `98${String(76540000 + i)}`,
      department, designation, role, shift: 'Morning (9AM-6PM)', shiftId: null,
      avatar: initials(name), skills: [], joinDate: hireDate, status: 'active',
      teamLeadId: byEmail.get(email).teamLeadId, teamAdminId: byEmail.get(email).teamAdminId,
      smeId: null, leaveBalance: 24, createdAt: now, updatedAt: now,
    });

    salaries.push({ userId, grossLPA, ruleId: null, overrides: [], createdAt: now, updatedAt: now });
    userLinkOps.push({ updateOne: { filter: { _id: userId }, update: { $set: { identityId, profileId } } } });
  });
  await db.collection('usr_identities').insertMany(identities, { ordered: false });
  await db.collection('emp_profiles').insertMany(profiles, { ordered: false });
  await db.collection('employees').insertMany(employees, { ordered: false });
  await db.collection('salarystructures').insertMany(salaries, { ordered: false });
  await db.collection('users').bulkWrite(userLinkOps);

  // ── Past-only history ──
  // Attendance: last 45 calendar days ending yesterday, weekdays only
  console.log('Seeding past attendance (45 days, weekdays, no future)...');
  const attDocs = [];
  for (const [, local] of ROSTER) {
    const userId = idOf(`${local}@${DOMAIN}`);
    for (let back = 1; back <= 45; back++) {
      const d = addDays(today, -back);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const dateStr = toYYYYMMDD(d);
      const roll = Math.random();
      if (roll < 0.08) {
        attDocs.push({ userId, date: dateStr, status: 'absent', hoursWorked: 0, createdAt: now, updatedAt: now });
      } else if (roll < 0.16) {
        attDocs.push({
          userId, date: dateStr, clockIn: `10:${pad2(rand(5, 45))}`, clockOut: `18:${pad2(rand(10, 50))}`,
          hoursWorked: rand(420, 520), baseHoursWorked: rand(420, 520), breakDeduction: 60,
          breaks: [{ type: 'lunch', start: '13:00', end: '14:00' }],
          workProgress: [{ type: 'task', taskDetails: pick(['Module work', 'Bug fixes', 'Code review', 'Testing', 'Documentation']), startTime: '10:30', endTime: '17:30', status: 'completed', remarks: '', feedback: '', duration: 420 }],
          status: 'late', lateFlag: true, note: 'Arrived late', createdAt: now, updatedAt: now,
        });
      } else {
        attDocs.push({
          userId, date: dateStr, clockIn: `09:${pad2(rand(0, 25))}`, clockOut: `18:${pad2(rand(0, 45))}`,
          hoursWorked: rand(480, 560), baseHoursWorked: rand(480, 560), breakDeduction: 60,
          breaks: [{ type: 'lunch', start: '13:00', end: '14:00' }],
          workProgress: [{ type: 'task', taskDetails: pick(['Module work', 'Feature development', 'Code review', 'Testing', 'Client call']), startTime: '09:30', endTime: '18:00', status: 'completed', remarks: '', feedback: '', duration: 480 }],
          status: 'present', lateFlag: false, note: '', createdAt: now, updatedAt: now,
        });
      }
    }
  }
  if (attDocs.length) {
    // ordered:false so one duplicate doesn't kill the batch
    await db.collection('attendances').insertMany(attDocs, { ordered: false }).catch(() => {});
  }
  console.log(`  attendance rows: ${attDocs.length}`);

  // Leaves: 2 approved past leaves per user (never future, never pending-future)
  console.log('Seeding past approved leaves + balances...');
  let policy = await db.collection('leavepolicies').findOne({ isDefault: true });
  if (!policy) policy = await db.collection('leavepolicies').findOne({});
  const leaveDocs = [];
  for (const [, local] of ROSTER) {
    const userId = idOf(`${local}@${DOMAIN}`);
    const l1from = addDays(today, -rand(12, 20));
    const l2from = addDays(today, -rand(30, 44));
    // clamp guard: ensure strictly past
    for (const [from, type, typeCode, days, reason] of [
      [l1from, 'Casual Leave', 'CL', 2, 'Personal work'],
      [l2from, 'Sick Leave', 'SL', 1, 'Fever'],
    ]) {
      const to = addDays(from, days - 1);
      if (from >= today || to >= today) continue; // past-only guard
      leaveDocs.push({
        userId, type, typeCode, policyId: policy?._id || null,
        from: toYYYYMMDD(from), to: toYYYYMMDD(to), days,
        paidDays: days, unpaidDays: 0, reason, documents: [], status: 'approved', balanceApplied: true,
        adminApproval: 'approved', adminApprovedBy: adminUser?._id || userId, adminApprovedAt: now,
        teamAdminApproval: 'approved', teamAdminApprovedBy: adminUser?._id || userId, teamAdminApprovedAt: now,
        tlApproval: 'approved', tlApprovedBy: adminUser?._id || userId, tlApprovedAt: now,
        workflowApprovals: [], createdAt: from, updatedAt: now,
      });
    }
  }
  if (leaveDocs.length) await db.collection('leaves').insertMany(leaveDocs, { ordered: false });
  console.log(`  leave rows: ${leaveDocs.length}`);

  // Payroll: last 2 fully elapsed months (past only)
  console.log('Seeding payroll for last 2 elapsed months...');
  const payMonths = [];
  for (let m = 1; m <= 2; m++) {
    const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
    payMonths.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  const payrollDocs = [];
  for (const [, local, , , , , grossLPA] of ROSTER) {
    const userId = idOf(`${local}@${DOMAIN}`);
    for (const month of payMonths) {
      const [yr, mo] = month.split('-').map(Number);
      const dim = new Date(yr, mo, 0).getDate();
      const workingDays = dim - 8; // approx past working days
      const lopDays = rand(0, 1);
      const monthlyGross = Math.round((grossLPA / 12) * 100) / 100;
      const basic = Math.round(monthlyGross * 0.5 * 100) / 100;
      const hra = Math.round(monthlyGross * 0.2 * 100) / 100;
      const da = Math.round(monthlyGross * 0.15 * 100) / 100;
      const ca = Math.round(monthlyGross * 0.1 * 100) / 100;
      const ma = Math.round((monthlyGross - basic - hra - da - ca) * 100) / 100;
      const pf = Math.min(Math.round((basic + da) * 0.12 * 100) / 100, 1800);
      const esi = monthlyGross <= 21000 ? Math.round(monthlyGross * 0.0075 * 100) / 100 : 0;
      const salaryPerDay = workingDays > 0 ? Math.round((monthlyGross / workingDays) * 100) / 100 : 0;
      const lossOfPay = Math.round(salaryPerDay * lopDays * 100) / 100;
      const totalDeductions = Math.round((pf + esi + lossOfPay) * 100) / 100;
      payrollDocs.push({
        userId, month, monthlyGross, basicPay: basic, hra,
        dearnessAllowance: da, conveyanceAllowance: ca, medicalAllowance: ma,
        pf, esi, lossOfPay, totalDeductions, netPay: Math.round((monthlyGross - totalDeductions) * 100) / 100,
        presentDays: workingDays - lopDays, lopDays, workingDays, salaryPerDay,
        status: 'finalized',
        processedBy: adminUser?._id || null, processedAt: now,
        approvedBy: adminUser?._id || null, approvedAt: now,
        finalizedBy: adminUser?._id || null, finalizedAt: now,
        createdAt: now, updatedAt: now,
      });
    }
  }
  if (payrollDocs.length) await db.collection('payrolls').insertMany(payrollDocs, { ordered: false }).catch(() => {});
  console.log(`  payroll rows: ${payrollDocs.length} (${payMonths.join(', ')})`);

  // Projects (1 per dept, past dates) + tasks (2 past-due per user)
  console.log('Seeding past projects + tasks...');
  const projDefs = [
    ['ProdOps', 'Production operations track', 'Production'],
    ['FuncTransform', 'Functional transformation track', 'Functional'],
    ['TechPlatform', 'Technical platform track', 'Technical'],
  ];
  const projIds = [];
  for (const [pname, pdesc, pdept] of projDefs) {
    const team = ROSTER.filter(([, , , d]) => d === pdept).map(([, l]) => idOf(`${l}@${DOMAIN}`));
    const r = await db.collection('projects').insertOne({
      name: pname, description: pdesc, team, departments: [pdept],
      startDate: toYYYYMMDD(addDays(today, -60)), endDate: toYYYYMMDD(addDays(today, -5)),
      progress: rand(60, 100), status: 'completed',
      createdBy: adminUser?._id || team[0], createdAt: addDays(today, -60), updatedAt: now,
    });
    projIds.push({ id: r.insertedId, dept: pdept });
  }
  const taskTitles = ['AuthModule', 'UnitTestsAPI', 'APIDocs', 'FixUIBug', 'RefactorQueries', 'ExportCSV', 'EmailTpl', 'CodeReview'];
  const taskDocs = [];
  for (const [, local, , dept] of ROSTER) {
    if (dept === 'Management') continue;
    const proj = projIds.find((p) => p.dept === dept) || projIds[0];
    for (let t = 0; t < 2; t++) {
      const due = addDays(today, -rand(3, 30)); // past only
      taskDocs.push({
        title: pick(taskTitles).slice(0, 30), description: `Past test task for ${local}`,
        projectId: proj.id, assignedTo: idOf(`${local}@${DOMAIN}`),
        assignedBy: deptTL[dept]?.[0] || adminUser?._id || null,
        priority: pick(['low', 'medium', 'high']), status: pick(['Completed', 'Completed', 'In Progress']),
        due: toYYYYMMDD(due), createdAt: addDays(today, -40), updatedAt: now,
      });
    }
  }
  if (taskDocs.length) await db.collection('tasks').insertMany(taskDocs, { ordered: false });
  console.log(`  projects: ${projIds.length}, tasks: ${taskDocs.length}`);

  // Goals (past cycle, 2 per user)
  const goalDocs = [];
  for (const [, local] of ROSTER) {
    const userId = idOf(`${local}@${DOMAIN}`);
    goalDocs.push(
      { userId, title: 'Complete assigned tasks on time', kpi: 'Task completion', target: '95%', progress: rand(60, 100), status: 'achieved', cycle: 'Past cycle', createdAt: addDays(today, -50), updatedAt: now },
      { userId, title: 'Improve code quality', kpi: 'Review score', target: '4+', progress: rand(50, 95), status: 'in_progress', cycle: 'Past cycle', createdAt: addDays(today, -50), updatedAt: now },
    );
  }
  await db.collection('goals').insertMany(goalDocs, { ordered: false }).catch(() => {});
  console.log(`  goals: ${goalDocs.length}`);

  // Department member counts (recount, past-consistent)
  for (const dept of ['Management', 'Production', 'Functional', 'Technical']) {
    const c = await db.collection('users').countDocuments({ department: dept, status: 'active' });
    await db.collection('departments').updateOne({ name: dept }, { $set: { members: c, updatedAt: new Date() } });
    console.log(`  ${dept}: ${c} active users`);
  }

  console.log('\n======================================================');
  console.log('CHC40 seed complete: 40 users, all password = Chc@2025');
  console.log('isFirstLogin=true for all (will be asked to reset on first login).');
  console.log('No super_admin created/touched. No future-dated rows.');
  console.log('======================================================');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('Seed failed:', e.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
