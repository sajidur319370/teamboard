// Production build: bundles src/server.ts into dist/server.js.
// npm dependencies stay external (installed on the server); @teamboard/shared is
// inlined because it ships raw .ts with no build step of its own.
// We call esbuild directly because tsup 9 loads rollup's native binary, which
// Windows Application Control blocks on some machines.
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
import pkg from '../package.json' with { type: 'json' };

const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@teamboard/'));

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});
