import jwt from 'jsonwebtoken';

const EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = '7d';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 24) {
    throw new Error('JWT_SECRET must be set to a strong secret with at least 24 characters');
  }
  return secret;
}

export function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: EXPIRES });
}

export function signRefreshToken(payload) {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, getJwtSecret(), { expiresIn: REFRESH_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req) {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export const ok   = (data, status = 200) => Response.json({ success: true, data }, { status });
export const fail = (msg,  status = 400) => Response.json({ success: false, error: msg }, { status });
