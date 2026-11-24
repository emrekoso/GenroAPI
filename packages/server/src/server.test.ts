import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, startServer } from './server.js';

let cwd: string, app: FastifyInstance;
beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'genroapi-s-')); app = buildServer({ cwd }); });
afterEach(async () => { await app.close(); await rm(cwd, { recursive: true, force: true }); });

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as any, headers: { host: 'localhost:4000', ...headers } });

const options = { servicePrefix: '/api', query: false, zod: false, zustand: false, backend: 'none', go: { package: 'p', teaImport: 't' } };
const ep = {
  id: 'getPets', method: 'get', path: '/pets', name: 'getPets', group: 'pets', pathParams: [], queryParams: [],
  isSse: false, goMode: 'proxy', enabled: true,
};

describe('info', () => {
  it('GET /api/info returns the absolute working directory the server resolves output dirs against', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/info', headers: { host: 'localhost:4000' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ cwd });
  });
  it('/api/info is subject to the Host check', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/info', headers: { host: 'evil.com' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('security', () => {
  it('403 on foreign Host header', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/config', headers: { host: 'evil.com' } });
    expect(r.statusCode).toBe(403);
  });
  it('403 on foreign Origin, ok on same origin or none', async () => {
    const h = { host: 'localhost:4000' };
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { ...h, origin: 'http://evil.com' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { ...h, origin: 'http://localhost:4001' } })).statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/config', headers: { ...h, origin: 'http://localhost:4000' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: h })).statusCode).toBe(200);
  });
  it('415 on non-JSON body', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/preview', payload: 'x=1', headers: { host: 'localhost:4000', 'content-type': 'text/plain' } });
    expect(r.statusCode).toBe(415);
    const w = await app.inject({ method: 'PUT', url: '/api/config', payload: '{}', headers: { host: 'localhost:4000', 'content-type': 'text/plain' } });
    expect(w.statusCode).toBe(415);
  });
  it('listens on 127.0.0.1 and enforces the real port', async () => {
    const s = await startServer(0, { cwd });
    try {
      expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect((await fetch(`${s.url}/api/config`)).status).toBe(200);
      const port = new URL(s.url).port;
      const status = await new Promise<number>((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port, path: '/api/config', headers: { host: 'localhost:1' } }, res => { res.resume(); resolve(res.statusCode!); });
        rq.on('error', reject); rq.end();
      });
      expect(status).toBe(403);
    } finally { await s.close(); }
  });
});

describe('/api/spec', () => {
  it('502 with message on unreachable URL', async () => {
    const r = await post('/api/spec', { url: 'http://127.0.0.1:1/nope.json' });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toContain('http://127.0.0.1:1/nope.json');
  });
  it('502 on non-2xx and bad JSON', async () => {
    const srv = http.createServer((q, s) => { if (q.url === '/404') { s.statusCode = 404; s.end('no'); } else s.end('not json'); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as any).port}`;
    try {
      expect((await post('/api/spec', { url: `${base}/404` })).statusCode).toBe(502);
      expect((await post('/api/spec', { url: `${base}/bad` })).statusCode).toBe(502);
    } finally { srv.close(); }
  });
  it('400 on missing / non-string url', async () => {
    expect((await post('/api/spec', {})).statusCode).toBe(400);
    expect((await post('/api/spec', { url: 5 })).statusCode).toBe(400);
  });
  it('returns title, endpoints, components from a local fixture server', async () => {
    const spec = {
      openapi: '3.0.0', info: { title: 'Pets', version: '1' },
      paths: { '/pets': { get: { operationId: 'getPets', tags: ['pets'], responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } } } } },
      components: { schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' }, parent: { $ref: '#/components/schemas/Pet' } } } } }, // circular ref => kept in components

    };
    const srv = http.createServer((_q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(spec)); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    try {
      const r = await post('/api/spec', { url: `http://127.0.0.1:${(srv.address() as any).port}/spec.json` });
      expect(r.statusCode).toBe(200);
      const b = r.json();
      expect(b.title).toBe('Pets');
      expect(b.endpoints).toHaveLength(1);
      expect(b.endpoints[0]).toMatchObject({ method: 'get', path: '/pets', group: 'pets' });
      expect(Object.keys(b.components)).toContain('Pet');
    } finally { srv.close(); }
  });
});

