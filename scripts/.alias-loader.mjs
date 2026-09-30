// ESM resolve hook that mirrors Next.js/Turbopack resolution for plain `node`:
//  - `@/*`  →  `src/*`   (jsconfig.json paths)
//  - extensionless relative imports → try `.js`, `/index.js`
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function statFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function tryPaths(base) {
  const candidates = path.extname(base)
    ? [base]
    : [base + '.js', base + '.mjs', path.join(base, 'index.js'), base];
  for (const c of candidates) if (statFile(c)) return c;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const resolved = tryPaths(path.join(SRC, specifier.slice(2)));
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    return nextResolve(specifier, context);
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = tryPaths(path.resolve(parentDir, specifier));
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }

  return nextResolve(specifier, context);
}
