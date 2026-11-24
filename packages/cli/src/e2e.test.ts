import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '@genroapi/server';
import { run } from './cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const root = join(pkgDir, '..', '..');
const uiDir = join(root, 'packages', 'ui', 'dist');
const GOLDEN = join(pkgDir, 'fixtures', 'periodic.gen.go');

const node = (extra: object = {}) => ({ type: 'object', properties: { id: { type: 'string' }, ...extra } });
const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Periodic API', version: '1' },
  paths: {
    '/periodic/household/scores/{id}': { get: { operationId: 'getNetworkScores', tags: ['Periodic'], summary: 'Scores',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'period', in: 'query', schema: { type: 'string', enum: ['day', 'week'] } }],
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['score'], properties: { score: { type: 'number' }, labels: { type: 'array', items: { type: 'string' } } } } } } } } } },
    '/periodic/household/summary': { get: { operationId: 'getHouseholdSummary', tags: ['Periodic'],
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'integer' } } } } } } } } },
    '/periodic/household/{user-id}/notes': { post: { operationId: 'createNote', tags: ['Periodic'],
      parameters: [{ name: 'user-id', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, pinned: { type: 'boolean' } } } } } },
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' } } } } } } } } },
    '/periodic/events': { get: { operationId: 'streamEvents', tags: ['Periodic'],
      responses: { '200': { description: 'sse', content: { 'text/event-stream': { schema: { type: 'string' } } } } } } },
    '/periodic/tree': { get: { operationId: 'getTree', tags: ['Periodic'],
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/TreeNode' } } } } } } },
    '/household/extra': { get: { operationId: 'getExtra', tags: ['Periodic'],
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: node() } } } } } },
  },
  components: { schemas: { TreeNode: { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } } } } } },
};

const YAML_SPEC = `openapi: 3.0.3
info: {title: Yaml Pets, version: "1"}
paths:
  /pets/{id}:
    get:
      operationId: getPet
      tags: [pets]
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: {$ref: '#/components/schemas/Pet'}
components:
  schemas:
    Pet: {type: object, properties: {name: {type: string}}}
`;

let fixture: http.Server, fixtureUrl: string;
let tmp: string;
let srv: { url: string; close(): Promise<void> };

const call = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
  const r = await fetch(`${srv.url}${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text}`);
  return JSON.parse(text);
};

const findGo = (): string | undefined => {
  for (const c of ['go', '/usr/local/go/bin/go']) { if (spawnSync(c, ['version']).status === 0) return c; }
  return undefined;
};
const goBin = findGo();
const gofmtBin = goBin === 'go' ? 'gofmt' : '/usr/local/go/bin/gofmt';

beforeAll(async () => {
  fixture = http.createServer((req, res) => {
    if (req.url === '/spec.yaml') { res.setHeader('content-type', 'application/yaml'); res.end(YAML_SPEC); return; }
    if (req.url === '/swagger/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><script>SwaggerUIBundle({ url: "../spec.yaml" })</script></html>'); return; }
    const body = req.url === '/spec.json' ? JSON.stringify(SPEC) : req.url === '/v3.json' ? readFileSync(join(root, 'packages/core/fixtures/v3.json')) : null;
    if (body === null) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(body);
  });
  await new Promise<void>(r => fixture.listen(0, '127.0.0.1', r));
  fixtureUrl = `http://127.0.0.1:${(fixture.address() as net.AddressInfo).port}`;
  tmp = await mkdtemp(join(tmpdir(), 'genroapi-e2e-'));
  srv = await startServer(0, { cwd: tmp, uiDir });
});
afterAll(async () => { await srv?.close(); await new Promise(r => fixture?.close(r)); await rm(tmp, { recursive: true, force: true }); });

