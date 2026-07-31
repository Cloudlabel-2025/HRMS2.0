import dbConnect from '@/lib/db';
import User from '@/lib/models/User';
import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import { Department, Employee } from '@/lib/models/index';
import { requireAuth, auditLog } from '@/lib/middleware';
import { ok, fail } from '@/lib/jwt';
import { CORE_HR_MANAGER_ROLES, CORE_HR_PRIVILEGED_ROLES } from '@/lib/core/constants';
import { canAccessDepartment } from '@/lib/rbac';
import { buildChangeSet } from '@/lib/core/privacy';
import { recordLifecycleHistory } from '@/lib/core/history';
import { LifecycleActionSchema, validateRequest } from '@/lib/validation';

import { notify } from '@/lib/notify';

function getIdentityUserId(identity) {
  return identity?.authUserId || null;
}

function mapStatusToUserStatus(status, separationType = '') {
  if (status === 'retired' || separationType === 'retirement') return 'alumni';
  if (status === 'resigned' || status === 'terminated' || status === 'suspended' || status === 'alumni') return 'inactive';
  return 'active';
}

function buildLegacyEmployeeSync(profile, identity, userStatus, reportingUserIds) {
  return {
    department: profile.department,
    designation: profile.designation,
    shift: profile.shift,
    teamLeadId: reportingUserIds.teamLeadId,
    teamAdminId: reportingUserIds.teamAdminId,
    status: userStatus,
    leaveBalance: undefined,
  };
}

async function loadProfile(profileId) {
  return EmpProfile.findById(profileId).populate('identityId');
}

async function canOperateOnProfile(profile, user) {
  if (['super_admin', 'admin_full'].includes(user.role)) return true;
  const userIdentityId = (user.identityId || user._id).toString();
  const teamLeadId = profile?.reportingLine?.teamLeadIdentityId?.toString?.() || '';
  const teamAdminId = profile?.reportingLine?.teamAdminIdentityId?.toString?.() || '';
  const sameDepartment = !!user.department && await canAccessDepartment(user, profile.department);
  if (user.role === 'team_lead') return sameDepartment || teamLeadId === userIdentityId || teamAdminId === userIdentityId;
  if (user.role === 'team_admin') return sameDepartment || teamAdminId === userIdentityId || teamLeadId === userIdentityId;
  return false;
}

async function syncAll(profile, identity, actor, changes, eventType, action, fromState, toState, reason, metadata = {}) {
  const userStatus = mapStatusToUserStatus(profile.employmentStatus, profile.separation?.separationType || '');
  const authUserId = getIdentityUserId(identity);
  const reportingIdentityIds = [
    profile.reportingLine?.teamLeadIdentityId,
    profile.reportingLine?.teamAdminIdentityId,
  ].filter(Boolean);
  const reportingIdentities = reportingIdentityIds.length
    ? await UsrIdentity.find({ _id: { $in: reportingIdentityIds } }).select('_id authUserId').lean()
    : [];
  const reportingUserByIdentity = new Map(reportingIdentities.map(item => [item._id.toString(), item.authUserId]));
  const reportingUserIds = {
    teamLeadId: profile.reportingLine?.teamLeadIdentityId ? reportingUserByIdentity.get(profile.reportingLine.teamLeadIdentityId.toString()) || null : null,
    teamAdminId: profile.reportingLine?.teamAdminIdentityId ? reportingUserByIdentity.get(profile.reportingLine.teamAdminIdentityId.toString()) || null : null,
  };

  if (authUserId) {
    await User.findByIdAndUpdate(authUserId, {
      identityId: identity._id,
      profileId: profile._id,
      name: identity.displayName,
      email: identity.primaryEmail,
      department: profile.department,
      designation: profile.designation,
      shift: profile.shift,
      status: userStatus,
      role: profile.rbacRole,
      teamLeadId: reportingUserIds.teamLeadId,
      teamAdminId: reportingUserIds.teamAdminId,
    });
  }

  await Employee.findOneAndUpdate(
    { userId: authUserId },
    buildLegacyEmployeeSync(profile, identity, userStatus, reportingUserIds),
    { upsert: false }
  );

  await recordLifecycleHistory({
    entityType: eventType === 'separation' ? 'separation' : 'employment',
    entityId: profile._id,
    identityId: identity._id,
    profileId: profile._id,
    eventType,
    action,
    fromState,
    toState,
    changes,
    reason,
    actorUserId: actor._id,
    actorRole: actor.role,
    ip: metadata.ip || '',
    userAgent: metadata.userAgent || '',
    requestId: metadata.requestId || '',
    isSystemGenerated: false,
    metadata,
  });
}

