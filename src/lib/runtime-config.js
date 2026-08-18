const REQUIRED_PRODUCTION_ENV = [
  'MONGODB_URI',
  'JWT_SECRET',
  'IDENTITY_FIELD_ENCRYPTION_KEY',
  'CRON_SECRET',
  'APP_URL',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
];

function isAllowedProductionAppUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    return url.protocol === 'http:' && loopbackHosts.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Fails closed in production when a security-critical integration is missing.
 * Values are never included in the thrown error.
 */
export function assertProductionConfiguration() {
  if (process.env.NODE_ENV !== 'production') return;

  const missing = REQUIRED_PRODUCTION_ENV.filter(name => !process.env[name]?.trim());
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) missing.push('JWT_SECRET (minimum 32 characters)');
  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) missing.push('CRON_SECRET (minimum 32 characters)');
  if (process.env.APP_URL && !isAllowedProductionAppUrl(process.env.APP_URL)) {
    missing.push('APP_URL (must use HTTPS except on localhost)');
  }

  if (missing.length) {
    throw new Error(`Production configuration is incomplete: ${[...new Set(missing)].join(', ')}`);
  }
}

export function getProductionConfigurationStatus() {
  const missing = REQUIRED_PRODUCTION_ENV.filter(name => !process.env[name]?.trim());
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) missing.push('JWT_SECRET (minimum 32 characters)');
  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) missing.push('CRON_SECRET (minimum 32 characters)');
  if (process.env.APP_URL && !isAllowedProductionAppUrl(process.env.APP_URL)) {
    missing.push('APP_URL (must use HTTPS except on localhost)');
  }
  return { valid: missing.length === 0, missing: [...new Set(missing)] };
}