describe('/api/preview', () => {
  it('returns generated files', async () => {
    const r = await post('/api/preview', { endpoints: [ep], options });
    expect(r.statusCode).toBe(200);
    const { files } = r.json();
    expect(files.every((x: any) => x.kind === 'frontend' && !x.path.includes('/'))).toBe(true);
    const svc = files.filter((x: any) => !x.path.includes('types'));
    expect(svc).toEqual([{
      path: svc[0].path, kind: 'frontend',
      content: "// Code generated by GenroAPI. DO NOT EDIT.\n\nimport axios from 'axios';\n\nexport async function getPets(signal?: AbortSignal): Promise<void> {\n  await axios.get(`/pets`, { signal });\n}\n",
    }]);
  });
  it('400 on invalid input', async () => {
    expect((await post('/api/preview', { endpoints: 'x', options })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [ep], options: { ...options, servicePrefix: undefined } })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [ep], options: { ...options, zod: 'yes' } })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [ep], options: { ...options, backend: 'rust' } })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [ep], options: { ...options, go: undefined } })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [ep], options, components: [] })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [null], options })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [{ ...ep, name: undefined }], options })).statusCode).toBe(400);
    expect((await post('/api/preview', { endpoints: [{ ...ep, pathParams: 'x' }], options })).statusCode).toBe(400);
  });
});

