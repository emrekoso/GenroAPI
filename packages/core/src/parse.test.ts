import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSpec, fetchSpec } from './parse.js';
import { toIdent, uniqueName } from './naming.js';

const load = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'));

describe('parseSpec', () => {
  it('v3 fixture yields GET /entity/platforms with name getPlatforms, group from tag', async () => {
    const { title, endpoints } = await parseSpec(load('v3.json'));
    expect(title).toBe('Plat API');
    const e = endpoints.find(x => x.id === 'get /entity/platforms')!;
    expect(e).toMatchObject({ method: 'get', path: '/entity/platforms', name: 'getPlatforms', group: 'Entity', enabled: true, goMode: 'proxy', isSse: false });
    expect(e.queryParams[0]).toMatchObject({ name: 'limit', ident: 'limit', required: false });
    expect(e.response).toMatchObject({ type: 'array' });
  });
  it('v2.json normalizes to same endpoints as v3', async () => {
    const a = await parseSpec(load('v3.json'));
    const b = await parseSpec(load('v2.json'));
    const key = (r: typeof a) => r.endpoints.map(e => [e.id, e.name, e.group, e.pathParams.map(p => p.ident), e.queryParams.map(p => p.name), !!e.body, !!e.response]);
    expect(key(b)).toEqual(key(a));
  });
  it('sse.json endpoint isSse && goMode===stream', async () => {
    const { endpoints } = await parseSpec(load('sse.json'));
    expect(endpoints[0].isSse && endpoints[0].goMode === 'stream').toBe(true);
  });
  it('untagged "/" path → group root', async () => {
    const { endpoints } = await parseSpec(load('untagged.json'));
    expect(endpoints.find(e => e.path === '/')!.group).toBe('root');
    expect(endpoints.find(e => e.path === '/health/check')!.group).toBe('health');
    expect(endpoints.find(e => e.path === '/health/check')!.name).toBe('getHealthCheck');
  });
  it('duplicate operationIds → getX, getX2', async () => {
    const { endpoints } = await parseSpec(load('untagged.json'));
    expect(endpoints.filter(e => e.path.startsWith('/dup')).map(e => e.name)).toEqual(['getX', 'getX2']);
  });
  it('{user-id} → ident userId', async () => {
    const { endpoints } = await parseSpec(load('v3.json'));
    const e = endpoints.find(x => x.method === 'post')!;
    expect(e.pathParams[0]).toMatchObject({ name: 'user-id', ident: 'userId', required: true });
    expect(toIdent('{user-id}')).toBe('userId');
    expect(e.body).toMatchObject({ type: 'object' });
  });
  it('204/no body → response undefined', async () => {
    const { endpoints } = await parseSpec(load('v3.json'));
    expect(endpoints.find(x => x.method === 'post')!.response).toBeUndefined();
  });
  it('circular.json resolves without hanging', async () => {
    const { endpoints } = await parseSpec(load('circular.json'));
    expect(JSON.stringify(endpoints[0].response)).toContain('#/components/schemas/Node');
  }, 2000);
  it('circular.json exposes circular components', async () => {
    const { components } = await parseSpec(load('circular.json'));
    expect(components).toEqual({ Node: { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } } });
  });
  it('uniqueName', () => {
    expect(uniqueName('a', new Set(['a', 'a2']))).toBe('a3');
  });
});

describe('reserved words', () => {
  it('toIdent guards reserved words', () => {
    expect(toIdent('class')).toBe('_class');
    expect(toIdent('{default}')).toBe('_default');
    expect(toIdent('delete')).toBe('_delete');
    expect(toIdent('new')).toBe('_new');
    expect(toIdent('let')).toBe('_let');
    expect(toIdent('user-id')).toBe('userId');
  });
  it('applies to param idents and endpoint names', async () => {
    const spec = { openapi: '3.0.0', info: { title: 'R', version: '1' }, paths: { '/a/{class}': { get: { operationId: 'delete',
      parameters: [{ name: 'class', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'ok' } } } } } };
    const { endpoints } = await parseSpec(spec);
    expect(endpoints[0].name).toBe('_delete');
    expect(endpoints[0].pathParams[0].ident).toBe('_class');
  });
});

describe('fetchSpec errors', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('names URL on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(fetchSpec('http://x/spec')).rejects.toThrow('Failed to fetch spec from http://x/spec: ECONNREFUSED');
  });
  it('names URL on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('bad'); } }));
    await expect(fetchSpec('http://x/spec')).rejects.toThrow('Spec at http://x/spec is not valid JSON');
  });
  it('names URL on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }));
    await expect(fetchSpec('http://x/spec')).rejects.toThrow('Failed to fetch spec from http://x/spec: 404 Not Found');
  });
});
