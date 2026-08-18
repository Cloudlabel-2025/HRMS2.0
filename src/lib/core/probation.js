import EmpProfile from '@/lib/models/EmploymentProfile';
import User from '@/lib/models/User';
import { Notification } from '@/lib/models/index';

/** Notify super administrators once when a probation date has elapsed. */
export async function notifyExpiredProbations(now = new Date()) {
  const profiles = await EmpProfile.find({
    employmentStatus: 'probation',
    probationEndDate: { $ne: null, $lte: now },
    probationEndNotifiedAt: null,
  }).select('_id employeeNumber probationEndDate').lean();
  if (!profiles.length) return 0;

  const superAdmins = await User.find({ role: 'super_admin', status: 'active' }).select('_id').lean();
  let processed = 0;
  for (const profile of profiles) {
    const claimed = await EmpProfile.updateOne(
      { _id: profile._id, probationEndNotifiedAt: null },
      { $set: { probationEndNotifiedAt: now } }
    );
    if (claimed.modifiedCount !== 1) continue;
    if (superAdmins.length) {
      await Notification.insertMany(superAdmins.map(admin => ({
        userId: admin._id,
        title: 'Probation Decision Required',
        message: `${profile.employeeNumber}'s probation ended on ${new Date(profile.probationEndDate).toISOString().slice(0, 10)}. Choose Turn Active or Return Probation.`,
        type: 'lifecycle',
        refId: profile._id,
      })));
    }
    processed++;
  }
  return processed;
}
