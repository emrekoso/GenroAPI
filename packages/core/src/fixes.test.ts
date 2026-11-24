import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { plan, emitGo, emitFrontend, emitQuery, emitZustand, resolveUpstream, groupSlug, RESERVED_WORDS, toIdent } from './index.js';
import type { Endpoint, GenOptions, GeneratedFile } from './index.js';

const o: GenOptions = { servicePrefix: '/api', query: true, zod: true, zustand: true, backend: 'go', go: { package: 'routers', teaImport: 'example.com/tea' } };
const ep = (p: Partial<Endpoint>): Endpoint => ({ id: 'x', method: 'get', path: '/a', name: 'a', group: 'g', pathParams: [], queryParams: [], isSse: false, goMode: 'proxy', enabled: true, ...p });
const pp = (name: string, ident = toIdent(name)) => ({ name, ident, required: true, schema: { type: 'string' } });
const qp = (name: string, required = false) => ({ name, ident: toIdent(name), required, schema: { type: 'string' } });
const str = { type: 'string' };

/** Writes files + stubs to a temp dir and runs tsc --strict --noUnusedLocals; returns the tsc output ('' when clean). */
function tscOutput(files: GeneratedFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'genroapi-fix-'));
  try {
    for (const f of files.filter((x) => x.kind === 'frontend')) writeFileSync(join(dir, f.path), f.content);
    for (const s of ['react-query.d.ts', 'zustand.d.ts']) copyFileSync(resolve(__dirname, '../fixtures/stubs', s), join(dir, s));
    writeFileSync(join(dir, 'axios-stub.d.ts'), `declare module 'axios' {
  interface Cfg { params?: unknown; signal?: AbortSignal; data?: unknown }
  interface Res<T> { data: T }
  const axios: { get<T = unknown>(u: string, c?: Cfg): Promise<Res<T>>; delete<T = unknown>(u: string, c?: Cfg): Promise<Res<T>>;
    post<T = unknown>(u: string, b?: unknown, c?: Cfg): Promise<Res<T>>; put<T = unknown>(u: string, b?: unknown, c?: Cfg): Promise<Res<T>>; patch<T = unknown>(u: string, b?: unknown, c?: Cfg): Promise<Res<T>> };
  export default axios;
}
`);
    writeFileSync(join(dir, 'zod-stub.d.ts'), `declare module 'zod' { export const z: any; export namespace z { type ZodTypeAny = any } }\n`);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noUnusedLocals: true, noEmit: true, skipLibCheck: true, lib: ['ES2022', 'DOM'] }, include: ['*.ts'] }));
    const tsc = resolve(__dirname, '../../../node_modules/typescript/bin/tsc');
    const r = spawnSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf8' });
    return r.stdout + r.stderr;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('I4 resolveUpstream', () => {
  it.each([
    ['/a', ' /entity ', '/entity/a'],
    ['/x', '//a//b//', '/a/b/x'],
    ['/periodic/x', 'periodic', '/periodic/x'],
    ['/periodic/x', '/periodic/', '/periodic/x'],
    ['/x', '', '/x'],
    ['/x', '   ', '/x'],
    ['//x///y', '/p', '/p/x/y'],
    ['/a/b/c', 'a//b', '/a/b/c'],
    ['/periodicity/x', 'periodic', '/periodic/periodicity/x'],
    ['/x', 'a b', '/ab/x'],
  ])('%s + %j -> %s', (path, prefix, expected) => {
    expect(resolveUpstream(path, prefix)).toBe(expected);
  });
});

