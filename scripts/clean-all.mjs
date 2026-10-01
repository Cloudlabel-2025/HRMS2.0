import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const names = [
    'usr_identities', 'emp_profiles', 'employees', 'emplifecyclehistories',
    'salarystructures', 'projects', 'tasks', 'attendances', 'leaves',
    'payrolls', 'goals', 'reviews', 'assets', 'documents', 'auditlogs',
    'self_service_requests', 'notifications', 'attendanceregularizations', 'absences'
  ];
  for (const n of names) {
    try { await db.collection(n).drop(); console.log('Dropped', n); } catch(e) {}
  }

  const r = await db.collection('users').deleteMany({
    email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] }
  });
  console.log('Deleted users:', r.deletedCount);
  await mongoose.disconnect();
}

main().catch(console.error);
