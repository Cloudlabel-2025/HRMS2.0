export const CORE_HR_ADMIN_ROLES = ['super_admin', 'admin_full', 'recruiter'];
export const CORE_HR_WRITE_ROLES = ['super_admin', 'admin_full'];
export const CORE_HR_MANAGER_ROLES = ['super_admin', 'admin_full', 'team_admin', 'team_lead'];

export const IDENTITY_STATUSES = ['active', 'inactive', 'archived'];
export const GENDER_VALUES = ['male', 'female', 'transgender', 'non_binary', 'prefer_not_to_say'];
export const MARITAL_STATUS_VALUES = ['single', 'married', 'divorced', 'widowed', 'separated', 'prefer_not_to_say'];
export const ADDRESS_TYPES = ['permanent', 'current', 'present', 'mailing', 'home'];
export const IDENTIFIER_TYPES = ['pan', 'aadhaar'];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'consultant', 'apprentice'];
export const EMPLOYMENT_STATUSES = ['onboarding', 'probation', 'active', 'suspended', 'resigned', 'terminated', 'retired', 'alumni', 'rehired'];
export const SEPARATION_TYPES = ['resignation', 'termination', 'retirement', 'contract_end', 'medical_exit', 'death', 'other'];
export const SETTLEMENT_STATUSES = ['pending', 'in_progress', 'settled'];
export const SELF_SERVICE_REQUEST_TYPES = ['profile_update', 'address_update', 'emergency_contact_update', 'resignation'];
export const SELF_SERVICE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

export const LIFECYCLE_ENTITY_TYPES = ['identity', 'profile', 'address', 'identifier', 'employment', 'separation'];
export const LIFECYCLE_EVENT_TYPES = ['create', 'update', 'status_change', 'rehire', 'merge', 'separation', 'restore', 'link'];