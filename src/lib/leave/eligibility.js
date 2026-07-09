import UsrIdentity from '@/lib/models/Identity';
import EmpProfile from '@/lib/models/EmploymentProfile';
import User from '@/lib/models/User';

/**
 * Builds the employee context object for rule evaluation.
 * @param {string} userId - The user ID to query
 * @returns {Promise<Object>} The employee context
 */
export async function buildEmployeeContext(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  let identity = null;
  if (user.identityId) {
    identity = await UsrIdentity.findById(user.identityId);
  }

  let profile = null;
  if (user.profileId) {
    profile = await EmpProfile.findById(user.profileId);
  }

  // Calculate service tenure in months
  let serviceMonths = 0;
  const hireDate = profile?.hireDate || user.joinDate;
  if (hireDate) {
    const diffTime = Math.abs(Date.now() - new Date(hireDate).getTime());
    // 30.4375 is average days per month (365.25 / 12)
    serviceMonths = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 30.4375));
  }

  return {
    gender:           identity?.gender || 'prefer_not_to_say',
    maritalStatus:    identity?.maritalStatus || 'prefer_not_to_say',
    employmentType:   profile?.employmentType || 'full_time',
    department:       profile?.department || user.department || '',
    employmentStatus: profile?.employmentStatus || 'active',
    serviceMonths:    serviceMonths || 0,
    customAttributes: identity?.customAttributes ? Object.fromEntries(identity.customAttributes) : {},
  };
}

/**
 * Evaluates a set of eligibility rules against the employee context.
 * All rules in the array are treated with AND logic (all must pass).
 * @param {Array} rules - The eligibility rules from the leave type config
 * @param {Object} context - The employee context
 * @returns {Object} { eligible: boolean, failedRule: string | null }
 */
export function evaluateEligibility(rules, context) {
  if (!rules || !Array.isArray(rules) || rules.length === 0) {
    return { eligible: true, failedRule: null };
  }

  for (const rule of rules) {
    let { field, operator, value } = rule;
    let employeeValue;

    if (field.startsWith('customAttr.')) {
      const attrKey = field.substring('customAttr.'.length);
      employeeValue = context.customAttributes?.[attrKey];
    } else {
      employeeValue = context[field];
    }

    let rulePassed = false;

    switch (operator) {
      case 'equals':
        rulePassed = String(employeeValue).toLowerCase() === String(value).toLowerCase();
        break;
      case 'not_equals':
        rulePassed = String(employeeValue).toLowerCase() !== String(value).toLowerCase();
        break;
      case 'in':
        if (Array.isArray(value)) {
          rulePassed = value.map(v => String(v).toLowerCase()).includes(String(employeeValue).toLowerCase());
        } else if (typeof value === 'string') {
          rulePassed = value.split(',').map(v => v.trim().toLowerCase()).includes(String(employeeValue).toLowerCase());
        }
        break;
      case 'not_in':
        if (Array.isArray(value)) {
          rulePassed = !value.map(v => String(v).toLowerCase()).includes(String(employeeValue).toLowerCase());
        } else if (typeof value === 'string') {
          rulePassed = !value.split(',').map(v => v.trim().toLowerCase()).includes(String(employeeValue).toLowerCase());
        }
        break;
      case 'gte':
        rulePassed = Number(employeeValue) >= Number(value);
        break;
      case 'lte':
        rulePassed = Number(employeeValue) <= Number(value);
        break;
      default:
        rulePassed = false;
    }

    if (!rulePassed) {
      // Build human readable error message
      let fieldLabel = field.replace('customAttr.', '');
      fieldLabel = fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1).replace(/([A-Z])/g, ' $1');
      const readableVal = Array.isArray(value) ? value.join(', ') : value;
      const failedReason = `Does not meet condition: ${fieldLabel} ${operator.replace('_', ' ')} ${readableVal}`;
      return { eligible: false, failedRule: failedReason };
    }
  }

  return { eligible: true, failedRule: null };
}
