import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) specifier = pathToFileURL(resolvePath('src', specifier.slice(2))).href;
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') || specifier.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL);
      for (const suffix of ['.js', '/index.js']) {
        if (existsSync(fileURLToPath(url) + suffix)) return { url: url.href + suffix, shortCircuit: true };
      }
    }
    try { return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true }; } catch {}
    throw error;
  }
}