describe('end to end: spec -> preview -> diff -> write', () => {
  let endpoints: any[], components: any, files: any[];
  let outDirs: { frontend: string; backend: string };
  const options = { servicePrefix: '/periodic', query: true, zod: true, zustand: true, backend: 'go', go: { package: 'routers', teaImport: 'teadash/functions/Tea' } };

  beforeAll(async () => { outDirs = { frontend: join(tmp, 'frontend'), backend: join(tmp, 'backend') }; });

  it('parses the bundled v3 fixture too', async () => {
    const r = await call('/api/spec', { url: `${fixtureUrl}/v3.json` });
    expect(r.title).toBe('Plat API');
    expect(r.endpoints.map((e: any) => e.name)).toEqual(['getPlatforms', 'postEntityPlatformsByUserId']);
  });

  it('/api/spec loads a YAML spec; a Swagger UI page gets a helpful 502', async () => {
    const r = await call('/api/spec', { url: `${fixtureUrl}/spec.yaml` });
    expect(r.title).toBe('Yaml Pets');
    expect(r.endpoints.map((e: any) => e.name)).toEqual(['getPet']);
    expect(r.endpoints[0].response).toMatchObject({ type: 'object' });
    const res = await fetch(`${srv.url}/api/spec`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `${fixtureUrl}/swagger/` }) });
    expect(res.status).toBe(502);
    const msg = (await res.json()).error as string;
    expect(msg).toContain('not an OpenAPI document');
    expect(msg).toContain(`Found a possible spec URL: ${fixtureUrl}/spec.yaml`);
  });

  it('/api/spec parses the Periodic spec', async () => {
    const r = await call('/api/spec', { url: `${fixtureUrl}/spec.json` });
    endpoints = r.endpoints; components = r.components;
    expect(endpoints.map(e => e.name).sort()).toEqual(['createNote', 'getExtra', 'getHouseholdSummary', 'getNetworkScores', 'getTree', 'streamEvents']);
    expect(endpoints.every(e => e.group === 'Periodic')).toBe(true);
    expect(endpoints.find(e => e.name === 'streamEvents')).toMatchObject({ isSse: true, goMode: 'stream' });
    expect(Object.keys(components)).toEqual(['TreeNode']);
    expect(endpoints.find(e => e.name === 'createNote').pathParams[0]).toMatchObject({ name: 'user-id', ident: 'userId' });
  });

  it('/api/preview generates the files', async () => {
    endpoints.find(e => e.name === 'streamEvents').goMode = 'passthrough';
    endpoints.find(e => e.name === 'getHouseholdSummary').goMode = 'cache';
    Object.assign(endpoints.find(e => e.name === 'getExtra'), { goMode: 'cache', cacheTtl: '5m' });
    Object.assign(endpoints.find(e => e.name === 'getTree'), { goMode: 'cache', cacheTtl: 'time.Hour' });
    files = (await call('/api/preview', { endpoints, components, options })).files;
    expect(files.map((f: any) => f.path)).toEqual(['periodic.gen.go', 'periodic.query.gen.ts', 'periodic.service.gen.ts', 'periodic.store.gen.ts', 'periodic.types.gen.ts', 'periodic.zod.gen.ts']);
    const go = files.find((f: any) => f.kind === 'backend').content as string;
    expect(go).toContain('router.HandleProxy("/getNetworkScores/{id}", "/periodic/household/scores/{id}")');
    expect(go).toContain('router.HandleStreamPassthrough("/streamEvents", "/periodic/events")');
    expect(go).toContain('router.HandleProxyWithCache("/getHouseholdSummary", "/periodic/household/summary", CacheTTL)');
    expect(go).toContain('router.HandleProxyWithCache("/getExtra", "/periodic/household/extra", 5*time.Minute)');
    expect(go).toContain('router.HandleProxyWithCache("/getTree", "/periodic/tree", time.Hour)');
    expect(go).toContain('import "time"');
    // servicePrefix appears exactly once in every upstream, including the path that did not start with it
    for (const m of go.matchAll(/, "(\/[^"]*)"[,)]/g)) expect(m[1].match(/\/periodic/g)).toHaveLength(1);
    expect(go).toContain('"/periodic/household/extra"');
  });

  it('Go output matches golden', () => {
    const go = files.find((f: any) => f.kind === 'backend').content as string;
    // Only an explicit UPDATE_GOLDEN=1 outside CI may rewrite the golden.
    if (process.env.UPDATE_GOLDEN === '1' && !process.env.CI) writeFileSync(GOLDEN, go);
    expect(go).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  it('/api/diff: everything new', async () => {
    const d = await call('/api/diff', { files, outDirs });
    expect(d).toEqual(files.map((f: any) => ({ path: f.path, status: 'new' })));
  });

  it('/api/write writes, second write is all same', async () => {
    const w = await call('/api/write', { files, outDirs, overwrite: [] });
    expect(w).toEqual({ written: files.map((f: any) => f.path), skipped: [] });
    expect((await readdir(outDirs.frontend)).sort()).toEqual(['periodic.query.gen.ts', 'periodic.service.gen.ts', 'periodic.store.gen.ts', 'periodic.types.gen.ts', 'periodic.zod.gen.ts']);
    expect(await readFile(join(outDirs.backend, 'periodic.gen.go'), 'utf8')).toBe(files.find((f: any) => f.kind === 'backend').content);
    const d = await call('/api/diff', { files, outDirs });
    expect(d.every((e: any) => e.status === 'same')).toBe(true);
    const w2 = await call('/api/write', { files, outDirs, overwrite: [] });
    expect(w2).toEqual({ written: [], skipped: files.map((f: any) => f.path) });
  });

  it('a renamed endpoint is "changed" and only overwritten when listed', async () => {
    const renamed = endpoints.map(e => (e.name === 'getTree' ? { ...e, name: 'getTreeV2' } : e));
    const next = (await call('/api/preview', { endpoints: renamed, components, options })).files;
    const d = await call('/api/diff', { files: next, outDirs });
    const changed = d.filter((e: any) => e.status === 'changed').map((e: any) => e.path);
    expect(changed).toEqual(['periodic.gen.go', 'periodic.query.gen.ts', 'periodic.service.gen.ts', 'periodic.store.gen.ts', 'periodic.types.gen.ts', 'periodic.zod.gen.ts']);
    expect(changed).toContain('periodic.gen.go');
    expect(d.find((e: any) => e.path === 'periodic.gen.go').diff).toContain('getTreeV2');

    const before = await readFile(join(outDirs.backend, 'periodic.gen.go'), 'utf8');
    const w = await call('/api/write', { files: next, outDirs, overwrite: [] });
    expect(w.written).toEqual([]);
    expect(await readFile(join(outDirs.backend, 'periodic.gen.go'), 'utf8')).toBe(before);

    const w2 = await call('/api/write', { files: next, outDirs, overwrite: ['periodic.gen.go'] });
    expect(w2.written).toEqual(['periodic.gen.go']);
    expect(await readFile(join(outDirs.backend, 'periodic.gen.go'), 'utf8')).toContain('getTreeV2');
    expect(w2.skipped).toEqual(changed.filter((p: string) => p !== 'periodic.gen.go'));
  });

  it.skipIf(!goBin)(`generated Go compiles and is gofmt-clean (${goBin ?? 'go not found on PATH or at /usr/local/go/bin/go'})`, async () => {
    const mod = await mkdtemp(join(tmpdir(), 'genroapi-go-'));
    try {
      await mkdir(join(mod, 'functions', 'Tea'), { recursive: true });
      await mkdir(join(mod, 'routers'));
      await writeFile(join(mod, 'go.mod'), 'module teadash\n\ngo 1.21\n');
      await writeFile(join(mod, 'functions', 'Tea', 'tea.go'), `package Tea

import "time"

type Router struct{}

func (r *Router) HandleProxy(path, proxy string)                                 {}
func (r *Router) HandleProxyUnsecure(path, proxy string)                         {}
func (r *Router) HandleProxyWithCache(path, proxy string, ttl time.Duration)     {}
func (r *Router) HandleStream(path, proxy string)                                {}
func (r *Router) HandleStreamPassthrough(path, proxy string)                     {}
`);
      await writeFile(join(mod, 'routers', 'ttl.go'), 'package routers\n\nimport "time"\n\nconst CacheTTL = time.Hour\n');
      const gen = files.find((f: any) => f.kind === 'backend');
      await writeFile(join(mod, 'routers', gen.path), gen.content);
      const env = { ...process.env, GOFLAGS: '-mod=mod', GOCACHE: join(mod, '.gocache'), GOPATH: join(mod, '.gopath') };
      expect(execFileSync(goBin!, ['build', './...'], { cwd: mod, env, encoding: 'utf8' })).toBe('');
      expect(execFileSync(gofmtBin, ['-l', join(mod, 'routers', gen.path)], { encoding: 'utf8' })).toBe('');
    } finally { await rm(mod, { recursive: true, force: true }); }
  }, 120_000);

  it('generated TypeScript compiles under tsc --strict', async () => {
    const dir = join(pkgDir, '.tmp-e2e', `ts-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      const ts = files.filter((f: any) => f.kind === 'frontend');
      for (const f of ts) await writeFile(join(dir, f.path), f.content);
      const tsc = join(root, 'node_modules', '.bin', 'tsc');
      const r = spawnSync(tsc, ['--noEmit', '--strict', '--skipLibCheck', 'false', '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2022', '--jsx', 'react-jsx', '--lib', 'es2022,dom', ...ts.map((f: any) => join(dir, f.path))], { cwd: pkgDir, encoding: 'utf8' });
      expect(r.stdout + r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally { await rm(join(pkgDir, '.tmp-e2e'), { recursive: true, force: true }); }
  }, 120_000);
});

describe('cli', () => {
  const sink = () => { const o: string[] = [], e: string[] = []; return { o, e, io: { out: (s: string) => { o.push(s); }, err: (s: string) => { e.push(s); } } }; };
  const get = (url: string, headers: Record<string, string>) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const u = new URL(url);
    const rq = http.request({ host: u.hostname, port: u.port, path: u.pathname, headers }, res => { let b = ''; res.on('data', d => (b += d)); res.on('end', () => resolve({ status: res.statusCode!, body: b })); });
    rq.on('error', reject); rq.end();
  });

  beforeAll(() => { execFileSync('npm', ['run', 'build', '-w', 'packages/ui'], { cwd: root, stdio: 'pipe' }); }, 180_000);

  it('serves the built UI, config, rejects foreign host, and frees the port', async () => {
    const { o, io } = sink();
    const h = await run(['--no-open', '--port', '0', '--cwd', tmp], io);
    expect(h.exitCode).toBeUndefined();
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(o.join('')).toBe(`GenroAPI running at ${h.url}\n`);
    const idx = await fetch(`${h.url}/`);
    expect(idx.status).toBe(200);
    expect(await idx.text()).toBe(readFileSync(join(uiDir, 'index.html'), 'utf8'));
    expect(idx.headers.get('x-content-type-options')).toBe('nosniff');
    expect(idx.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await fetch(`${h.url}/api/config`)).status).toBe(200);
    expect((await get(`${h.url}/api/config`, { host: 'evil.example' })).status).toBe(403);
    const port = Number(new URL(h.url!).port);
    await h.close();
    await new Promise<void>((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(port, '127.0.0.1', () => s.close(() => resolve())); });
  });

  it('--help prints usage and exits 0; --version prints the version', async () => {
    const a = sink();
    const h = await run(['--help'], a.io);
    expect(h.exitCode).toBe(0);
    expect(a.o.join('')).toMatch(/^Usage: genroapi \[options\]\n/);
    expect(a.o.join('')).toContain('--no-open');
    const b = sink();
    expect((await run(['--version'], b.io)).exitCode).toBe(0);
    expect(b.o.join('')).toBe(`${JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version}\n`);
  });

  it('unknown flag or bad value -> usage on stderr, exit 2', async () => {
    for (const argv of [['--bogus'], ['--port', 'abc'], ['--port'], ['--port', '70000'], ['stray']]) {
      const s = sink();
      const h = await run(argv, s.io);
      expect([argv, h.exitCode]).toEqual([argv, 2]);
      expect(s.e.join('')).toContain('Usage: genroapi');
      expect(s.o.join('')).toBe('');
    }
  });

  it('missing UI build -> exit 1 with instructions', async () => {
    const s = sink();
    const h = await run(['--no-open', '--ui-dir', join(tmp, 'nope')], s.io);
    expect(h.exitCode).toBe(1);
    expect(s.e.join('')).toContain('npm run build -w packages/ui');
    expect(existsSync(join(tmp, 'nope'))).toBe(false);
  });
});
