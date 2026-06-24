import mongoose from 'mongoose';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const r = await db.collection('users').deleteMany({ email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] } });
  console.log('Deleted users:', r.deletedCount);

  // Also drop the identity collection to avoid index issues
  try { await db.collection('usridentities').drop(); console.log('Dropped usridentities'); } catch(e) { console.log('usridentities drop skipped:', e.message); }

  const remaining = await db.collection('users').countDocuments({ email: { $in: ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'] } });
  console.log('Remaining:', remaining);
  await mongoose.disconnect();
}

main().catch(console.error);
