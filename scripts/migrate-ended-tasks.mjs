import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const attendance = db.collection('attendances');

  const records = await attendance.find({ clockOut: { $ne: null }, workProgress: { $exists: true, $ne: [] } }).toArray();

  let relabeled = 0;
  let converted = 0;
  let updated = 0;

  for (const rec of records) {
    const rows = (rec.workProgress || []).map(row => {
      if (row.type !== 'task' || !row.carriedForward) return row;
      if (row.endTime === rec.clockOut) {
        relabeled++;
        return { ...row, status: 'pending' };
      }
      converted++;
      return {
        ...row,
        status: 'completed',
        carriedForward: false,
        completedAt: row.completedAt || row.endTime || rec.clockOut,
        completedDate: row.completedDate || rec.date,
        tries: row.tries ?? 1,
      };
    });

    if (rows.some((row, i) => row !== rec.workProgress[i])) {
      await attendance.updateOne({ _id: rec._id }, { $set: { workProgress: rows } });
      updated++;
    }
  }

  console.log(`Scanned ${records.length} closed attendance records`);
  console.log(`Carried rows relabeled to pending: ${relabeled}`);
  console.log(`Ended rows converted to completed:  ${converted}`);
  console.log(`Records updated:                     ${updated}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
