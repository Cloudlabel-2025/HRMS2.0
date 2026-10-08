const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Next's server test utilities expect the runtime globals installed by Next.
globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
const { transformSync } = require('next/dist/build/swc');
const { NextRequest } = require('next/server');
const serverTesting = require('next/experimental/testing/server');
const doesProxyMatch = serverTesting.unstable_doesProxyMatch || serverTesting.unstable_doesMiddlewareMatch;

// Compile the actual Proxy using the compiler bundled with this Next.js version.
const source = fs.readFileSync('src/proxy.js', 'utf8');
const compiled = transformSync(source, {
  filename: 'src/proxy.js',
  jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
  module: { type: 'commonjs' },
});
const moduleScope = { exports: {} };
vm.runInNewContext(compiled.code, { require, module: moduleScope, exports: moduleScope.exports, process });
const { proxy, config } = moduleScope.exports;

async function main() {
  const previous = process.env.MAINTENANCE_MODE;
  try {
    process.env.MAINTENANCE_MODE = 'true';
    for (const [path, method] of [
      ['/', 'GET'], ['/dashboard', 'GET'], ['/api/attendance', 'POST'],
      ['/api/attendance/daily-sweep', 'GET'], ['/api/shifts/apply-due', 'GET'],
      ['/api/users', 'DELETE'], ['/api', 'GET'],
    ]) {
      assert.equal(doesProxyMatch({ config, nextConfig: {}, url: path }), true, `${path} must be protected`);
      const response = proxy(new NextRequest(`https://example.com${path}`, { method }));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
      assert.equal(response.headers.get('x-hrms-maintenance'), 'true');
      if (path.startsWith('/api')) assert.equal((await response.json()).maintenance, true);
      else assert.match(await response.text(), /We’ll be back soon/);
    }
    assert.equal(doesProxyMatch({ config, nextConfig: {}, url: '/_next/static/chunk.js' }), false);
    for (const value of ['false', undefined]) {
      if (value === undefined) delete process.env.MAINTENANCE_MODE;
      else process.env.MAINTENANCE_MODE = value;
      const response = proxy(new NextRequest('https://example.com/api/attendance', { method: 'POST' }));
      assert.equal(response.headers.get('x-middleware-next'), '1');
    }
    console.log('Maintenance checks passed: pages, API writes, GET cron jobs, no-cache responses, and normal traffic when disabled.');
  } finally {
    if (previous === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previous;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
