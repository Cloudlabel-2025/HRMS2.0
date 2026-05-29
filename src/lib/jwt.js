import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES = '7d';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: REFRESH_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
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
