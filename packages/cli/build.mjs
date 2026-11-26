// Bundles the CLI (inlining the workspace TS packages @genroapi/*) into dist/bin.js and copies the built UI to dist/ui.
import { build } from 'esbuild';
import { cp, rm, access, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ui = here('../ui/dist');
await access(ui + '/index.html').catch(() => { throw new Error('packages/ui/dist missing: run `npm run build -w packages/ui` first'); });
await rm(here('dist'), { recursive: true, force: true });
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22' };
// bin.js is a tiny launcher (version check, then a dynamic import of cli.js) so an old Node can print a message
// before any of the real dependencies are loaded. cli.js is the actual bundle.
await build({
  ...common,
  entryPoints: [here('src/bin.ts')],
  outfile: here('dist/bin.js'),
  external: ['./cli.js'],
  banner: { js: '#!/usr/bin/env node' },
});
await build({
  ...common,
  entryPoints: [here('src/cli.ts')],
  outfile: here('dist/cli.js'),
  external: ['fastify', 'diff', '@apidevtools/swagger-parser', 'swagger2openapi', 'yaml'],
  banner: { js: "import { createRequire as __cr } from 'node:module';const require = __cr(import.meta.url);" },
});
await cp(ui, here('dist/ui'), { recursive: true });
// npm only picks up README/LICENSE from the package dir, so copy the repo-level ones in (git-ignored copies).
await cp(here('../../README.md'), here('README.md'));
await cp(here('../../LICENSE'), here('LICENSE')).catch(e => { if (e?.code !== 'ENOENT') throw e; });
// npm links the bin straight to this file in a workspace install, so it must be executable.
await chmod(here('dist/bin.js'), 0o755);
