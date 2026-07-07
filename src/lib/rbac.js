/**
 * Central RBAC engine.
 * All permission logic lives here — no hardcoding in routes or frontend.
 */

// ── Module access matrix ──────────────────────────────────────────────────────
// Values: 'full' | 'limited' | 'self' | 'dept' | 'team' | 'assigned' | false
export const MODULE_ACCESS = {
  dashboard:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:'self' },
  employees:     { super_admin:'full', admin_full:'full', recruiter:'view',    team_lead:'dept',   team_admin:'team', employee:'dept',     intern:'dept',     sme:false },
  recruitment:   { super_admin:'full', admin_full:'full', recruiter:'full',    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  timecard:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:false },
  attendance:    { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  absence:       { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:false },
  leave:         { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  payroll:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:'self',     intern:false,      sme:'self' },
  payslip:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:'self',     intern:false,      sme:false },
  tasks:         { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'assigned', intern:'assigned', sme:'assigned' },
  projects:      { super_admin:'full', admin_full:'full', recruiter:'view',    team_lead:'dept',   team_admin:'team', employee:'assigned', intern:'assigned', sme:'assigned' },
  performance:   { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:false },
  documents:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:false },
  finance:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  invoicing:     { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  inventory:     { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:false,      intern:false,      sme:false },
  reports:       { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:false,      sme:false },
  communication: { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'view',     intern:'view',     sme:false },
  calendar:      { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  monitoring:    { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:false,      intern:false,      sme:false },
  core_hr:       { super_admin:'full', admin_full:'full', recruiter:'view',    team_lead:'dept',   team_admin:'team', employee:false,      intern:false,      sme:false },
  self_service:  { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'self',   team_admin:'self', employee:'self',     intern:'self',     sme:'self' },
  settings:      { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  audit:         { super_admin:'full', admin_full:'view',  recruiter:false,    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  sme:           { super_admin:'full', admin_full:false,   recruiter:false,    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
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
