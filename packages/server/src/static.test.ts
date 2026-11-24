import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, startServer } from './server.js';

let root: string, ui: string, app: FastifyInstance;
const H = { host: 'localhost:4000' };
const get = (url: string, method: 'GET' | 'HEAD' = 'GET', headers: Record<string, string> = H) => app.inject({ method, url, headers });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'genroapi-static-'));
  ui = join(root, 'ui');
  await mkdir(join(ui, 'assets'), { recursive: true });
  await mkdir(join(root, 'secret'));
  await writeFile(join(root, 'secret', 'x.txt'), 'SECRET');
  await writeFile(join(root, 'outside.txt'), 'OUTSIDE');
  await writeFile(join(ui, 'index.html'), '<html>INDEX</html>');
  await writeFile(join(ui, 'assets', 'app-abc.js'), 'console.log(1)');
  await writeFile(join(ui, 'assets', 'app-abc.css'), 'a{}');
  await writeFile(join(ui, 'assets', 'app-abc.js.map'), '{}');
  await writeFile(join(ui, 'logo.svg'), '<svg/>');
  await writeFile(join(ui, 'favicon.ico'), 'ico');
  await writeFile(join(ui, 'pic.png'), 'png');
  await writeFile(join(ui, 'data.json'), '{}');
  await writeFile(join(ui, 'blob.xyz'), 'bin');
  await writeFile(join(ui, '.secret'), 'DOT');
  await mkdir(join(ui, '.hidden'));
  await writeFile(join(ui, '.hidden', 'a.txt'), 'DOT');
  await symlink(join(root, 'outside.txt'), join(ui, 'link.txt'));
  await symlink(join(root, 'secret'), join(ui, 'linkdir'));
  app = buildServer({ cwd: root, uiDir: ui });
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

describe('static ui', () => {
  it('sets nosniff, referrer-policy and CSP on static responses', async () => {
    for (const url of ['/', '/assets/app-abc.js', '/logo.svg']) {
      const r = await get(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['x-content-type-options'], url).toBe('nosniff');
      expect(r.headers['referrer-policy'], url).toBe('no-referrer');
      expect(r.headers['content-security-policy'], url).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    }
    const api = await get('/api/config');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
  });
  it('serves / as index.html with no-cache', async () => {
    const r = await get('/');
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('<html>INDEX</html>');
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect((await get('/index.html')).body).toBe('<html>INDEX</html>');
    expect((await get('/?x=1')).statusCode).toBe(200);
  });
  it('content types and caching', async () => {
    const types: Record<string, string> = {
      '/assets/app-abc.js': 'text/javascript; charset=utf-8',
      '/assets/app-abc.css': 'text/css; charset=utf-8',
      '/assets/app-abc.js.map': 'application/json; charset=utf-8',
      '/logo.svg': 'image/svg+xml',
      '/favicon.ico': 'image/x-icon',
      '/pic.png': 'image/png',
      '/data.json': 'application/json; charset=utf-8',
      '/blob.xyz': 'application/octet-stream',
    };
    for (const [url, type] of Object.entries(types)) {
      const r = await get(url);
      expect([url, r.statusCode]).toEqual([url, 200]);
      expect([url, r.headers['content-type']]).toEqual([url, type]);
    }
    expect((await get('/assets/app-abc.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get('/logo.svg')).headers['cache-control']).toBe('no-cache');
  });
  it('HEAD returns headers and no body', async () => {
    const r = await get('/assets/app-abc.css', 'HEAD');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(r.body).toBe('');
    expect((await get('/', 'HEAD')).statusCode).toBe(200);
  });
  it('unknown paths are 404 (no SPA fallback), POST is not served', async () => {
    expect((await get('/nope')).statusCode).toBe(404);
    expect((await get('/assets/missing.js')).statusCode).toBe(404);
    expect((await get('/assets')).statusCode).toBe(404);
    expect((await get('/api/nope')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/logo.svg', headers: H })).statusCode).toBe(404);
  });
  it('/api routes keep priority', async () => {
    const r = await get('/api/config');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
  });
  it('rejects traversal variants with 404', async () => {
    const urls = [
      '/../outside.txt', '/assets/../../outside.txt', '/%2e%2e/outside.txt', '/%2E%2E%2Foutside.txt', '/assets/%2e%2e/%2e%2e/outside.txt',
      '/..%2foutside.txt', '/assets/..%2f..%2foutside.txt', '/%252e%252e/outside.txt', '/assets/..\\..\\outside.txt', '/..%5coutside.txt',
      '/%5Coutside.txt', '/logo.svg%00.png', '/logo.svg%00', '//etc/passwd', '/%2fetc/passwd', '/assets//app-abc.js',
    ];
    for (const u of urls) {
      const r = await get(u);
      expect([u, r.statusCode]).toEqual([u, 404]);
      expect(r.body).not.toContain('OUTSIDE');
      expect(r.body).not.toContain('SECRET');
    }
  });
  it('rejects raw traversal over a real socket', async () => {
    const s = await startServer(0, { cwd: root, uiDir: ui });
    try {
      const port = new URL(s.url).port;
      const status = await new Promise<number>((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port, path: '/../outside.txt', method: 'GET' }, res => { res.resume(); resolve(res.statusCode!); });
        rq.on('error', reject); rq.end();
      });
      expect(status).toBe(404);
      expect((await fetch(`${s.url}/`)).status).toBe(200);
    } finally { await s.close(); }
  });
  it('refuses symlink escapes (file and directory)', async () => {
    expect((await get('/link.txt')).statusCode).toBe(404);
    expect((await get('/linkdir/x.txt')).statusCode).toBe(404);
  });
  it('never serves dotfiles', async () => {
    expect((await get('/.secret')).statusCode).toBe(404);
    expect((await get('/.hidden/a.txt')).statusCode).toBe(404);
    expect((await get('/%2esecret')).statusCode).toBe(404);
  });
  it('host/origin hook still applies to static GETs', async () => {
    expect((await get('/', 'GET', { host: 'evil.com' })).statusCode).toBe(403);
    expect((await get('/logo.svg', 'GET', { ...H, origin: 'http://evil.com' })).statusCode).toBe(403);
  });
  it('without uiDir, / is 404', async () => {
    const a = buildServer({ cwd: root });
    try { expect((await a.inject({ method: 'GET', url: '/', headers: H })).statusCode).toBe(404); } finally { await a.close(); }
  });
});
