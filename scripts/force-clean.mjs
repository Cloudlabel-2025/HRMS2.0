import mongoose from 'mongoose';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Drop problematic identities
  await db.collection('usridentities').deleteMany({ identityCode: /^ID-(EMP|CHC)/ });
  console.log('Dropped test identities');

  // Remove test users
  const result = await db.collection('users').deleteMany({ email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] } });
  console.log('Deleted users:', result.deletedCount);

  // Also clean any leftover data
  const remaining = await db.collection('users').find({ email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] } }).toArray();
  console.log('Remaining test users:', remaining.length);

  await mongoose.disconnect();
  console.log('Ready to reseed');
}

main().catch(console.error);
