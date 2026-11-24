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
  });
});

describe('/api/diff and /api/write', () => {
  const fe = () => join(cwd, 'out');
  it('diff reports new/same/changed', async () => {
    await mkdir(fe());
    await writeFile(join(fe(), 'a.ts'), 'a');
    await writeFile(join(fe(), 'b.ts'), 'b1');
    const files = [{ path: 'a.ts', content: 'a', kind: 'frontend' }, { path: 'b.ts', content: 'b2', kind: 'frontend' }, { path: 'c.ts', content: 'c', kind: 'frontend' }];
    const r = await post('/api/diff', { files, outDirs: { frontend: fe() } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.map((x: any) => [x.path, x.status])).toEqual([['a.ts', 'same'], ['b.ts', 'changed'], ['c.ts', 'new']]);
    expect(j[1].diff).toContain('-b1');
    expect(j[1].diff).toContain('+b2');
  });
  it('write: changed only if in overwrite', async () => {
    await mkdir(fe());
    await writeFile(join(fe(), 'b.ts'), 'old');
    const files = [{ path: 'b.ts', content: 'new', kind: 'frontend' }, { path: 'n.ts', content: 'n', kind: 'frontend' }];
    const r1 = await post('/api/write', { files, outDirs: { frontend: fe() }, overwrite: [] });
    expect(r1.json()).toEqual({ written: ['n.ts'], skipped: ['b.ts'] });
    expect(await readFile(join(fe(), 'b.ts'), 'utf8')).toBe('old');
    const r2 = await post('/api/write', { files, outDirs: { frontend: fe() }, overwrite: ['b.ts'] });
    expect(r2.json()).toEqual({ written: ['b.ts'], skipped: ['n.ts'] });
    expect(await readFile(join(fe(), 'b.ts'), 'utf8')).toBe('new');
  });
  it.each(['../x', '/etc/x', 'a/b'])('400 and nothing written for %s (even with a good file)', async bad => {
    const files = [{ path: 'good.ts', content: 'g', kind: 'frontend' }, { path: bad, content: 'b', kind: 'frontend' }];
    const r = await post('/api/write', { files, outDirs: { frontend: fe() }, overwrite: [bad] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBeTruthy();
    expect(await readdir(cwd)).toEqual([]);
    const d = await post('/api/diff', { files, outDirs: { frontend: fe() } });
    expect(d.statusCode).toBe(400);
  });
  it('400 for backend file without outDirs.backend; 400 on malformed body', async () => {
    const r = await post('/api/write', { files: [{ path: 'a.go', content: 'x', kind: 'backend' }], outDirs: { frontend: fe() }, overwrite: [] });
    expect(r.statusCode).toBe(400);
    expect((await post('/api/write', { files: 'x', outDirs: { frontend: fe() }, overwrite: [] })).statusCode).toBe(400);
    expect((await post('/api/write', { files: [], outDirs: {}, overwrite: [] })).statusCode).toBe(400);
    expect((await post('/api/write', { files: [], outDirs: { frontend: fe() }, overwrite: 'a' })).statusCode).toBe(400);
  });
});

describe('/api/config', () => {
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
