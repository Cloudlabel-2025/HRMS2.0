import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Refusing to run.');
  process.exit(1);
}

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
