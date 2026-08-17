import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import { Department, Employee } from '@/lib/models/index';
import { buildChangeSet } from '@/lib/core/privacy';
import { recordLifecycleHistory } from '@/lib/core/history';
import { notify } from '@/lib/notify';

const FINAL_STATUS_BY_TYPE = {
  resignation: 'resigned',
  termination: 'terminated',
  retirement: 'retired',
  contract_end: 'resigned',
  medical_exit: 'terminated',
  death: 'terminated',
  other: 'terminated',
};

const HEADCOUNT_STATUSES = new Set(['onboarding', 'probation', 'active', 'suspended', 'notice_period', 'rehired']);

function workflowError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function dayValue(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function finalStatusForSeparation(separationType) {
  return FINAL_STATUS_BY_TYPE[separationType] || 'terminated';
}

export function authStatusForEmployment(employmentStatus) {
  if (['resigned', 'terminated', 'retired', 'alumni'].includes(employmentStatus)) return 'alumni';
  if (employmentStatus === 'suspended') return 'inactive';
  return 'active';
}

async function reportingUserIds(profile) {
  const identityIds = [
    profile.reportingLine?.teamLeadIdentityId,
    profile.reportingLine?.teamAdminIdentityId,
  ].filter(Boolean);
  const identities = identityIds.length
    ? await UsrIdentity.find({ _id: { $in: identityIds } }).select('_id authUserId').lean()
    : [];
  const byIdentity = new Map(identities.map(item => [item._id.toString(), item.authUserId]));
  return {
    teamLeadId: profile.reportingLine?.teamLeadIdentityId
      ? byIdentity.get(profile.reportingLine.teamLeadIdentityId.toString()) || null
      : null,
    teamAdminId: profile.reportingLine?.teamAdminIdentityId
      ? byIdentity.get(profile.reportingLine.teamAdminIdentityId.toString()) || null
      : null,
  };
}

async function syncLinkedRecords(profile, identity) {
  const userStatus = authStatusForEmployment(profile.employmentStatus);
  const authUserId = identity.authUserId || null;
  const reporting = await reportingUserIds(profile);

  identity.recordStatus = profile.employmentStatus === 'alumni'
    ? 'archived'
    : userStatus === 'active' ? 'active' : 'inactive';
  await identity.save();

  if (authUserId) {
    await User.findByIdAndUpdate(authUserId, {
      identityId: identity._id,
      profileId: profile._id,
      name: identity.displayName || identity.legalName,
      email: identity.primaryEmail,
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      status: userStatus,
      role: profile.rbacRole,
      teamLeadId: reporting.teamLeadId,
      teamAdminId: reporting.teamAdminId,
    });
    await Employee.findOneAndUpdate({ userId: authUserId }, {
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      teamLeadId: reporting.teamLeadId,
      teamAdminId: reporting.teamAdminId,
      status: userStatus,
    }, { upsert: false });
  }
}

async function updateHeadcountOnce(profile, fromStatus, toStatus) {
  if (HEADCOUNT_STATUSES.has(fromStatus) && !HEADCOUNT_STATUSES.has(toStatus)) {
    await Department.findOneAndUpdate(
      { name: profile.department, members: { $gt: 0 } },
      { $inc: { members: -1 } }
    );
  }
}

async function recordExitChange({ profile, identity, actor, before, action, reason, metadata }) {
  await recordLifecycleHistory({
    entityType: 'separation',
    entityId: profile._id,
    identityId: identity._id,
    profileId: profile._id,
    eventType: 'separation',
    action,
    fromState: before.employmentStatus,
    toState: profile.employmentStatus,
    changes: buildChangeSet(before, profile.toObject(), ['employmentStatus', 'separation', 'isLocked']),
    reason,
    actorUserId: actor._id,
    actorRole: actor.role,
    ip: metadata.ip || '',
    userAgent: metadata.userAgent || '',
    requestId: metadata.requestId || '',
    metadata,
  });
}

async function sendExitNotification(profile, identity) {
  if (!identity.authUserId) return;
  const lastWorkingDate = profile.separation?.lastWorkingDate
    ? new Date(profile.separation.lastWorkingDate).toLocaleDateString('en-IN')
    : '';
  if (profile.employmentStatus === 'notice_period') {
    await notify(
      identity.authUserId,
      'Exit request approved — notice period started',
      `Your last working date is ${lastWorkingDate}. Your account remains active until HR finalizes your exit.`,
      'lifecycle',
      profile._id
    );
    return;
  }
  const title = profile.employmentStatus === 'resigned' ? 'Resignation finalized' : 'Employment exit finalized';
  await notify(identity.authUserId, title, 'Your employment exit has been finalized. Please contact HR for clearance support.', 'lifecycle', profile._id);
}

export async function startSeparation({
  profile,
  identity,
  actor,
  separationType,
  reason,
  noticePeriodDays = 0,
  lastWorkingDate,
  effectiveDate = new Date(),
  source = 'core-hr',
  metadata = {},
}) {
  const alreadyExiting = ['notice_period', 'resigned', 'terminated', 'retired', 'alumni'].includes(profile.employmentStatus);
  if (alreadyExiting) throw workflowError('This employee already has an active or completed exit. Use rehire when applicable.', 409);
  if (!lastWorkingDate) throw workflowError('Last working date is required');
  if (dayValue(lastWorkingDate) < dayValue(effectiveDate)) throw workflowError('Last working date cannot be before the effective date');

  const before = profile.toObject();
  const finalStatus = finalStatusForSeparation(separationType);
  const hasFutureWorkingDays = dayValue(lastWorkingDate) > dayValue(new Date());

  profile.employmentStatus = hasFutureWorkingDays ? 'notice_period' : finalStatus;
  profile.isLocked = false;
  profile.separation = {
    separationType,
    reason,
    noticePeriodDays,
    lastWorkingDate,
    settlementStatus: 'pending',
    exitInterviewComplete: false,
    approvedByUserId: actor._id,
    approvedAt: new Date(),
    clearedAt: null,
    clearanceChecklist: {},
  };
  await profile.save();
  await updateHeadcountOnce(profile, before.employmentStatus, profile.employmentStatus);
  await syncLinkedRecords(profile, identity);
  await recordExitChange({
    profile,
    identity,
    actor,
    before,
    action: hasFutureWorkingDays ? 'Start notice period' : 'Finalize immediate exit',
    reason,
    metadata: { ...metadata, source, separationType, effectiveDate },
  });
  await sendExitNotification(profile, identity);
  return { profile, identity, immediate: !hasFutureWorkingDays };
}

export async function finalizeSeparation({ profile, identity, actor, effectiveDate = new Date(), reason = '', metadata = {} }) {
  if (profile.employmentStatus !== 'notice_period') throw workflowError('Only an employee in notice period can be finalized');
  if (!profile.separation?.lastWorkingDate) throw workflowError('Last working date is missing');
  const today = new Date();
  if (dayValue(today) < dayValue(profile.separation.lastWorkingDate)) {
    throw workflowError('Exit cannot be finalized before the last working date');
  }
  if (dayValue(effectiveDate) < dayValue(profile.separation.lastWorkingDate) || dayValue(effectiveDate) > dayValue(today)) {
    throw workflowError('Effective date must be between the last working date and today');
  }

  const before = profile.toObject();
  profile.employmentStatus = finalStatusForSeparation(profile.separation.separationType);
  await profile.save();
  await updateHeadcountOnce(profile, before.employmentStatus, profile.employmentStatus);
  await syncLinkedRecords(profile, identity);
  await recordExitChange({
    profile,
    identity,
    actor,
    before,
    action: 'Finalize exit',
    reason: reason || profile.separation.reason,
    metadata: { ...metadata, source: 'core-hr-finalize', effectiveDate },
  });
  await sendExitNotification(profile, identity);
  return { profile, identity };
}
