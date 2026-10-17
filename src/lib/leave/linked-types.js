export const CLASSIFICATION_WORKFLOW = [{
  step: 1, label: 'Super Admin classification', approverRoles: ['super_admin'],
  actionType: 'approve', required: true,
}];

export function getLinkedTypes(source, configs = []) {
  return configs.filter(config => config.code !== source.code && config.enabled !== false && config.balanceMode !== 'linked'
    && (source.linkAllLeaveTypes || (source.linkedLeaveTypes || []).includes(config.code)));
}

export function linkedTypeError(configs) {
  for (const config of configs) {
    if (config.balanceMode !== undefined && !['own', 'linked'].includes(config.balanceMode)) return 'Invalid leave balance source';
    if (config.balanceMode !== 'linked') continue;
    if (config.linkAllLeaveTypes !== undefined && typeof config.linkAllLeaveTypes !== 'boolean') return 'Select all leave types must be true or false';
    if (config.linkedLeaveTypes !== undefined && (!Array.isArray(config.linkedLeaveTypes) || config.linkedLeaveTypes.some(code => typeof code !== 'string'))) return 'Linked leave types must be a list of codes';
    if (!getLinkedTypes(config, configs).length) return `Choose at least one available underlying leave type for ${config.name}`;
    if (!config.linkAllLeaveTypes && (config.linkedLeaveTypes || []).some(code => !getLinkedTypes(config, configs).some(target => target.code === code))) {
      return `${config.name} links to a disabled, removed, or linked leave type. Update its linked types first.`;
    }
  }
  return null;
}

export function classificationError(target, leave, context, evaluateEligibility) {
  // Advance notice was checked against the requested linked type at submission.
  // Selecting a balance source at approval must not add its notice requirement.
  if (!target || target.enabled === false || target.balanceMode === 'linked') return 'Choose an available underlying leave type';
  if (!(leave.classificationOptions || []).some(option => option.code === target.code)) return 'This leave type is not linked to this request';
  const gender = (context.gender || '').toLowerCase();
  if (['male', 'paternity'].includes(target.genderRestriction) && gender !== 'male') return 'The employee is not eligible for this leave type';
  if (['female', 'maternity'].includes(target.genderRestriction) && gender !== 'female') return 'The employee is not eligible for this leave type';
  if (!evaluateEligibility(target.eligibilityRules, context).eligible) return 'The employee is not eligible for this leave type';
  if (leave.halfDay && (!target.allowHalfDay || (leave.halfDayType === 'first_half' && target.allowFirstHalf === false) || (leave.halfDayType === 'second_half' && target.allowSecondHalf === false))) return 'The selected leave type does not allow this half-day option';
  if (target.maxConsecutiveDays > 0 && leave.days > target.maxConsecutiveDays) return `The selected type allows at most ${target.maxConsecutiveDays} consecutive days`;
  if ((target.requiresDocuments || (target.requireDocsIfConsecutiveDays > 0 && leave.days >= target.requireDocsIfConsecutiveDays)) && !leave.documents?.length) return 'Supporting documents are required for the selected leave type';
  return null;
}
