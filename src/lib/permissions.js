/**
 * Pure permission constants + helpers — no mongoose imports, safe for client & server.
 */
export const ADMIN_ROLES = ['super_admin', 'admin_full'];
export const MANAGER_ROLES = ['super_admin', 'admin_full', 'team_lead', 'team_admin'];
export const EMPLOYER_ROLES = ['super_admin'];
export const isEmployer = role => EMPLOYER_ROLES.includes(role);

// ── Module access matrix ──────────────────────────────────────────────────────
// Values: 'full' | 'limited' | 'self' | 'dept' | 'team' | 'assigned' | false
export const MODULE_ACCESS = {
  dashboard:     { super_admin:'full', admin_full:'full', recruiter:'limited', team_lead:'dept',   team_admin:'team', employee:'self',     intern:'limited',  sme:'self' },
  employees:     { super_admin:'full', admin_full:'full', recruiter:'view',    team_lead:'dept',   team_admin:'team', employee:'dept',     intern:false,     sme:false },
  recruitment:   { super_admin:'full', admin_full:'full', recruiter:'full',    team_lead:false,    team_admin:false,  employee:false,      intern:false,      sme:false },
  timecard:      { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:false },
  attendance:    { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  absence:       { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:false },
  leave:         { super_admin:'full', admin_full:'full', recruiter:'self',    team_lead:'dept',   team_admin:'team', employee:'self',     intern:'self',     sme:'self' },
  payroll:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:'self',     intern:false,      sme:'self' },
  payslip:       { super_admin:'full', admin_full:'limited', recruiter:false,  team_lead:false,    team_admin:false,  employee:'self',     intern:false,      sme:false },
  tasks:         { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'assigned', intern:'assigned', sme:'assigned' },
  projects:      { super_admin:'full', admin_full:'full', recruiter:false,     team_lead:'dept',   team_admin:'team', employee:'assigned', intern:'assigned', sme:'assigned' },
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

/** Returns the access level string for a role+module, or false if no access */
export function getAccess(role, module) {
  return MODULE_ACCESS[module]?.[role] ?? false;
}

/** Boolean — does this role have any access to this module? */
export function hasAccess(role, module) {
  return !!getAccess(role, module);
}
