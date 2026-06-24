import mongoose from 'mongoose';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Find Ravi
  const raviUser = await db.collection('users').findOne({ email: 'ravi@hrms.com' });
  const raviProfile = await db.collection('emp_profiles').findOne({ employeeNumber: 'CHC-2026-0008' });

  console.log('Ravi user:', raviUser ? raviUser.name : 'NOT FOUND');
  console.log('Ravi employeeNumber:', raviProfile?.employeeNumber);
  console.log('Ravi userId:', raviUser?._id?.toString());

  // Count module data for each employee
  for (const email of ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com']) {
    const user = await db.collection('users').findOne({ email });
    if (!user) { console.log(`\n${email}: NO USER`); continue; }
    const uid = user._id;

    const counts = {
      attendances: await db.collection('attendances').countDocuments({ userId: uid }),
      leaves: await db.collection('leaves').countDocuments({ userId: uid }),
      payrolls: await db.collection('payrolls').countDocuments({ userId: uid }),
      goals: await db.collection('goals').countDocuments({ userId: uid }),
      reviews: await db.collection('reviews').countDocuments({ userId: uid }),
      tasks: await db.collection('tasks').countDocuments({ assignedTo: uid }),
      assets: await db.collection('assets').countDocuments({ assignedTo: uid }),
      documents: await db.collection('documents').countDocuments({ employeeId: uid }),
      notifications: await db.collection('notifications').countDocuments({ userId: uid }),
      regularizations: await db.collection('attendanceregularizations').countDocuments({ userId: uid }),
    };
    console.log(`\n${email} (${user.name})`);
    console.log('  Modules:', JSON.stringify(counts));
  }

  await mongoose.disconnect();
}

main().catch(console.error);
