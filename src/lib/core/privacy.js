import crypto from 'crypto';

function deriveKey() {
  const source = process.env.IDENTITY_FIELD_ENCRYPTION_KEY || process.env.IDENTITY_CRYPTO_KEY || '';
  if (!source) return null;
  return crypto.createHash('sha256').update(source).digest();
}

export function normalizePan(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function normalizeAadhaar(value) {
  return String(value || '').replace(/\D+/g, '');
}

export function maskPan(value) {
  const pan = normalizePan(value);
  if (!pan) return '';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    throw new Error('Invalid PAN format');
  }
  return `${pan.slice(0, 5)}****${pan.slice(-1)}`;
}

export function maskAadhaar(value) {
  const aadhaar = normalizeAadhaar(value);
  if (!aadhaar) return '';
  if (!/^[0-9]{12}$/.test(aadhaar)) {
    throw new Error('Invalid Aadhaar format');
  }
  return `XXXX-XXXX-${aadhaar.slice(-4)}`;
}

export function hashSensitiveValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function encryptSensitiveValue(value) {
  const key = deriveKey();
  if (!key || !value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function buildSensitiveIdentifierPayload(type, rawValue) {
  if (!rawValue) return { maskedValue: '', last4: '', hashValue: '', encryptedValue: null, isVerified: false, verifiedAt: null, source: 'manual' };

  if (type === 'pan') {
    const pan = normalizePan(rawValue);
    return {
      maskedValue: maskPan(pan),
      last4: pan.slice(-1),
      hashValue: hashSensitiveValue(pan),
      encryptedValue: encryptSensitiveValue(pan),
      isVerified: false,
      verifiedAt: null,
      source: 'manual',
    };
  }

  if (type === 'aadhaar') {
    const aadhaar = normalizeAadhaar(rawValue);
    return {
      maskedValue: maskAadhaar(aadhaar),
      last4: aadhaar.slice(-4),
      hashValue: hashSensitiveValue(aadhaar),
      encryptedValue: encryptSensitiveValue(aadhaar),
      isVerified: false,
      verifiedAt: null,
      source: 'manual',
    };
  }

  throw new Error(`Unsupported identifier type: ${type}`);
}

export function sanitizeSensitiveIdentifier(value) {
  if (!value) return null;
  return {
    maskedValue: value.maskedValue || '',
    last4: value.last4 || '',
    isVerified: !!value.isVerified,
    verifiedAt: value.verifiedAt || null,
    source: value.source || 'manual',
  };
}

export function sanitizeIdentityRecord(record) {
  if (!record) return null;
  const plain = typeof record.toObject === 'function' ? record.toObject({ virtuals: true }) : { ...record };
  if (plain.identifiers) {
    plain.identifiers = {
      pan: sanitizeSensitiveIdentifier(plain.identifiers.pan),
      aadhaar: sanitizeSensitiveIdentifier(plain.identifiers.aadhaar),
    };
  }
  return plain;
}

export function sanitizeProfileRecord(record) {
  if (!record) return null;
  return typeof record.toObject === 'function' ? record.toObject({ virtuals: true }) : { ...record };
}

export function buildChangeSet(before = {}, after = {}, fields = [], sensitiveFields = []) {
  const changes = [];
  for (const field of fields) {
    const beforeValue = before?.[field];
    const afterValue = after?.[field];
    const beforeSerialized = JSON.stringify(beforeValue ?? null);
    const afterSerialized = JSON.stringify(afterValue ?? null);
    if (beforeSerialized !== afterSerialized) {
      changes.push({
        field,
        from: sensitiveFields.includes(field) ? '[MASKED]' : beforeValue ?? null,
        to: sensitiveFields.includes(field) ? '[MASKED]' : afterValue ?? null,
        sensitive: sensitiveFields.includes(field),
      });
    }
  }
  return changes;
}