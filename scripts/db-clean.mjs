import mongoose from 'mongoose';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const testEmails = ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'];

  const testUsers = await db.collection('users').find({ email: { $in: testEmails } }).project({ _id: 1 }).toArray();
  const ids = testUsers.map(u => u._id);
  console.log('Test user IDs found:', ids.length);

  if (ids.length > 0) {
    await db.collection('attendances').deleteMany({ userId: { $in: ids } });
    await db.collection('leaves').deleteMany({ userId: { $in: ids } });
    await db.collection('payrolls').deleteMany({ userId: { $in: ids } });
    await db.collection('goals').deleteMany({ userId: { $in: ids } });
    await db.collection('reviews').deleteMany({ userId: { $in: ids } });
    await db.collection('assets').deleteMany({ assignedTo: { $in: ids } });
    await db.collection('documents').deleteMany({ employeeId: { $in: ids } });
    await db.collection('auditlogs').deleteMany({ targetUserId: { $in: ids } });
    await db.collection('selfservicerequests').deleteMany({});
    await db.collection('notifications').deleteMany({ userId: { $in: ids } });
    await db.collection('attendanceregularizations').deleteMany({ userId: { $in: ids } });
    await db.collection('absences').deleteMany({ userId: { $in: ids } });
    await db.collection('emplifecyclehistories').deleteMany({ actorUserId: { $in: ids } });
    await db.collection('salarystructures').deleteMany({ userId: { $in: ids } });
    await db.collection('employees').deleteMany({ userId: { $in: ids } });
    await db.collection('empprofiles').deleteMany({});
    await db.collection('usridentities').deleteMany({ authUserId: { $in: ids } });
    await db.collection('projects').deleteMany({});
    await db.collection('tasks').deleteMany({});
    await db.collection('users').deleteMany({ _id: { $in: ids } });

    for (const uid of ids) {
      await db.collection('announcements').updateMany({}, { $pull: { likes: uid } });
    }
    console.log('All test data cleaned');
  } else {
    console.log('No test users found');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
