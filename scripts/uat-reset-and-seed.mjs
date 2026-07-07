import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const uri = process.env.MONGODB_URI || 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

const collections = [
  'users',
  'usridentities',
  'empprofiles',
  'employees',
  'salarystructures',
  'attendances',
  'leaves',
  'payrolls',
  'goals',
  'reviews',
  'assets',
  'stocks',
  'invoices',
  'expenses',
  'budgets',
  'documents',
  'auditlogs',
  'selfservicerequests',
  'notifications',
  'attendanceregularizations',
  'absences',
  'emplifecyclehistories',
  'projects',
  'tasks',
  'announcements',
  'smes'
];

async function main() {
  console.log('Connecting to database...');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  console.log('\n--- CLEARING ALL COLLECTIONS FOR UAT ---');
  for (const colName of collections) {
    try {
      const col = db.collection(colName);
      const result = await col.deleteMany({});
      console.log(`✓ Cleared ${result.deletedCount} documents from: "${colName}"`);
    } catch (error) {
      console.error(`✗ Error clearing "${colName}":`, error.message);
    }
  }

  console.log('\n--- SEEDING INITIAL BOOTSTRAP DATA ---');
  
  // Use config from .env.local or fallback to defaults
  const adminName = process.env.SEED_ADMIN_NAME || 'Super Admin';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'superadmin@hrms.com';
  const adminPasswordRaw = process.env.SEED_ADMIN_PASSWORD || 'Admin123456';
  
  const hashedPassword = await bcrypt.hash(adminPasswordRaw, 12);
  
  const superAdmin = {
    name: adminName,
    email: adminEmail.toLowerCase(),
    password: hashedPassword,
    role: 'super_admin',
    status: 'active',
    isFirstLogin: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const usersCol = db.collection('users');
  const result = await usersCol.insertOne(superAdmin);
  console.log(`✓ Seeded Super Admin: "${adminEmail}" (ID: ${result.insertedId})`);

  console.log('\n======================================================');
  console.log('UAT Database Reset & Seeding Completed successfully!');
  console.log('Use these credentials to log in:');
  console.log(`  Email:    ${adminEmail}`);
  console.log(`  Password: ${adminPasswordRaw}`);
  console.log('======================================================\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error during seeding:', err);
  await mongoose.disconnect();
  process.exit(1);
});
