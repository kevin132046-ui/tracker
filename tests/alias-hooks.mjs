// Module resolution for `node --test`: the app's "@/…" imports (tsconfig paths) and extensionless
// relative imports point at TypeScript sources, which Node runs with its built-in type stripping.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const extensions = ['.ts', '.tsx', '/index.ts'];

const typescriptFile = (base) => {
  for (const extension of extensions) {
    const candidate = new URL(`${base.href}${extension}`);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
};

export async function resolve(specifier, context, next) {
  // The Workers runtime module does not exist under Node; tests get a plain env object instead.
  if (specifier === 'cloudflare:workers') return next(new URL('stubs/cloudflare-workers.mjs', import.meta.url).href, context);
  if (specifier.startsWith('@/')) {
    const target = typescriptFile(new URL(specifier.slice(2), root));
    if (target) return next(target, context);
  } else if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
    const target = typescriptFile(new URL(specifier, context.parentURL));
    if (target) return next(target, context);
  }
  return next(specifier, context);
}