describe('I3 cache TTL', () => {
  const cache = (ttl?: string) => emitGo('g', [ep({ goMode: 'cache', cacheTtl: ttl })], o).content;
  it.each([['5m', '5*time.Minute'], ['30s', '30*time.Second'], ['1h', '1*time.Hour'], ['500ms', '500*time.Millisecond']])('shorthand %s', (ttl, expr) => {
    const c = cache(ttl);
    expect(c).toContain(`router.HandleProxyWithCache("/a", "/api/a", ${expr})`);
    expect(c).toContain('import "time"');
    expect(c).not.toContain('CacheTTL');
  });
  it('raw Go expressions are passed through; time import only for time.', () => {
    expect(cache('5 * time.Minute')).toContain('HandleProxyWithCache("/a", "/api/a", 5 * time.Minute)');
    expect(cache('5 * time.Minute')).toContain('import "time"');
    const r = cache('runtime.X');
    expect(r).toContain('"/api/a", runtime.X)');
    expect(r).not.toContain('import "time"');
  });
  it('empty / whitespace-only -> CacheTTL', () => {
    for (const t of [undefined, '', '   ']) {
      const c = cache(t);
      expect(c).toContain('"/api/a", CacheTTL)');
      expect(c).not.toContain('import "time"');
    }
  });
});

describe('I6 string literals are escaped', () => {
  const group = `User's "x" \\ y`;
  const eps = [ep({ name: 'getA', group, response: str }), ep({ name: 'postA', method: 'post', path: '/b', group, body: str })];
  it('query keys use JSON.stringify and compile', () => {
    const files = plan(eps, { ...o, backend: 'none' });
    const q = files.find((f) => f.path.endsWith('.query.gen.ts'))!.content;
    expect(q).toContain(`queryKey: [${JSON.stringify(group)}, "getA"]`);
    expect(tscOutput(files)).toBe('');
  });
});

describe('M1 svc namespace + reserved locals', () => {
  const eps = [
    ep({ name: 'data', response: str }),
    ep({ name: 'create', method: 'post', path: '/c', body: str }),
    ep({ name: 'useQuery', path: '/u', response: str }),
    ep({ name: 'axios', path: '/x', response: str }),
    ep({ name: 'getOpts', path: '/o/{options}', pathParams: [pp('options')], response: str }),
    ep({ name: 'getD', path: '/d/{data}/{svc}', pathParams: [pp('data'), pp('svc')], response: str }),
    ep({ name: 'postV', method: 'post', path: '/v/{vars}/{options}', pathParams: [pp('vars'), pp('options')] }),
  ];
  it('query/store import the service as a namespace', () => {
    const files = plan(eps, { ...o, backend: 'none' });
    const q = files.find((f) => f.path === 'g.query.gen.ts')!.content;
    const s = files.find((f) => f.path === 'g.store.gen.ts')!.content;
    expect(q).toContain("import * as svc from './g.service.gen';");
    expect(q).toContain('svc.data(');
    expect(s).toContain("import * as svc from './g.service.gen';");
    expect(s).toContain('await svc.data(');
  });
  it('all compile under strict + noUnusedLocals', () => {
    expect(tscOutput(plan(eps, { ...o, backend: 'none' }))).toBe('');
  });
});

