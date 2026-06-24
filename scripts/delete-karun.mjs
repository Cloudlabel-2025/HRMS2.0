import mongoose from 'mongoose';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Delete Karun and other test users
  const r = await db.collection('users').deleteMany({ email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] } });
  console.log('Users deleted:', r.deletedCount);

  // Also clean salary structures that are orphaned
  await db.collection('salarystructures').deleteMany({});
  console.log('Salary structures cleared');

  // Verify
  const remaining = await db.collection('users').find({ email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] } }).toArray();
  console.log('Remaining test users:', remaining.length);

  await mongoose.disconnect();
}

main().catch(console.error);
