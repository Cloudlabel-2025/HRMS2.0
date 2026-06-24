import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const identities = db.collection('usridentities');
  const profiles = db.collection('empprofiles');
  const employees = db.collection('employees');
  const salaryStructs = db.collection('salarystructures');
  const lifecycle = db.collection('emplifecyclehistories');

  // 1. Reset super admin password
  const newHash = await bcrypt.hash('Admin123456', 12);
  await users.updateOne(
    { email: 'superadmin@hrms.com' },
    { $set: { password: newHash, loginAttempts: 0, lockUntil: null } }
  );
  console.log('✓ Super admin password reset to: Admin123456');

  // 2. Check if ravi already exists
  const existing = await users.findOne({ email: 'ravi@hrms.com' });
  if (existing) {
    console.log('Ravi already exists, skipping');
  } else {
    const admin = await users.findOne({ role: 'super_admin' });

    const raviUser = await db.collection('users').insertOne({
      name: 'Ravi',
      email: 'ravi@hrms.com',
      password: await bcrypt.hash('Test@123456', 12),
      role: 'employee',
      department: 'Engineering',
      designation: 'Junior Software Engineer',
      phone: '9876543212',
      shift: 'Morning (9AM-6PM)',
      skills: ['JavaScript', 'React', 'CSS', 'HTML'],
      joinDate: new Date('2025-01-15'),
      status: 'active',
      leaveBalance: 24,
      isFirstLogin: false,
      firstLoginAt: new Date('2026-04-01'),
      avatar: 'RA',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const raviUserId = raviUser.insertedId;
    console.log('✓ Ravi user created:', raviUserId);

    const identity = await identities.insertOne({
      identityCode: 'ID-CHC-2026-0008',
      authUserId: raviUserId,
      legalFirstName: 'Ravi',
      legalName: 'Ravi Kumar',
      preferredName: 'Ravi',
      displayName: 'Ravi',
      primaryEmail: 'ravi@hrms.com',
      personalPhone: '9876543212',
      gender: 'male',
      maritalStatus: 'single',
      nationality: 'Indian',
      bloodGroup: 'A+',
      addressHistory: [{
        addressType: 'current', line1: '789 Test Street',
        city: 'Bangalore', state: 'Karnataka', country: 'India',
        postalCode: '560003', isCurrent: true,
      }],
      emergencyContacts: [{
        name: 'Ravi Father', relation: 'Father', phone: '9988776633', isPrimary: true,
      }],
      recordStatus: 'active', sourceSystem: 'manual',
      createdAt: new Date(), updatedAt: new Date(),
    });
    const identityId = identity.insertedId;

    const profile = await profiles.insertOne({
      identityId,
      employeeNumber: 'CHC-2026-0008',
      employmentType: 'full_time',
      employmentStatus: 'active',
      department: 'Engineering',
      designation: 'Junior Software Engineer',
      businessUnit: 'Engineering',
      workLocation: 'Bangalore',
      shift: 'Morning (9AM-6PM)',
      hireDate: new Date('2025-01-15'),
      confirmationDate: new Date('2025-07-15'),
      reportingLine: { reportsToUserId: admin._id },
      sourceSystem: 'manual',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const profileId = profile.insertedId;

    await users.updateOne(
      { _id: raviUserId },
      { $set: { identityId, profileId } }
    );

    await lifecycle.insertOne({
      entityType: 'identity', entityId: identityId,
      identityId, profileId,
      eventType: 'create', action: 'Employee onboarded',
      fromState: 'none', toState: 'active',
      actorUserId: admin._id, actorRole: 'super_admin',
      isSystemGenerated: false,
      createdAt: new Date(), updatedAt: new Date(),
    });

    await employees.insertOne({
      userId: raviUserId, name: 'Ravi', email: 'ravi@hrms.com',
      phone: '9876543212', department: 'Engineering',
      designation: 'Junior Software Engineer', role: 'employee',
      shift: 'Morning (9AM-6PM)', joinDate: new Date('2025-01-15'),
      status: 'active', leaveBalance: 24,
      avatar: 'RA', skills: ['JavaScript', 'React', 'CSS', 'HTML'],
      createdAt: new Date(), updatedAt: new Date(),
    });

    await salaryStructs.insertOne({
      userId: raviUserId, grossLPA: 240000,
      createdAt: new Date(), updatedAt: new Date(),
    });

    console.log('✓ Ravi (CHC-2026-0008) fully created');
  }

  await mongoose.disconnect();
  console.log('\nDone. Login credentials:');
  console.log('  superadmin@hrms.com / Admin123456');
  console.log('  ravi@hrms.com / Test@123456');
  console.log('  karun@hrms.com / Test@123456');
  console.log('  jagadeesh@hrms.com / Test@123456');
}

main().catch(console.error);