describe('M2 endpoint type names vs hoisted components', () => {
  const comp = { GetFooResponse: { type: 'object', properties: { self: { $ref: '#/components/schemas/GetFooResponse' } } } };
  const e = ep({ name: 'getFoo', path: '/f/{id}', pathParams: [pp('id')], response: { $ref: '#/components/schemas/GetFooResponse' }, queryParams: [qp('q')] });
  it('no duplicate exports; types stay consistent across files; compiles', () => {
    const files = plan([e], { ...o, backend: 'none' }, comp);
    const types = files.find((f) => f.path === 'g.types.gen.ts')!.content;
    const names = [...types.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    const zod = files.find((f) => f.path === 'g.zod.gen.ts')!.content;
    const znames = [...zod.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
    expect(new Set(znames).size).toBe(znames.length);
    expect(tscOutput(files)).toBe('');
  });
  it('endpoints whose type names collide get suffixed names (service + types + zod)', () => {
    const files = plan([e, ep({ name: 'GetFoo', path: '/g', response: str, queryParams: [qp('q')] })], { ...o, query: false, zustand: false, backend: 'none' }, comp);
    const types = files.find((f) => f.path === 'g.types.gen.ts')!.content;
    const names = [...types.matchAll(/^export (?:type|interface) (\w+)/gm)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(tscOutput(files)).toBe('');
  });
});

describe('M3/M4 group dedupe', () => {
  it('Go router funcs are unique after PascalCasing (1abc vs api1abc)', () => {
    const files = plan([ep({ name: 'a', group: '1abc' }), ep({ name: 'b', group: 'api1abc' })], { ...o, query: false, zod: false, zustand: false });
    const fns = files.filter((f) => f.kind === 'backend').map((f) => /func (\w+)Router/.exec(f.content)![1]);
    expect(new Set(fns).size).toBe(2);
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it('groupSlug is capped at 60 chars', () => {
    expect(groupSlug('L'.repeat(300))).toHaveLength(60);
  });
  it('300-char tags (also colliding after the cap) get distinct, short names', () => {
    const files = plan([ep({ name: 'a', group: 'L'.repeat(300) }), ep({ name: 'b', group: 'L'.repeat(299) + 'M' }), ep({ name: 'c', group: 'L'.repeat(80) })], o);
    const paths = files.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.length).toBeLessThanOrEqual(80);
    const fns = files.filter((f) => f.kind === 'backend').map((f) => /func (\w+)Router/.exec(f.content)![1]);
    expect(new Set(fns).size).toBe(3);
  });
});

describe('M6 DELETE with body', () => {
  it('sends data: body', () => {
    const e = ep({ name: 'del', method: 'delete', path: '/d', body: str, queryParams: [qp('q')] });
    const svc = emitFrontend('g', [e], { ...o, backend: 'none' })[0].content;
    expect(svc).toContain('axios.delete(`/d`, { data: body, params, signal })');
    const e2 = ep({ name: 'del2', method: 'delete', path: '/d2', body: str });
    expect(emitFrontend('g', [e2], { ...o, backend: 'none' })[0].content).toContain('axios.delete(`/d2`, { data: body, signal })');
    expect(tscOutput(plan([e, e2], { ...o, backend: 'none' }))).toBe('');
  });
});

describe('M7 SSE typed data and query params', () => {
  const sse = ep({ name: 'watch', path: '/w/{room}', isSse: true, pathParams: [pp('room')], queryParams: [qp('since'), qp('tags')], response: { type: 'object', properties: { n: { type: 'number' } } } });
  const sseReq = ep({ name: 'watchReq', path: '/wr', isSse: true, queryParams: [qp('token', true)] });
  const sseStr = ep({ name: 'watchStr', path: '/ws', isSse: true, response: str });
  it('emits typed subscribe with a serialized query string', () => {
    const c = emitFrontend('g', [sse, sseReq], { ...o, backend: 'none', zod: false })[0].content;
    expect(c).toContain('export function subscribeWatch(room: string, params: WatchParams | undefined, onMessage: (data: WatchResponse) => void, onError?: (e: Event) => void): () => void {');
    expect(c).toContain('URLSearchParams');
    expect(c).toContain('subscribeWatchReq(params: WatchReqParams, onMessage: (data: unknown) => void');
    expect(c).toContain('JSON.parse(ev.data) as WatchResponse');
  });
  it('compiles (with and without zod)', () => {
    expect(tscOutput(plan([sse, sseReq, sseStr], { ...o, backend: 'none', zod: false }))).toBe('');
    expect(tscOutput(plan([sse, sseReq, sseStr], { ...o, backend: 'none', zod: true }))).toBe('');
  });
});

describe('RESERVED_WORDS', () => {
  it('is exported and used by toIdent', () => {
    expect(RESERVED_WORDS).toContain('delete');
    for (const w of RESERVED_WORDS) expect(toIdent(w)).not.toBe(w);
  });
});

describe('unused: emitQuery/emitZustand still callable with 3 args', () => {
  it('works', () => {
    expect(emitQuery('g', [ep({})], o).path).toBe('g.query.gen.ts');
    expect(emitZustand('g', [ep({})], o).path).toBe('g.store.gen.ts');
  });
});
