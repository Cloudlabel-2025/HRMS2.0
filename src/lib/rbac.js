/**
 * Central RBAC engine.
 * All permission logic lives here — no hardcoding in routes or frontend.
 */

// ── Module access matrix ──────────────────────────────────────────────────────
// Values: 'full' | 'limited' | 'self' | 'dept' | 'team' | 'assigned' | false
export const MODULE_ACCESS = {
  dashboard:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'limited' },
  employees:     { super_admin:'full', admin_full:'full', recruiter:'view',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:false },
  recruitment:   { super_admin:'full', admin_full:'full', recruiter:'full',    team_admin:false,   team_lead:'view',  employee:false,      intern:false },
  timecard:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  attendance:    { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  absence:       { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  leave:         { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  payroll:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:'self',     intern:false },
  payslip:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:'self',     intern:false },
  tasks:         { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'assigned', intern:'assigned' },
  projects:      { super_admin:'full', admin_full:'full', recruiter:'view',    team_admin:'team',  team_lead:'dept',  employee:'assigned', intern:'assigned' },
  performance:   { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'limited' },
  documents:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'limited' },
  finance:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:false,      intern:false },
  invoicing:     { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:false,      intern:false },
  inventory:     { super_admin:'full', admin_full:'full', recruiter:false,     team_admin:'team',  team_lead:'dept',  employee:false,      intern:false },
  reports:       { super_admin:'full', admin_full:'full', recruiter:'limited', team_admin:'team',  team_lead:'dept',  employee:'self',     intern:false },
  communication: { super_admin:'full', admin_full:'full', recruiter:false,     team_admin:'team',  team_lead:'dept',  employee:'view',     intern:'view' },
  calendar:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_admin:'team',  team_lead:'dept',  employee:'self',     intern:'self' },
  monitoring:    { super_admin:'full', admin_full:'full', recruiter:false,     team_admin:'team',  team_lead:'dept',  employee:false,      intern:false },
  settings:      { super_admin:'full', admin_full:'limited', recruiter:false,  team_admin:false,   team_lead:false,   employee:false,      intern:false },
  audit:         { super_admin:'full', admin_full:'view',  recruiter:false,    team_admin:false,   team_lead:false,   employee:false,      intern:false },
  sme:           { super_admin:'full', admin_full:'full',  recruiter:'view',   team_admin:'team',  team_lead:'dept',  employee:'limited',  intern:'limited' },
};

// ── Public helpers ────────────────────────────────────────────────────────────

/** Returns the access level string for a role+module, or false if no access */
export function getAccess(role, module) {
  return MODULE_ACCESS[module]?.[role] ?? false;
}

/** Boolean — does this role have any access to this module? */
export function hasAccess(role, module) {
  return !!getAccess(role, module);
}

/**
 * Build a MongoDB query filter that scopes data to what the user is allowed to see.
 * userIdField  — the field name on the target collection that holds the owner's userId
 * deptField    — the field name that holds department (default: 'department' via populate)
 * teamLeadField — the field name that holds teamLeadId (default: 'teamLeadId' via populate)
 */
export function scopeFilter(user, {
  userIdField   = 'userId',
  deptField     = 'department',
  teamLeadField = 'teamLeadId',
} = {}) {
  const role = user.role;

  if (['super_admin', 'admin_full'].includes(role)) return {};  // see everything

  if (role === 'recruiter') return { [userIdField]: user._id }; // self only for non-recruitment modules

  if (role === 'team_lead') {
    // Sees only employees directly assigned to them
    return { [teamLeadField]: user._id };
  }

  if (role === 'team_admin') {
    // Sees employees in their team (assigned to TLs under them, or directly)
    return { [teamLeadField]: user._id };
  }

  // employee / intern — self only
  return { [userIdField]: user._id };
}

/**
 * Scope filter for User collection queries (employees list).
 * Returns a MongoDB filter object.
 */
export function employeeScopeFilter(user) {
  const role = user.role;
  if (['super_admin', 'admin_full'].includes(role)) return {};
  if (role === 'recruiter') return {};                          // read-only view of all employees
  if (role === 'team_lead')  return { teamLeadId: user._id };  // only their direct reports
  if (role === 'team_admin') return { teamAdminId: user._id }; // only their team
  return { _id: user._id };                                    // self only
}

/** True if the role can write/mutate in this module */
export function canWrite(role, module) {
  const level = getAccess(role, module);
  return ['full', 'limited', 'dept', 'team', 'self', 'assigned'].includes(level);
}

/** True if the role has full (unrestricted) access */
export function isFull(role, module) {
  return getAccess(role, module) === 'full';
}
