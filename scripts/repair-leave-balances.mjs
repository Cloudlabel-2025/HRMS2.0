import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI || 'mongodb+srv://rishivarshini7713_db_user:5fYuqh3MvGB2l69R@cluster0.mrllgn3.mongodb.net/?appName=Cluster0';

const EMPLOYER_ROLES = ['super_admin'];

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const now = new Date();

  // 1) Repair policies whose leaveTypeConfigs reference a typeId without an embedded code
  const leaveTypes = await db.collection('leavetypes').find({}).toArray();
  const leaveTypeById = new Map(leaveTypes.map(t => [String(t._id), t]));

  const policies = await db.collection('leavepolicies').find({}).toArray();
  let repairedPolicies = 0;
  let repairedConfigs = 0;
  for (const p of policies) {
    const configs = p.leaveTypeConfigs || [];
    let changed = false;
    for (const cfg of configs) {
      if (cfg.code) continue;
      const lt = cfg.typeId ? leaveTypeById.get(String(cfg.typeId)) : null;
      if (!lt) continue;
      cfg.code = lt.code;
      cfg.name = lt.name;
      cfg.description = lt.description ?? '';
      cfg.color = lt.color ?? '#3b82f6';
      cfg.icon = lt.icon ?? 'bi-calendar-check';
      cfg.sortOrder = lt.sortOrder ?? 0;
      changed = true;
      repairedConfigs++;
    }
    if (changed) {
      await db.collection('leavepolicies').updateOne({ _id: p._id }, { $set: { leaveTypeConfigs: configs } });
      repairedPolicies++;
      console.log(`Repaired policy "${p.name}" (${repairedConfigs} configs so far)`);
    }
  }

  // 2) Reconcile current-cycle balances against the policy each user resolves to
  const users = (await db.collection('users').find({}).toArray()).filter(u => !EMPLOYER_ROLES.includes(u.role));
  const profiles = await db.collection('emp_profiles').find({}).toArray();
  const profileById = new Map(profiles.map(p => [String(p._id), p]));
  const activePolicies = await db.collection('leavepolicies').find({ status: 'active' }).sort({ createdAt: -1 }).toArray();

  const cycleStart = new Date(now.getFullYear(), 0, 1);
  const nextCycle = new Date(now.getFullYear() + 1, 0, 1);

  const resolvePolicy = (u) => {
    const profile = u.profileId ? profileById.get(String(u.profileId)) : null;
    const employmentType = profile?.employmentType || '';
    const userDepartment = u.department || '';

    const matches = (p) => {
      const roleOk = (!p.applicableRoles || p.applicableRoles.length === 0) || (p.applicableRoles || []).includes(u.role);
      const deptOk = (!p.applicableDepartments || p.applicableDepartments.length === 0) || (p.applicableDepartments || []).includes(userDepartment);
      const empOk = (!p.applicableEmploymentTypes || p.applicableEmploymentTypes.length === 0) || (p.applicableEmploymentTypes || []).includes(employmentType);
      const fromOk = p.effectiveFrom && p.effectiveFrom <= now;
      const toOk = !p.effectiveTo || p.effectiveTo >= now;
      return roleOk && deptOk && empOk && fromOk && toOk;
    };

    for (const p of activePolicies) {
      if (matches(p)) return p;
    }
    for (const p of activePolicies) {
      if (!p.isDefault) continue;
      const deptOk = (!p.applicableDepartments || p.applicableDepartments.length === 0) || (p.applicableDepartments || []).includes(userDepartment);
      const empOk = (!p.applicableEmploymentTypes || p.applicableEmploymentTypes.length === 0) || (p.applicableEmploymentTypes || []).includes(employmentType);
      const fromOk = p.effectiveFrom && p.effectiveFrom <= now;
      const toOk = !p.effectiveTo || p.effectiveTo >= now;
      if (deptOk && empOk && fromOk && toOk) return p;
    }
    return null;
  };

  const balances = await db.collection('userleavebalances').find({
    cycleStart: { $gte: cycleStart, $lt: nextCycle },
  }).toArray();

  let updatedBalances = 0;
  let backfilled = 0;
  for (const bal of balances) {
    const u = users.find(x => String(x._id) === String(bal.userId));
    if (!u) continue;
    const policy = resolvePolicy(u);
    if (!policy) continue;

    let changed = false;
    const entries = (bal.balances || []).map(entry => {
      const config = (policy.leaveTypeConfigs || []).find(c => c.code === entry.typeCode);
      if (!config || !config.enabled) return entry;
      if ((config.annualAllocation || 0) > 0 && (entry.allocated === 0 || entry.allocated == null)) {
        let allocated = config.annualAllocation || 0;
        if (config.creditSchedule && config.creditSchedule !== 'upfront') {
          const divisor = config.creditSchedule === 'monthly' ? 12 : config.creditSchedule === 'quarterly' ? 4 : 2;
          allocated = Number((config.annualAllocation / divisor).toFixed(2));
        }
        entry.allocated = allocated;
        backfilled++;
        changed = true;
      }
      return entry;
    });

    const set = { balances: entries };
    if (String(bal.policyId) !== String(policy._id)) {
      set.policyId = policy._id;
      changed = true;
    }
    if (changed) {
      await db.collection('userleavebalances').updateOne({ _id: bal._id }, { $set: set });
      updatedBalances++;
    }
  }

  console.log('=== SUMMARY ===');
  console.log(`Policies repaired:      ${repairedPolicies}`);
  console.log(`Configs repaired:       ${repairedConfigs}`);
  console.log(`Balance docs updated:   ${updatedBalances}`);
  console.log(`Entries backfilled:     ${backfilled}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
