// Run with: node --experimental-vm-modules scripts/test-account-environment.mjs
// Exercises real route handlers with an in-memory database; never loads .env.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const env = { NODE_ENV: 'production', SETUP_TOKEN: 'test-setup', SEED_ADMIN_EMAIL: 'superadmin@hrms.com', SEED_ADMIN_PASSWORD: 'test-password', ENABLE_SEED_ROUTE: 'true' };
const context = vm.createContext({ process: { env }, Response, Request, console });
let currentUser;
let impersonatedUser;
let refreshKind = false;
let writes = 0;
let createdUser;
const query = value => ({ select: async () => value });
const model = {
  findOne: async () => null,
  findById: () => query(null),
  findOneAndUpdate: async () => ({}),
  create: async () => { writes++; },
  updateOne: async () => { writes++; },
  updateMany: async () => { writes++; },
};
const userModel = {
  findOne: criteria => criteria.role ? null : query(currentUser),
  findById: id => query(id === 'impersonated' ? impersonatedUser : currentUser),
  create: async data => { createdUser = data; return data; },
};
const nextResponse = {
  json(body, options) {
    const result = Response.json(body, options);
    result.clearedCookies = [];
    result.cookies = { set: (name, value, config) => result.clearedCookies.push({ name, value, ...config }) };
    return result;
  },
};
const stubs = {
  'db.js': { default: async () => {}, connectDB: async () => {} },
  'jwt.js': {
    verifyToken: () => ({ id: 'user', ...(refreshKind ? { tokenType: 'refresh', jti: 'test-jti' } : {}) }),
    getTokenFromRequest: () => 'test-access', getRefreshTokenFromRequest: () => 'test-refresh',
    fail: (error, status = 400) => Response.json({ success: false, error }, { status }),
    ok: (data, status = 200) => Response.json({ success: true, data }, { status }),
    signToken: () => { throw new Error('Unexpected token issuance'); },
    signRefreshToken: () => { throw new Error('Unexpected refresh issuance'); },
    SESSION_COOKIE_OPTIONS: {},
  },
  'validation.js': { LoginSchema: {}, validateRequest: (_schema, data) => ({ valid: true, data }) },
  'payroll-cycle.js': { parseShiftStartTime: () => {} },
  'shift-utils.js': { resolveShift: () => {} },
  'half-day-window.js': { resolveHalfDaySplitMins: () => {}, evaluateHalfDayGate: () => {} },
  'sse.js': { subscribeAttendance: () => { throw new Error('Unexpected attendance subscription'); } },
};
const cache = new Map();
async function load(identifier) {
  if (cache.has(identifier)) return cache.get(identifier);
  let exports;
  if (identifier === 'next/server') exports = { NextResponse: nextResponse };
  else if (identifier === 'crypto') exports = { randomUUID: () => 'test-jti' };
  else if (identifier.includes('/models/')) exports = { default: identifier.endsWith('/User.js') ? userModel
    : identifier.endsWith('/RefreshToken.js') ? { ...model, findOne: async () => ({ revoked: false, expiresAt: new Date(Date.now() + 60000) }) }
      : model };
  else exports = stubs[path.basename(identifier)];
  const module = exports
    ? new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier })
    : new vm.SourceTextModule(await readFile(identifier, 'utf8'), { context, identifier });
  cache.set(identifier, module);
  await module.link((specifier, parent) => {
    if (specifier === 'next/server' || specifier === 'crypto') return load(specifier);
    let resolved = specifier.startsWith('@/')
      ? path.resolve('src', specifier.slice(2))
      : path.resolve(path.dirname(parent.identifier), specifier);
    if (!resolved.endsWith('.js')) resolved += '.js';
    return load(resolved.replaceAll('\\', '/'));
  });
  return module;
}
async function namespace(file) {
  const module = await load(path.resolve(file).replaceAll('\\', '/'));
  if (module.status !== 'evaluated') await module.evaluate();
  return module.namespace;
}