describe('/api/diff and /api/write', () => {
  const fe = () => join(cwd, 'out');
  it('diff reports new/same/changed', async () => {
    await mkdir(fe());
    await writeFile(join(fe(), 'a.gen.ts'), 'a');
    await writeFile(join(fe(), 'b.gen.ts'), 'b1');
    const files = [{ path: 'a.gen.ts', content: 'a', kind: 'frontend' }, { path: 'b.gen.ts', content: 'b2', kind: 'frontend' }, { path: 'c.gen.ts', content: 'c', kind: 'frontend' }];
    const r = await post('/api/diff', { files, outDirs: { frontend: fe() } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.map((x: any) => [x.path, x.status])).toEqual([['a.gen.ts', 'same'], ['b.gen.ts', 'changed'], ['c.gen.ts', 'new']]);
    expect(j[1].diff).toContain('-b1');
    expect(j[1].diff).toContain('+b2');
  });
  it('write: changed only if in overwrite', async () => {
    await mkdir(fe());
    await writeFile(join(fe(), 'b.gen.ts'), 'old');
    const files = [{ path: 'b.gen.ts', content: 'new', kind: 'frontend' }, { path: 'n.gen.ts', content: 'n', kind: 'frontend' }];
    const r1 = await post('/api/write', { files, outDirs: { frontend: fe() }, overwrite: [] });
    expect(r1.json()).toEqual({ written: ['n.gen.ts'], skipped: ['b.gen.ts'] });
    expect(await readFile(join(fe(), 'b.gen.ts'), 'utf8')).toBe('old');
    const r2 = await post('/api/write', { files, outDirs: { frontend: fe() }, overwrite: ['b.gen.ts'] });
    expect(r2.json()).toEqual({ written: ['b.gen.ts'], skipped: ['n.gen.ts'] });
    expect(await readFile(join(fe(), 'b.gen.ts'), 'utf8')).toBe('new');
  });
  it.each(['../x', '/etc/x', 'a/b'])('400 and nothing written for %s (even with a good file)', async bad => {
    const files = [{ path: 'good.gen.ts', content: 'g', kind: 'frontend' }, { path: bad, content: 'b', kind: 'frontend' }];
    const r = await post('/api/write', { files, outDirs: { frontend: fe() }, overwrite: [bad] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBeTruthy();
    expect(await readdir(cwd)).toEqual([]);
    const d = await post('/api/diff', { files, outDirs: { frontend: fe() } });
    expect(d.statusCode).toBe(400);
  });
  it('400 for backend file without outDirs.backend; 400 on malformed body', async () => {
    const r = await post('/api/write', { files: [{ path: 'a.gen.go', content: 'x', kind: 'backend' }], outDirs: { frontend: fe() }, overwrite: [] });
    expect(r.statusCode).toBe(400);
    expect((await post('/api/write', { files: 'x', outDirs: { frontend: fe() }, overwrite: [] })).statusCode).toBe(400);
    expect((await post('/api/write', { files: [], outDirs: {}, overwrite: [] })).statusCode).toBe(400);
    expect((await post('/api/write', { files: [], outDirs: { frontend: fe() }, overwrite: 'a' })).statusCode).toBe(400);
  });
});

describe('fs errors are 400', () => {
  it('outDir that is a file -> 400 on diff and write', async () => {
    await writeFile(join(cwd, 'afile'), 'x');
    const files = [{ path: 'a.gen.ts', content: 'a', kind: 'frontend' }];
    expect((await post('/api/diff', { files, outDirs: { frontend: join(cwd, 'afile') } })).statusCode).toBe(400);
    expect((await post('/api/write', { files, outDirs: { frontend: join(cwd, 'afile') }, overwrite: [] })).statusCode).toBe(400);
  });
  it('overlong name -> 400, nothing else written', async () => {
    const files = [{ path: 'good.gen.ts', content: 'g', kind: 'frontend' }, { path: 'a'.repeat(300), content: 'x', kind: 'frontend' }];
    expect((await post('/api/write', { files, outDirs: { frontend: join(cwd, 'out') }, overwrite: [] })).statusCode).toBe(400);
    expect(await readdir(cwd)).toEqual([]);
  });
});

describe('port check without startServer', () => {
  it('buildServer().listen() directly still enforces the port', async () => {
    const a = buildServer({ cwd });
    await a.listen({ host: '127.0.0.1', port: 0 });
    try {
      const port = (a.server.address() as any).port;
      const get = (host: string) => new Promise<number>((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port, path: '/api/config', headers: { host } }, res => { res.resume(); resolve(res.statusCode!); });
        rq.on('error', reject); rq.end();
      });
      expect(await get(`localhost:${port}`)).toBe(200);
      expect(await get('localhost:1')).toBe(403);
    } finally { await a.close(); }
  });
});

describe('/api/config', () => {
  it('20 parallel PUTs all succeed and leave valid JSON', async () => {
    const h = { host: 'localhost:4000' };
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => app.inject({ method: 'PUT', url: '/api/config', payload: { i }, headers: h })));
    expect(rs.map(r => r.statusCode)).toEqual(Array(20).fill(200));
    const cfg = JSON.parse(await readFile(join(cwd, 'genroapi.config.json'), 'utf8'));
    expect(Object.keys(cfg)).toEqual(['i']);
    expect((await readdir(cwd)).sort()).toEqual(['genroapi.config.json']);
  });
  it('GET {} when absent, PUT then GET round-trips pretty-printed', async () => {
    const h = { host: 'localhost:4000' };
    const g0 = await app.inject({ method: 'GET', url: '/api/config', headers: h });
    expect(g0.json()).toEqual({});
    const cfg = { specUrl: 'http://x/y.json', outDirs: { frontend: 'src/api' }, n: [1, 2] };
    const p = await app.inject({ method: 'PUT', url: '/api/config', payload: cfg, headers: h });
    expect(p.statusCode).toBe(200);
    expect(await readFile(join(cwd, 'genroapi.config.json'), 'utf8')).toBe(JSON.stringify(cfg, null, 2) + '\n');
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: h })).json()).toEqual(cfg);
  });
  it('PUT rejects non-objects', async () => {
    const h = { host: 'localhost:4000', 'content-type': 'application/json' };
    for (const body of ['[1]', '"s"', 'null', '5']) {
      expect((await app.inject({ method: 'PUT', url: '/api/config', payload: body, headers: h })).statusCode).toBe(400);
    }
  });
});

