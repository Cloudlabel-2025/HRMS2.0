import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import Attendance from '@/lib/models/Attendance';
import Leave from '@/lib/models/Leave';
import { Payroll, SalaryStructure, Project, Task } from '@/lib/models';
import { Goal, Review, Document, Announcement, Asset, AuditLog, Absence, Notification, Department, Shift, Holiday, Settings, EmpLifecycleHistory, SelfServiceRequest, Employee, AttendanceRegularization } from '@/lib/models';
import { ok, fail } from '@/lib/jwt';
import bcrypt from 'bcryptjs';

function getSubmittedSetupToken(req, body = {}) {
  return req.headers.get('x-setup-token') || body.setupToken || '';
}

function formatDate(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 7) + '-' + String(d.getDate()).padStart(2, '0');
  // actually we use YYYY-MM-DD
}

function toYYYYMMDD(date) {
  return date.toISOString().slice(0, 10);
}

function toHHMM(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const TASK_STATUSES = ['To Do', 'In Progress', 'Completed', 'Blocked'];
const WP_STATUSES = ['pending', 'work_in_progress', 'completed', 'task_blocked', 'stopped'];
const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Compensatory Leave'];

const TASK_TEMPLATES = [
  'Implement user authentication module',
  'Design dashboard wireframes',
  'Write unit tests for API endpoints',
  'Refactor database queries for performance',
  'Create API documentation',
  'Fix UI responsiveness issues',
  'Integrate payment gateway',
  'Set up CI/CD pipeline',
  'Conduct code review for PR #42',
  'Update dependency versions',
  'Migrate legacy data to new schema',
  'Build notification service',
  'Optimize image loading',
  'Create onboarding guide',
  'Implement search functionality',
  'Add export to CSV feature',
  'Fix login redirect bug',
  'Design email templates',
  'Create backup strategy document',
  'Set up monitoring dashboards',
];

const PROJECT_TEMPLATES = [
  { name: 'HR Portal Redesign', desc: 'Complete redesign of the internal HR portal with modern UI and improved UX' },
  { name: 'Payroll System Upgrade', desc: 'Upgrade payroll processing system to support new tax regulations' },
  { name: 'Employee Mobile App', desc: 'Build a mobile application for employees to manage attendance, leaves, and tasks' },
];

const WP_TASK_TEMPLATES = [
  'Working on module integration',
  'Debugging production issue',
  'Reviewing pull requests',
  'Writing documentation',
  'Testing new features',
  'Code refactoring',
  'Database optimization',
  'UI component development',
  'API endpoint implementation',
  'Meeting with stakeholders',
];

const GOAL_TEMPLATES = [
  { title: 'Complete 95% of assigned tasks on time', kpi: 'Task completion rate', target: '95%' },
  { title: 'Reduce production bugs by 30%', kpi: 'Bug reduction rate', target: '30%' },
  { title: 'Improve code coverage to 80%', kpi: 'Code coverage percentage', target: '80%' },
  { title: 'Complete 3 technical certifications', kpi: 'Certifications earned', target: '3' },
  { title: 'Mentor 2 junior developers', kpi: 'Mentees assigned', target: '2' },
];

const REVIEW_CYCLES = ['Q1 2026', 'Q2 2026'];

export async function POST(req) {
  try {
    const expectedToken = process.env.SETUP_TOKEN;
    if (!expectedToken) return fail('Seed route is disabled. Set SETUP_TOKEN.', 403);
    const body = await req.json().catch(() => ({}));
    if (getSubmittedSetupToken(req, body) !== expectedToken) return fail('Invalid setup token', 403);

    await dbConnect();

    // Fetch admin user for reference
    const admin = await User.findOne({ role: 'super_admin' });
    if (!admin) return fail('No super admin found. Run /api/seed first.', 400);

    const existing = await User.findOne({ email: 'karun@hrms.com' });
    if (existing) return fail('Test data already seeded. Drop the collection first.', 409);

    // ── 1. Settings: Department, Shift, Holidays ─────────────────────────
    await Department.findOneAndUpdate({ name: 'Engineering' }, { name: 'Engineering', head: 'Super Admin', members: 2 }, { upsert: true });
    await Department.findOneAndUpdate({ name: 'Design' }, { name: 'Design', head: 'Super Admin', members: 0 }, { upsert: true });
    await Department.findOneAndUpdate({ name: 'Marketing' }, { name: 'Marketing', head: 'Super Admin', members: 0 }, { upsert: true });
    await Department.findOneAndUpdate({ name: 'Sales' }, { name: 'Sales', head: 'Super Admin', members: 0 }, { upsert: true });
    await Department.findOneAndUpdate({ name: 'HR' }, { name: 'HR', head: 'Super Admin', members: 0 }, { upsert: true });
    await Department.findOneAndUpdate({ name: 'Finance' }, { name: 'Finance', head: 'Super Admin', members: 0 }, { upsert: true });

    await Shift.findOneAndUpdate({ name: 'Morning (9AM-6PM)' }, { name: 'Morning (9AM-6PM)', startTime: '09:00', endTime: '18:00', days: ['Monday','Tuesday','Wednesday','Thursday','Friday'] }, { upsert: true });
    await Shift.findOneAndUpdate({ name: 'General' }, { name: 'General', startTime: '09:00', endTime: '18:00', days: ['Monday','Tuesday','Wednesday','Thursday','Friday'] }, { upsert: true });

    const today = new Date();
    const holidays = [
      { name: 'Republic Day', date: `2026-01-26`, type: 'National' },
      { name: 'Independence Day', date: `2026-08-15`, type: 'National' },
      { name: 'Diwali', date: `2026-11-01`, type: 'National' },
    ];
    for (const h of holidays) await Holiday.findOneAndUpdate({ date: h.date }, h, { upsert: true });

    // ── 2. Employee definitions ──────────────────────────────────────────
    const employees = [
      {
        name: 'Karun', email: 'karun@hrms.com', password: 'Test@123456',
        role: 'employee', department: 'Engineering', designation: 'Software Engineer',
        phone: '9876543210', shift: 'Morning (9AM-6PM)', skills: ['React','Node.js','MongoDB','TypeScript'],
        empNumber: 'EMP-2026-001', leaveBalance: 18,
        identity: { legalName: 'Karun', preferredName: 'Karun', bloodGroup: 'O+', gender: 'male', nationality: 'Indian', maritalStatus: 'single' },
        address: { line1: '123 Tech Park', city: 'Bangalore', state: 'Karnataka', postalCode: '560001', country: 'India' },
        emergency: { name: 'Karun Mother', relation: 'Mother', phone: '9988776655' },
        hireDate: new Date('2024-06-01'),
      },
      {
        name: 'Jagadeesh', email: 'jagadeesh@hrms.com', password: 'Test@123456',
        role: 'employee', department: 'Engineering', designation: 'Senior Software Engineer',
        phone: '9876543211', shift: 'Morning (9AM-6PM)', skills: ['React','Node.js','AWS','Python','Docker'],
        empNumber: 'EMP-2026-002', leaveBalance: 20,
        identity: { legalName: 'Jagadeesh', preferredName: 'Jagadeesh', bloodGroup: 'B+', gender: 'male', nationality: 'Indian', maritalStatus: 'married' },
        address: { line1: '456 Tech Hub', city: 'Bangalore', state: 'Karnataka', postalCode: '560002', country: 'India' },
        emergency: { name: 'Jagadeesh Wife', relation: 'Spouse', phone: '9988776644' },
        hireDate: new Date('2023-03-15'),
      },
    ];

    const createdUsers = [];

    for (const empDef of employees) {
      // ── 2a. Create User ────────────────────────────────────────────────
      // Raw password — User pre('save') hook hashes it automatically at 12 rounds
      const user = await User.create({
        name: empDef.name,
        email: empDef.email,
        password: empDef.password,
        role: empDef.role,
        department: empDef.department,
        designation: empDef.designation,
        phone: empDef.phone,
        shift: empDef.shift,
        skills: empDef.skills,
        joinDate: empDef.hireDate,
        status: 'active',
        leaveBalance: empDef.leaveBalance,
        isFirstLogin: false,
        firstLoginAt: new Date('2026-04-01'),
      });

      // ── 2b. Create Identity ─────────────────────────────────────────────
      const identity = await UsrIdentity.create({
        identityCode: `ID-${empDef.empNumber}`,
        authUserId: user._id,
        legalFirstName: empDef.name,
        legalName: empDef.identity.legalName,
        preferredName: empDef.identity.preferredName,
        displayName: empDef.name,
        primaryEmail: empDef.email,
        personalPhone: empDef.phone,
        gender: empDef.identity.gender,
        maritalStatus: empDef.identity.maritalStatus,
        nationality: empDef.identity.nationality,
        bloodGroup: empDef.identity.bloodGroup,
        addressHistory: [{
          addressType: 'current',
          line1: empDef.address.line1,
          city: empDef.address.city,
          state: empDef.address.state,
          country: empDef.address.country,
          postalCode: empDef.address.postalCode,
          isCurrent: true,
        }],
        emergencyContacts: [{
          name: empDef.emergency.name,
          relation: empDef.emergency.relation,
          phone: empDef.emergency.phone,
          isPrimary: true,
        }],
        recordStatus: 'active',
        sourceSystem: 'manual',
      });

      // ── 2c. Create Employment Profile ───────────────────────────────────
      const profile = await EmpProfile.create({
        identityId: identity._id,
        employeeNumber: empDef.empNumber,
        employmentType: 'full_time',
        employmentStatus: 'active',
        department: empDef.department,
        designation: empDef.designation,
        businessUnit: 'Engineering',
        workLocation: 'Bangalore',
        shift: empDef.shift,
        hireDate: empDef.hireDate,
        confirmationDate: new Date(empDef.hireDate.getTime() + 6 * 30 * 24 * 60 * 60 * 1000),
        reportingLine: { reportsToUserId: admin._id },
        sourceSystem: 'manual',
      });

      // Link back to user
      await User.findByIdAndUpdate(user._id, { identityId: identity._id, profileId: profile._id });

      // ── 2d. Lifecycle History ───────────────────────────────────────────
      await EmpLifecycleHistory.create({
        entityType: 'identity',
        entityId: identity._id,
        identityId: identity._id,
        profileId: profile._id,
        eventType: 'create',
        action: 'Employee onboarded',
        fromState: 'none',
        toState: 'active',
        actorUserId: admin._id,
        actorRole: 'super_admin',
        isSystemGenerated: false,
      });

      // ── 2e. Legacy Employee record ──────────────────────────────────────
      await Employee.create({
        userId: user._id,
        name: empDef.name,
        email: empDef.email,
        phone: empDef.phone,
        department: empDef.department,
        designation: empDef.designation,
        role: empDef.role,
        shift: empDef.shift,
        joinDate: empDef.hireDate,
        status: 'active',
        leaveBalance: empDef.leaveBalance,
      });

      // ── 2f. Salary Structure ────────────────────────────────────────────
      const base = empDef.name === 'Karun' ? 35000 : 55000;
      const da = Math.round(base * 0.15);
      const hra = Math.round(base * 0.4);
      const ca = Math.round(base * 0.1);
      const medical = Math.round(base * 0.08);
      const bonus = Math.round(base * 0.1);
      const epfo = Math.round(base * 0.12);
      const esi = base <= 21000 ? Math.round(base * 0.0075) : 0;
      const professionalTax = base > 50000 ? 200 : 150;
      const lop = 0;
      const loan = 0;

      await SalaryStructure.create({
        userId: user._id,
        da, hra, ca, medical, bonus, epfo, esi, professionalTax, lop, loan,
      });

      createdUsers.push({ user, identity, profile, def: empDef, da, hra, ca, medical, bonus, epfo, esi, professionalTax });
    }

    // ── 3. Projects ─────────────────────────────────────────────────────
    const projects = [];
    for (const pt of PROJECT_TEMPLATES) {
      const proj = await Project.create({
        name: pt.name,
        description: pt.desc,
        team: createdUsers.map(u => u.user._id),
        deadline: toYYYYMMDD(addDays(today, randomInt(15, 60))),
        progress: randomInt(20, 80),
        status: randomPick(['active', 'active', 'active', 'completed']),
        createdBy: admin._id,
      });
      projects.push(proj);
    }

    // ── 4. Tasks ─────────────────────────────────────────────────────────
    for (const u of createdUsers) {
      for (let i = 0; i < 6; i++) {
        const proj = randomPick(projects);
        await Task.create({
          title: randomPick(TASK_TEMPLATES),
          description: `Assigned task for ${u.def.name}`,
          projectId: proj._id,
          assignedTo: u.user._id,
          assignedBy: admin._id,
          priority: randomPick(['low', 'medium', 'medium', 'high']),
          status: randomPick(TASK_STATUSES),
          due: toYYYYMMDD(addDays(today, randomInt(5, 45))),
          hours: randomInt(4, 40),
        });
      }
    }

    // ── 5. Attendance + Work Progress (last 60 days) ──────────────────
    for (const u of createdUsers) {
      for (let dayOffset = 60; dayOffset >= 0; dayOffset--) {
        const date = addDays(today, -dayOffset);
        const dateStr = toYYYYMMDD(date);
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // skip weekends

        // Determine if absent, leave, late, or present
        const roll = Math.random();
        let status, clockIn, clockOut, hoursWorked, lateFlag;
        if (roll < 0.1) {
          status = 'absent';
          clockIn = null;
          clockOut = null;
          hoursWorked = 0;
          lateFlag = false;
        } else if (roll < 0.18) {
          status = 'late';
          clockIn = toHHMM(new Date(date.getFullYear(), date.getMonth(), date.getDate(), randomInt(10, 11), randomInt(0, 59)));
          clockOut = toHHMM(new Date(date.getFullYear(), date.getMonth(), date.getDate(), randomInt(18, 19), randomInt(0, 59)));
          hoursWorked = randomInt(420, 540);
          lateFlag = true;
        } else {
          status = 'present';
          clockIn = toHHMM(new Date(date.getFullYear(), date.getMonth(), date.getDate(), randomInt(8, 9), randomInt(0, 30)));
          clockOut = toHHMM(new Date(date.getFullYear(), date.getMonth(), date.getDate(), randomInt(17, 19), randomInt(0, 59)));
          hoursWorked = randomInt(480, 600);
          lateFlag = false;
        }

        if (status === 'absent') {
          // Create absence record
          await Absence.create({ userId: u.user._id, date: dateStr, reason: 'No notification', flagged: Math.random() < 0.2 });
          // Also create attendance as absent
          await Attendance.create({ userId: u.user._id, date: dateStr, status, hoursWorked: 0 });
          continue;
        }

        // Generate work progress entries (2-5 per day)
        const numEntries = randomInt(2, 5);
        const wpEntries = [];
        let lastEnd = parseInt(clockIn.split(':')[0]) * 60 + parseInt(clockIn.split(':')[1]);
        const clockOutMins = parseInt(clockOut.split(':')[0]) * 60 + parseInt(clockOut.split(':')[1]);

        for (let wi = 0; wi < numEntries; wi++) {
          const duration = randomInt(30, 120);
          const startMins = Math.min(lastEnd, clockOutMins - duration);
          if (startMins >= clockOutMins) break;
          const endMins = Math.min(startMins + duration, clockOutMins);
          const startH = Math.floor(startMins / 60);
          const startM = startMins % 60;
          const endH = Math.floor(endMins / 60);
          const endM = endMins % 60;

          // Occasionally insert a break entry
          let wpType = 'task';
          let taskDetails = randomPick(WP_TASK_TEMPLATES);
          let wpStatus = randomPick(WP_STATUSES);
          if (wi === Math.floor(numEntries / 2)) {
            wpType = 'lunch';
            taskDetails = 'Lunch break';
            wpStatus = 'completed';
          } else if (Math.random() < 0.15) {
            wpType = 'break';
            taskDetails = 'Short break';
            wpStatus = 'completed';
          }

          wpEntries.push({
            type: wpType,
            taskDetails,
            startTime: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
            endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
            status: wpStatus,
            remarks: Math.random() < 0.5 ? randomPick(['In progress', 'Almost done', 'Need help', 'Blocked by dependency', 'Completed']) : '',
            feedback: Math.random() < 0.3 ? randomPick(['Good work', 'Needs improvement', 'On track', 'Well done']) : '',
          });
          lastEnd = endMins + randomInt(5, 15); // small gap between entries
          if (lastEnd >= clockOutMins) break;
        }

        await Attendance.create({
          userId: u.user._id,
          date: dateStr,
          clockIn,
          clockOut,
          hoursWorked,
          baseHoursWorked: hoursWorked,
          breakDeduction: 60,
          breaks: [{ type: 'lunch', start: '13:00', end: '14:00' }],
          workProgress: wpEntries,
          status,
          lateFlag,
          note: status === 'late' ? 'Arrived late today' : '',
        });
      }
    }

    // ── 6. Leave Requests ───────────────────────────────────────────────
    for (const u of createdUsers) {
      // Leave 1: Approved casual leave (past)
      const leaveDate1 = addDays(today, -randomInt(20, 40));
      const leaveDate2 = addDays(leaveDate1, 1);
      await Leave.create({
        userId: u.user._id,
        type: 'Casual Leave',
        from: toYYYYMMDD(leaveDate1),
        to: toYYYYMMDD(leaveDate2),
        days: 2,
        reason: 'Personal work',
        status: 'approved',
        adminApproval: 'approved',
        adminApprovedBy: admin._id,
        adminApprovedAt: new Date(),
        tlApproval: 'approved',
        tlApprovedBy: admin._id,
        tlApprovedAt: new Date(),
        teamAdminApproval: 'approved',
        teamAdminApprovedBy: admin._id,
        teamAdminApprovedAt: new Date(),
      });

      // Leave 2: Pending sick leave
      const sickDate = addDays(today, randomInt(5, 15));
      await Leave.create({
        userId: u.user._id,
        type: 'Sick Leave',
        from: toYYYYMMDD(sickDate),
        to: toYYYYMMDD(sickDate),
        days: 1,
        reason: 'Not feeling well',
        status: 'pending',
      });

      // Leave 3: Past approved earned leave
      const earnedDate = addDays(today, -randomInt(45, 55));
      await Leave.create({
        userId: u.user._id,
        type: 'Earned Leave',
        from: toYYYYMMDD(earnedDate),
        to: toYYYYMMDD(addDays(earnedDate, 2)),
        days: 3,
        reason: 'Family function',
        status: 'approved',
        adminApproval: 'approved',
        adminApprovedBy: admin._id,
        adminApprovedAt: new Date(),
        tlApproval: 'approved',
        tlApprovedBy: admin._id,
        tlApprovedAt: new Date(),
        teamAdminApproval: 'approved',
        teamAdminApprovedBy: admin._id,
        teamAdminApprovedAt: new Date(),
      });
    }

    // ── 7. Payroll (last 2 months) ──────────────────────────────────────
    const payMonths = [];
    const todayDate = new Date();
    for (let mi = 1; mi <= 2; mi++) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth() - mi, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      payMonths.push(monthStr);
    }

    for (const u of createdUsers) {
      for (const monthStr of payMonths) {
        const totalEarnings = u.da + u.hra + u.ca + u.medical + u.bonus;
        const totalDeductions = u.epfo + u.esi + u.professionalTax;
        const net = totalEarnings - totalDeductions;
        await Payroll.create({
          userId: u.user._id,
          month: monthStr,
          da: u.da,
          hra: u.hra,
          ca: u.ca,
          medical: u.medical,
          bonus: u.bonus,
          grossPay: totalEarnings,
          epfo: u.epfo,
          esi: u.esi,
          professionalTax: u.professionalTax,
          lop: 0,
          loan: 0,
          totalDeductions,
          netPay: net,
          presentDays: randomInt(20, 24),
          lopDays: randomInt(0, 2),
          status: 'finalized',
          processedBy: admin._id,
          processedAt: new Date(),
          approvedBy: admin._id,
          approvedAt: new Date(),
          finalizedBy: admin._id,
          finalizedAt: new Date(),
        });
      }
    }

    // ── 8. Performance: Goals ────────────────────────────────────────────
    for (const u of createdUsers) {
      for (let gi = 0; gi < 3; gi++) {
        const gt = GOAL_TEMPLATES[gi];
        await Goal.create({
          userId: u.user._id,
          title: gt.title,
          kpi: gt.kpi,
          target: gt.target,
          progress: randomInt(20, 90),
          status: randomPick(['in_progress', 'in_progress', 'achieved']),
          cycle: 'Q2 2026',
        });
      }
    }

    // ── 9. Performance: Reviews ──────────────────────────────────────────
    for (const u of createdUsers) {
      for (const cycle of REVIEW_CYCLES) {
        await Review.create({
          userId: u.user._id,
          cycle,
          selfScore: randomInt(3, 5),
          selfComment: 'I have completed all assigned tasks and helped team members.',
          peerScore: randomInt(3, 5),
          peerComment: 'Great team player with strong technical skills.',
          managerScore: randomInt(3, 5),
          managerComment: 'Consistent performer. Exceeds expectations.',
          managerBy: admin._id,
          overall: randomInt(3, 5),
          status: cycle === 'Q1 2026' ? 'completed' : 'in_review',
        });
      }
    }

    // ── 10. Assets ──────────────────────────────────────────────────────
    const assetDefs = [
      { name: 'Dell Latitude 5420', category: 'Laptop', assetId: 'AST-LAP-001', condition: 'good', value: 65000 },
      { name: 'Dell Monitor 24"', category: 'Monitor', assetId: 'AST-MON-001', condition: 'good', value: 15000 },
      { name: 'iPhone 14', category: 'Phone', assetId: 'AST-PHN-001', condition: 'good', value: 79000 },
      { name: 'Logitech Keyboard', category: 'Peripheral', assetId: 'AST-KEY-001', condition: 'good', value: 2500 },
      { name: 'MacBook Pro 16"', category: 'Laptop', assetId: 'AST-LAP-002', condition: 'good', value: 199000 },
      { name: 'Noise Cancelling Headphones', category: 'Peripheral', assetId: 'AST-HPH-001', condition: 'good', value: 12000 },
    ];

    // Assign 3 assets to each employee
    for (let i = 0; i < createdUsers.length; i++) {
      const u = createdUsers[i];
      const startIdx = i * 3;
      for (let ai = startIdx; ai < startIdx + 3; ai++) {
        const ad = assetDefs[ai];
        await Asset.create({
          assetId: ad.assetId,
          name: ad.name,
          category: ad.category,
          assignedTo: u.user._id,
          assignedOn: toYYYYMMDD(addDays(today, -randomInt(30, 90))),
          status: 'assigned',
          condition: ad.condition,
          value: ad.value,
        });
      }
    }

    // ── 11. Documents ────────────────────────────────────────────────────
    for (const u of createdUsers) {
      await Document.create({
        name: `Offer Letter - ${u.def.name}.pdf`,
        category: 'Employee',
        fileUrl: `/documents/offer-letter-${u.def.name.toLowerCase()}.pdf`,
        fileSize: `${randomInt(100, 500)} KB`,
        fileType: 'application/pdf',
        access: 'employee',
        uploadedBy: admin._id,
        employeeId: u.user._id,
        version: 1,
      });
      await Document.create({
        name: `NDA Agreement - ${u.def.name}.pdf`,
        category: 'Contract',
        fileUrl: `/documents/nda-${u.def.name.toLowerCase()}.pdf`,
        fileSize: `${randomInt(50, 200)} KB`,
        fileType: 'application/pdf',
        access: 'employee',
        uploadedBy: admin._id,
        employeeId: u.user._id,
        version: 1,
      });
      await Document.create({
        name: `ID Card - ${u.def.name}.jpg`,
        category: 'Employee',
        fileUrl: `/documents/id-${u.def.name.toLowerCase()}.jpg`,
        fileSize: `${randomInt(30, 100)} KB`,
        fileType: 'image/jpeg',
        access: 'employee',
        uploadedBy: admin._id,
        employeeId: u.user._id,
        version: 1,
      });
    }

    // ── 12. Announcements ────────────────────────────────────────────────
    await Announcement.create({
      title: 'Welcome to the new HR Portal',
      body: 'We are excited to announce the launch of our redesigned HR portal with modern features including real-time attendance tracking, leave management, and performance reviews.',
      author: admin._id,
      audience: 'Company-wide',
      tag: 'General',
      tagColor: '#3b82f6',
      pinned: true,
      likes: [createdUsers[0].user._id],
    });
    await Announcement.create({
      title: 'Engineering Team Update',
      body: 'The Engineering team has successfully completed the Q2 milestone. Great work everyone!',
      author: admin._id,
      audience: 'Engineering',
      tag: 'Team Update',
      tagColor: '#10b981',
      pinned: false,
      likes: [],
    });
    await Announcement.create({
      title: 'Upcoming Holiday: Diwali',
      body: 'Please note that the office will remain closed on Nov 1st for Diwali celebrations.',
      author: admin._id,
      audience: 'Company-wide',
      tag: 'Announcement',
      tagColor: '#f59e0b',
      pinned: false,
      likes: [createdUsers[0].user._id, createdUsers[1].user._id],
    });

    // ── 13. Audit Log ────────────────────────────────────────────────────
    const auditActions = [
      { action: 'Employee onboarded', module: 'Core HR', severity: 'medium' },
      { action: 'Salary structure created', module: 'Payroll', severity: 'medium' },
      { action: 'Asset assigned', module: 'Inventory', severity: 'low' },
      { action: 'Document uploaded', module: 'Documents', severity: 'low' },
      { action: 'Leave approved', module: 'Leave', severity: 'low' },
      { action: 'Payroll processed', module: 'Payroll', severity: 'high' },
      { action: 'Attendance regularized', module: 'Attendance', severity: 'low' },
    ];

    for (const u of createdUsers) {
      for (const aa of auditActions) {
        await AuditLog.create({
          action: aa.action,
          module: aa.module,
          userId: admin._id,
          targetUserId: u.user._id,
          details: `${aa.action} for ${u.def.name}`,
          severity: aa.severity,
          ip: '127.0.0.1',
        });
      }
    }

    // ── 14. Self-Service Requests ────────────────────────────────────────
    for (const u of createdUsers) {
      await SelfServiceRequest.create({
        identityId: u.identity._id,
        profileId: u.profile._id,
        requestType: 'profile_update',
        payload: { phone: u.def.phone + '00' },
        reason: 'Updated phone number',
        status: 'approved',
        reviewerUserId: admin._id,
        reviewedAt: new Date(),
        reviewNote: 'Approved',
        requestSource: 'employee',
      });
      await SelfServiceRequest.create({
        identityId: u.identity._id,
        profileId: u.profile._id,
        requestType: 'address_update',
        payload: { addressLine1: 'New Address Updated' },
        reason: 'Moved to new location',
        status: 'pending',
        requestSource: 'employee',
      });
    }

    // ── 15. Notifications ────────────────────────────────────────────────
    for (const u of createdUsers) {
      await Notification.create({ userId: u.user._id, title: 'Leave Approved', message: 'Your casual leave has been approved.', type: 'leave', read: true });
      await Notification.create({ userId: u.user._id, title: 'Payroll Processed', message: `Your payroll for ${payMonths[0]} has been processed.`, type: 'payroll', read: false });
      await Notification.create({ userId: u.user._id, title: 'Welcome Aboard', message: 'Welcome to the team! Complete your onboarding.', type: 'general', read: true });
    }

    // ── 16. Attendance Regularization Requests ───────────────────────────
    for (const u of createdUsers) {
      await AttendanceRegularization.create({
        userId: u.user._id,
        date: toYYYYMMDD(addDays(today, -randomInt(10, 20))),
        requestedIn: '08:30',
        requestedOut: '17:45',
        reason: 'Forgot to clock in',
        status: 'approved',
        reviewedBy: admin._id,
        reviewedAt: new Date(),
      });
      await AttendanceRegularization.create({
        userId: u.user._id,
        date: toYYYYMMDD(addDays(today, -randomInt(2, 8))),
        requestedIn: '09:15',
        requestedOut: '18:30',
        reason: 'Had network issues at clock in',
        status: 'pending',
      });
    }

    return ok({
      message: 'Test data seeded successfully',
      employees: createdUsers.map(u => ({
        name: u.def.name,
        email: u.def.email,
        password: u.def.password,
        userId: u.user._id,
        identityId: u.identity._id,
        profileId: u.profile._id,
      })),
    }, 201);

  } catch (e) {
    return fail(e.message, 500);
  }
}
