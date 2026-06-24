import mongoose from 'mongoose';

const uri = 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

const TEST_EMAILS = ['karun@hrms.com', 'jagadeesh@hrms.com', 'ravi@hrms.com'];

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Find test user IDs
  const users = await db.collection('users').find({ email: { $in: TEST_EMAILS } }).project({ _id: 1 }).toArray();
  const testUserIds = users.map(u => u._id);

  if (testUserIds.length === 0) {
    console.log('No test users found. Nothing to clean.');
  } else {
    console.log(`Found ${testUserIds.length} test users, cleaning related data...`);

    const collections = [
      'users', 'usridentities', 'empprofiles', 'employees',
      'salarystructures', 'attendances', 'leaves', 'payrolls',
      'goals', 'reviews', 'assets', 'documents',
      'auditlogs', 'selfservicerequests', 'notifications',
      'attendanceregularizations', 'absences',
      'emplifecyclehistories',
    ];

    for (const colName of collections) {
      const col = db.collection(colName);
      const field = colName === 'users' ? '_id' :
                    colName === 'auditlogs' ? 'targetUserId' :
                    colName === 'documents' ? 'employeeId' :
                    colName === 'announcements' ? 'likes' : 'userId';

      if (colName === 'announcements') {
        // Handle likes array - pull test user IDs from likes
        for (const uid of testUserIds) {
          await col.updateMany({}, { $pull: { likes: uid } });
        }
      } else if (field === '_id') {
        await col.deleteMany({ _id: { $in: testUserIds } });
      } else {
        await col.deleteMany({ [field]: { $in: testUserIds } });
      }
    }

    // Also clean projects/tasks - they reference test users in team/assignedTo
    await db.collection('projects').deleteMany({});
    await db.collection('tasks').deleteMany({});
    await db.collection('projects').deleteMany({});

    console.log('✓ Cleaned all test data');
  }

  await mongoose.disconnect();
  console.log('\nNow call the seed endpoint:');
  console.log('Invoke-RestMethod -Uri http://localhost:3000/api/seed/test-data -Method Post -ContentType "application/json" -Body \'{"setupToken":"setup_initial_bootstrap_token_change_immediately_after_first_use_12345678"}\'');
}

main().catch(console.error);