describe('Y1 /api/spec with YAML and HTML', () => {
  const serve = async (body: string, type: string, fn: (url: string) => Promise<void>) => {
    const srv = http.createServer((_q, s) => { s.setHeader('content-type', type); s.end(body); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
    try { await fn(`http://127.0.0.1:${(srv.address() as any).port}/swagger/`); } finally { srv.closeAllConnections(); srv.close(); }
  };
  const YAML = `openapi: 3.0.3\ninfo: {title: Y, version: "1"}\npaths:\n  /a:\n    get:\n      operationId: getA\n      responses:\n        "200": {description: ok}\n`;
  it('YAML -> 200 with endpoints', async () => {
    await serve(YAML, 'application/yaml', async url => {
      const r = await post('/api/spec', { url });
      expect(r.statusCode).toBe(200);
      expect(r.json().endpoints.map((e: any) => e.name)).toEqual(['getA']);
    });
  });
  it('HTML, invalid JSON, invalid YAML -> 502 with a clear message (not 500)', async () => {
    await serve('<!doctype html><html></html>', 'text/html', async url => {
      const r = await post('/api/spec', { url });
      expect(r.statusCode).toBe(502);
      expect(r.json().error).toContain(`Got an HTML page from ${url}, not an OpenAPI document.`);
    });
    await serve('{"openapi": ', 'application/json', async url => {
      const r = await post('/api/spec', { url });
      expect(r.statusCode).toBe(502);
      expect(r.json().error).toContain(url);
    });
    await serve('a: [unclosed\n  b: : :', 'application/yaml', async url => {
      const r = await post('/api/spec', { url });
      expect(r.statusCode).toBe(502);
      expect(r.json().error).toContain('not valid JSON or YAML');
    });
  });
  it('a body that parses but is not a spec -> 502, not 500', async () => {
    await serve('{"hello": 1}', 'application/json', async url => {
      const r = await post('/api/spec', { url });
      expect(r.statusCode).toBe(502);
    });
  });
});

describe('M5/I2 input validation is a 400, never a 500', () => {
  const bad = async (endpoints: unknown[], opts: unknown = options) => (await post('/api/preview', { endpoints, options: opts })).statusCode;
  it.each([
    ['get-users'], ['delete'], ['1abc'], ['a b'], [''], ['class'], ['a.b'],
  ])('rejects endpoint name %j', async name => { expect(await bad([{ ...ep, name }])).toBe(400); });
  it('allows odd-but-valid and disabled-invalid names; rejects cross-group duplicates', async () => {
    expect(await bad([{ ...ep, name: '$x_1' }])).toBe(200);
    expect(await bad([{ ...ep, name: 'get-users', enabled: false }])).toBe(200);
    expect(await bad([{ ...ep, name: 'dup', group: 'a' }, { ...ep, name: 'dup', group: 'b' }])).toBe(400);
    expect(await bad([{ ...ep, name: 'dup', group: 'a' }, { ...ep, name: 'dup', group: 'b', enabled: false }])).toBe(200);
  });
  it.each([
    ['pathParams element not object', { pathParams: ['x'] }],
    ['pathParams missing ident', { pathParams: [{ name: 'id', required: true }] }],
    ['pathParams ident not an identifier', { pathParams: [{ name: 'id', ident: 'a b', required: true }] }],
    ['pathParams required not boolean', { pathParams: [{ name: 'id', ident: 'id', required: 'yes' }] }],
    ['queryParams name not string', { queryParams: [{ name: 5, ident: 'q', required: false }] }],
    ['goMode not in enum', { goMode: 'rocket' }],
    ['enabled not boolean', { enabled: 'yes' }],
    ['cacheTtl not string', { cacheTtl: 5 }],
    ['method not in enum', { method: 'trace' }],
    ['isSse not boolean', { isSse: 1 }],
  ])('rejects %s', async (_n, patch) => { expect(await bad([{ ...ep, ...patch }])).toBe(400); });
  it('accepts well-formed params and cacheTtl', async () => {
    expect(await bad([{ ...ep, goMode: 'cache', cacheTtl: '5m', pathParams: [{ name: 'id', ident: 'id', required: true, schema: {} }], queryParams: [{ name: 'q', ident: 'q', required: false, schema: {} }] }])).toBe(200);
  });
  it.each([
    ['package with a dash', { go: { package: 'my-pkg', teaImport: 't' } }],
    ['package uppercase', { go: { package: 'Routers', teaImport: 't' } }],
    ['empty package', { go: { package: '', teaImport: 't' } }],
    ['empty teaImport', { go: { package: 'p', teaImport: '' } }],
    ['teaImport with quote', { go: { package: 'p', teaImport: 'a"b' } }],
    ['teaImport with newline', { go: { package: 'p', teaImport: 'a\nb' } }],
    ['teaImport with backslash', { go: { package: 'p', teaImport: 'a\\b' } }],
  ])('go backend rejects %s', async (_n, patch) => { expect(await bad([ep], { ...options, backend: 'go', ...patch })).toBe(400); });
  it('go.* is only checked for the go backend; valid go options pass', async () => {
    expect(await bad([ep], { ...options, go: { package: '', teaImport: '' } })).toBe(200);
    expect(await bad([ep], { ...options, backend: 'go', go: { package: 'routers', teaImport: 'teadash/functions/Tea' } })).toBe(200);
  });
});
