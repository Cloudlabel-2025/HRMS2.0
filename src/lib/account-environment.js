import { isDevAdminEmail } from './permissions';

const normalizeEmail = value => String(value || '').trim().toLowerCase();

/** Server-side policy; never use a client-supplied hostname to grant access. */
export function isLocalOnlyAccount(user) {
  if (!user || isDevAdminEmail(normalizeEmail(user.email))) return false;
  const localEmails = [
    'superadmin@hrms.com',
    process.env.SEED_ADMIN_EMAIL,
    ...(process.env.LOCAL_ONLY_ADMIN_EMAILS || '').split(','),
  ].map(normalizeEmail).filter(Boolean);
  return user.localOnly === true || localEmails.includes(normalizeEmail(user.email));
}

export function isAccountAllowedInEnvironment(user) {
  return !isLocalOnlyAccount(user) || ['development', 'test'].includes(process.env.NODE_ENV);
}