const policy = await namespace('src/lib/account-environment.js');
const seedUser = { _id: 'user', email: 'superadmin@hrms.com', role: 'super_admin', status: 'active' };
const kavin = { ...seedUser, email: 'kavin.dev01@gmail.com', localOnly: true };
assert.equal(policy.isAccountAllowedInEnvironment(seedUser), false);
assert.equal(policy.isAccountAllowedInEnvironment(kavin), true);
assert.equal(policy.isAccountAllowedInEnvironment({ email: 'real-admin@example.com' }), true);
assert.equal(policy.isAccountAllowedInEnvironment({ email: 'renamed@example.com', localOnly: true }), false);
env.LOCAL_ONLY_ADMIN_EMAILS = ' Custom@Example.com , kavin.dev01@gmail.com';
assert.equal(policy.isAccountAllowedInEnvironment({ email: 'custom@example.com' }), false);
assert.equal(policy.isAccountAllowedInEnvironment(kavin), true);
env.SEED_ADMIN_EMAIL = 'legacy@example.com';
assert.equal(policy.isAccountAllowedInEnvironment({ email: 'legacy@example.com' }), false);
assert.equal(policy.isAccountAllowedInEnvironment(seedUser), false);
env.SEED_ADMIN_EMAIL = seedUser.email;
env.NODE_ENV = 'development';
assert.equal(policy.isAccountAllowedInEnvironment(seedUser), true);
env.NODE_ENV = 'production';

const middleware = await namespace('src/lib/middleware.js');
const request = new Request('https://hrms.example.com/api/test');
currentUser = seedUser;
assert.equal((await middleware.requireAuth(request)).error.status, 401);
assert.equal((await middleware.requirePortalAuth(request)).error.status, 401);
currentUser = kavin;
assert.equal((await middleware.requireAuth(request)).user.email, kavin.email);
assert.equal((await middleware.requirePortalAuth(request)).user.email, kavin.email);
impersonatedUser = seedUser;
assert.equal((await middleware.requireAuth(new Request(request, { headers: { 'x-impersonate': 'impersonated' } }))).error.status, 403);
env.NODE_ENV = 'development';
currentUser = seedUser;
assert.equal((await middleware.requireAuth(request)).user.email, seedUser.email);
env.NODE_ENV = 'production';

const login = await namespace('src/app/api/auth/login/route.js');
assert.equal((await login.POST(new Request(request, { method: 'POST', body: JSON.stringify({ email: seedUser.email, password: 'unused' }) }))).status, 401);
refreshKind = true;
const refresh = await namespace('src/app/api/auth/refresh/route.js');
const beforeRefresh = writes;
const deniedRefresh = await refresh.POST(new Request(request, { method: 'POST' }));
assert.equal(deniedRefresh.status, 401);
assert.equal(deniedRefresh.clearedCookies.length, 2);
assert.equal(writes, beforeRefresh, 'Production rejection must not revoke shared local sessions');
const stream = await namespace('src/app/api/attendance/events/route.js');
assert.equal((await stream.GET(request)).status, 401);

const seed = await namespace('src/app/api/seed/route.js');
const seedRequest = () => new Request(request, { method: 'POST', headers: { 'x-setup-token': env.SETUP_TOKEN } });
assert.equal((await seed.POST(seedRequest())).status, 403);
env.NODE_ENV = 'development';
// Seed route uses await findOne without select; match the real query behavior here.
userModel.findOne = async () => null;
assert.equal((await seed.POST(seedRequest())).status, 201);
assert.equal(createdUser.localOnly, true);
env.NODE_ENV = 'production';
env.SEED_ADMIN_EMAIL = kavin.email;
assert.equal((await seed.POST(seedRequest())).status, 201);
assert.equal(createdUser.localOnly, false);
console.log('PASS: account policy, login, existing API/portal sessions, impersonation, refresh, attendance fallback, and seed restrictions. No live database used.');