export async function POST(req) {
  try {
    const { user, error } = await requireAuth(req);
    if (error) return error;
    if (!CORE_HR_MANAGER_ROLES.includes(user.role) && !['super_admin', 'admin_full'].includes(user.role)) return fail('Access denied', 403);
    if (!['super_admin', 'admin_full', 'team_admin', 'team_lead'].includes(user.role)) return fail('Access denied', 403);

    await dbConnect();
    const body = await req.json();
    const validation = validateRequest(LifecycleActionSchema, body);
    if (!validation.valid) return fail(`Validation failed: ${validation.error}`, 400);

    const { action, data } = validation.data;
    const profile = await loadProfile(data.profileId);
    if (!profile) return fail('Employment profile not found', 404);
    const identity = profile.identityId;
    if (!identity) return fail('Linked identity not found for this profile', 409);

    // Record locking — block mutations on finalized separated profiles
    if (profile.isLocked && action !== 'rehire') return fail('This profile is locked after exit clearance. Only rehire is allowed.', 403);

    if (!await canOperateOnProfile(profile, user) && !['super_admin', 'admin_full'].includes(user.role)) {
      return fail('Access denied', 403);
    }

    const before = profile.toObject();
    const requestId = req.headers.get('x-request-id') || '';
    const ip = req.headers.get('x-forwarded-for') || '';
    const userAgent = req.headers.get('user-agent') || '';
    const effectiveDate = data.effectiveDate || new Date();

    let eventType = 'status_change';
    let actionLabel = action;
    let reason = data.reason || data.confirmationNote || '';
    const metadata = { action, effectiveDate, requestId, ip, userAgent };

    const separatedStatuses = ['resigned', 'terminated', 'retired', 'alumni'];
    if (action === 'separation' && separatedStatuses.includes(profile.employmentStatus)) {
      return fail('This employee is already separated. Use rehire to create a new employment period.', 409);
    }
    if (['transfer', 'promotion', 'suspend'].includes(action) && separatedStatuses.includes(profile.employmentStatus)) {
      return fail('Separated employees cannot be changed. Rehire the employee first.', 409);
    }
    if (action === 'suspend' && profile.employmentStatus === 'suspended') {
      return fail('This employee is already suspended', 409);
    }

    if (action === 'confirm_probation') {
      if (!['onboarding', 'probation'].includes(profile.employmentStatus))
        return fail('Only onboarding or probation profiles can be confirmed', 400);

      if (profile.employmentStatus === 'onboarding') {
        // onboarding → probation: set probation start and end dates
        if (!data.probationEndDate)
          return fail('Probation end date is required when starting probation', 400);
        const endDate = new Date(data.probationEndDate);
        if (endDate <= new Date(effectiveDate))
          return fail('Probation end date must be after the effective date', 400);
        profile.employmentStatus = 'probation';
        profile.probationStartDate = effectiveDate;
        profile.probationEndDate = endDate;
        actionLabel = 'Move to probation';
      } else {
        // probation → active: only allowed on or after probationEndDate
        const endDate = profile.probationEndDate ? new Date(profile.probationEndDate) : null;
        if (endDate && new Date() < endDate)
          return fail('Probation period has not ended yet', 400);
        profile.employmentStatus = 'active';
        profile.confirmationDate = effectiveDate;
        profile.probationEndDate = profile.probationEndDate || effectiveDate;
        actionLabel = 'Confirm probation';
      }
      reason = data.confirmationNote || reason || 'Status updated';
    }

    if (action === 'start_probation') {
      if (!['onboarding', 'active', 'rehired'].includes(profile.employmentStatus)) {
        return fail('Only onboarding, active, or rehired employees can start a probation period', 400);
      }
      const endDate = new Date(data.probationEndDate);
      if (endDate <= new Date(effectiveDate)) return fail('Probation end date must be after the effective date', 400);
      profile.employmentStatus = 'probation';
      profile.probationStartDate = effectiveDate;
      profile.probationEndDate = endDate;
      profile.confirmationDate = null;
      actionLabel = 'Start probation period';
      reason = data.confirmationNote;
    }

    if (action === 'transfer') {
      profile.department = data.department;
      profile.designation = data.designation;
      profile.businessUnit = data.businessUnit || '';
      profile.workLocation = data.workLocation || '';
      profile.shift = data.shift || profile.shift;
      if (data.managerIdentityId) profile.reportingLine.managerIdentityId = data.managerIdentityId;
      if (data.teamLeadIdentityId) profile.reportingLine.teamLeadIdentityId = data.teamLeadIdentityId;
      if (data.teamAdminIdentityId) profile.reportingLine.teamAdminIdentityId = data.teamAdminIdentityId;
      actionLabel = 'Transfer employee';
      reason = data.reason;
    }

    if (action === 'promotion') {
      if (!data.role) return fail('Promoted role is required', 400);
      if (!['super_admin', 'admin_full'].includes(user.role) && CORE_HR_PRIVILEGED_ROLES.includes(data.role)) return fail('Only full admins can grant this role', 403);
      profile.rbacRole = data.role;
      profile.designation = data.designation;
      profile.businessUnit = data.businessUnit || profile.businessUnit;
      profile.compensationSnapshot = {
        ...(profile.compensationSnapshot || {}),
        grade: data.grade || profile.compensationSnapshot?.grade || '',
        payGroup: data.payGroup || profile.compensationSnapshot?.payGroup || '',
        band: data.band || profile.compensationSnapshot?.band || '',
      };
      actionLabel = 'Promote employee';
      reason = data.reason;
    }

    if (action === 'rehire') {
      if (!['resigned', 'terminated', 'retired', 'alumni'].includes(profile.employmentStatus)) {
        return fail('Only separated profiles can be rehired', 400);
      }
      profile.rehireCount = (profile.rehireCount || 0) + 1;
      profile.hireDate = effectiveDate;
      profile.employmentType = data.employmentType;
      profile.employmentStatus = 'rehired';
      profile.department = data.department;
      profile.designation = data.designation;
      profile.businessUnit = data.businessUnit || '';
      profile.workLocation = data.workLocation || '';
      profile.shift = data.shift || profile.shift;
      profile.separation = { separationType: 'other', reason: '', noticePeriodDays: 0, lastWorkingDate: null, settlementStatus: 'pending', exitInterviewComplete: false, approvedByUserId: null, approvedAt: null, clearedAt: null };
      actionLabel = 'Rehire employee';
      reason = data.reason;
    }

    if (action === 'suspend') {
      profile.employmentStatus = 'suspended';
      actionLabel = 'Suspend employee';
      reason = data.reason;
    }

    if (action === 'separation') {
      const statusMap = {
        resignation: 'resigned',
        termination: 'terminated',
        retirement: 'retired',
        contract_end: 'resigned',
        medical_exit: 'terminated',
        death: 'terminated',
        other: 'terminated',
      };
      profile.employmentStatus = statusMap[data.separationType] || 'terminated';
      profile.separation = {
        separationType: data.separationType,
        reason: data.reason,
        noticePeriodDays: data.noticePeriodDays,
        lastWorkingDate: data.lastWorkingDate,
        settlementStatus: data.settlementStatus,
        exitInterviewComplete: data.exitInterviewComplete,
        approvedByUserId: data.approvedByUserId || user._id,
        approvedAt: effectiveDate,
        clearedAt: data.settlementStatus === 'settled' ? effectiveDate : null,
      };
      actionLabel = 'Separate employee';
      reason = data.reason;
      eventType = 'separation';
    }

    await profile.save();

    // Sync department member counts on transfer or separation
    if (action === 'transfer' && before.department !== profile.department) {
      await Promise.all([
        Department.findOneAndUpdate({ name: before.department, members: { $gt: 0 } }, { $inc: { members: -1 } }),
        Department.findOneAndUpdate({ name: profile.department }, { $inc: { members: 1 } }),
      ]);
    }
    if (action === 'separation') {
      await Department.findOneAndUpdate({ name: profile.department, members: { $gt: 0 } }, { $inc: { members: -1 } });
    }
    if (action === 'rehire') {
      await Department.findOneAndUpdate({ name: profile.department }, { $inc: { members: 1 } });
    }

    const userStatus = mapStatusToUserStatus(profile.employmentStatus, profile.separation?.separationType || '');
    identity.recordStatus = userStatus === 'alumni' ? 'archived' : userStatus === 'active' ? 'active' : 'inactive';
    await identity.save();

    const changes = buildChangeSet(before, profile.toObject(), [
      'employmentStatus',
      'department',
      'designation',
      'businessUnit',
      'workLocation',
      'shift',
      'rbacRole',
      'hireDate',
      'probationStartDate',
      'probationEndDate',
      'confirmationDate',
      'rehireCount',
      'employmentType',
      'reportingLine',
      'compensationSnapshot',
      'separation',
    ]);

    await syncAll(profile, identity, user, changes, eventType, actionLabel, before.employmentStatus, profile.employmentStatus, reason, metadata);

    // Notify the employee about their status change
    const authUserId = getIdentityUserId(identity);
    if (authUserId) {
      const statusMessages = {
        probation:  { title: 'You have moved to Probation',  message: `Your employment status has been updated from Onboarding to Probation${reason ? ': ' + reason : '.'}` },
        active:     { title: 'Employment Confirmed — Active', message: `Congratulations! Your probation has been confirmed. You are now an Active employee${reason ? ': ' + reason : '.'}` },
        suspended:  { title: 'Account Suspended',            message: `Your employment has been suspended${reason ? ': ' + reason : '. Please contact HR.'}` },
        resigned:   { title: 'Resignation Processed',        message: `Your resignation has been recorded${reason ? ': ' + reason : '.'}` },
        terminated: { title: 'Employment Terminated',        message: `Your employment has been terminated${reason ? ': ' + reason : '. Please contact HR.'}` },
        rehired:    { title: 'Welcome Back!',                message: `Your employment has been reinstated${reason ? ': ' + reason : '.'}` },
      };
      const msg = statusMessages[profile.employmentStatus];
      if (msg) await notify(authUserId, msg.title, msg.message, 'lifecycle', profile._id);

      if (String(authUserId) !== String(user._id)) {
        await notify(
          user._id,
          `Lifecycle updated — ${identity.legalName}`,
          `${identity.legalName} has been moved to ${profile.employmentStatus.replace(/_/g, ' ')}${reason ? ': ' + reason : '.'}`,
          'lifecycle',
          profile._id
        );
      }
    }

    await auditLog('Core Lifecycle Transition', 'EmploymentProfile', user._id, `${actionLabel} for ${profile.employeeNumber} (${identity.legalName})`, action === 'separation' ? 'high' : 'medium', ip);

    return ok({
      profile,
      identity: {
        id: identity._id,
        legalName: identity.legalName,
        primaryEmail: identity.primaryEmail,
        recordStatus: identity.recordStatus,
      },
    });
  } catch (e) {
    if (e.code === 11000) return fail('Duplicate lifecycle update detected', 409);
    return fail(e.message, 500);
  }
}
