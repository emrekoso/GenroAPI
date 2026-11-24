import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), text: async () => 'not json' }));
    await expect(fetchSpec('http://x/spec')).rejects.toThrow('Spec at http://x/spec is not valid JSON');
  });
  it('names URL on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }));
    await expect(fetchSpec('http://x/spec')).rejects.toThrow('Failed to fetch spec from http://x/spec: 404 Not Found');
  });
});

describe('M7 SSE schema is kept', () => {
  const spec = (content: object) => ({ openapi: '3.0.0', info: { title: 'S', version: '1' }, paths: { '/e': { get: { operationId: 'ev', responses: { 200: { description: 'ok', content } } } } } });
  it('response is the text/event-stream schema, or undefined when absent', async () => {
    const a = await parseSpec(spec({ 'text/event-stream': { schema: { type: 'object', properties: { n: { type: 'number' } } } } }));
    expect(a.endpoints[0]).toMatchObject({ isSse: true, goMode: 'stream', response: { type: 'object' } });
    const b = await parseSpec(spec({ 'text/event-stream': { itemSchema: { type: 'integer' } } }));
    expect(b.endpoints[0].response).toEqual({ type: 'integer' });
    const c = await parseSpec(spec({ 'text/event-stream': {} }));
    expect(c.endpoints[0]).toMatchObject({ isSse: true, response: undefined });
  });
});

describe('M8 external $refs are not resolved', () => {
  it('local file refs (absolute path and file://) never leak into the output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genroapi-sec-'));
    const secret = join(dir, 'secret.json');
    writeFileSync(secret, JSON.stringify({ type: 'object', description: 'TOP_SECRET_MARKER_42', properties: { leaked: { type: 'string' } } }));
    try {
      for (const ref of [secret, pathToFileURL(secret).href, `${pathToFileURL(secret).href}#/properties`, './secret.json']) {
        const spec = { openapi: '3.0.0', info: { title: 'X', version: '1' }, paths: { '/x': { get: { operationId: 'x', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: ref } } } } } } } } };
        let out = '';
        try { out = JSON.stringify(await parseSpec(spec)); } catch (e) { out = String((e as Error).message); }
        expect(out, ref).not.toContain('TOP_SECRET_MARKER_42');
        expect(out, ref).not.toContain('leaked');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('an unresolvable external ref is a clear error, not a crash or a read', async () => {
    const spec = { openapi: '3.0.0', info: { title: 'X', version: '1' }, paths: { '/x': { get: { operationId: 'x', responses: { 200: { description: 'ok', content: { 'application/json': { schema: { $ref: 'file:///definitely/not/here.json' } } } } } } } } };
    await expect(parseSpec(spec)).rejects.toThrow(/external file\/URL \$refs are not resolved/);
  });
});

describe('M9 fetchSpec limits', () => {
  let srv: http.Server | undefined;
  afterEach(() => { srv?.closeAllConnections(); srv?.close(); srv = undefined; });
  const listen = async (h: http.RequestListener) => {
    srv = http.createServer(h);
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(srv.address() as any).port}/spec.json`;
  };
  it('times out with a clear error naming the URL', async () => {
    const url = await listen(() => { /* never answers */ });
    await expect(fetchSpec(url, { timeoutMs: 150 })).rejects.toThrow(new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*timed out`));
  });
  it('rejects an oversize body via content-length', async () => {
    const url = await listen((_q, s) => { s.setHeader('content-type', 'application/json'); s.setHeader('content-length', '5000'); s.end('x'.repeat(5000)); });
    await expect(fetchSpec(url, { maxBytes: 1000 })).rejects.toThrow(/too large.*1000/);
  });
  it('rejects an oversize chunked body while streaming', async () => {
    const url = await listen((_q, s) => { s.setHeader('content-type', 'application/json'); s.write('['); for (let i = 0; i < 50; i++) s.write('"' + 'y'.repeat(100) + '",'); s.end('1]'); });
    await expect(fetchSpec(url, { maxBytes: 1000 })).rejects.toThrow(/too large/);
  });
  it('still parses a normal body', async () => {
    const url = await listen((_q, s) => { s.end('{"a":1}'); });
    expect(await fetchSpec(url)).toEqual({ a: 1 });
  });
  it.each(['data:application/json,{}', 'file:///etc/passwd', 'ftp://x/y', 'not a url'])('rejects %s', async (u) => {
    await expect(fetchSpec(u)).rejects.toThrow(/http|URL/);
  });
});

describe('Y1 YAML specs and HTML pages', () => {
  let srv: http.Server | undefined;
  afterEach(() => { srv?.closeAllConnections(); srv?.close(); srv = undefined; });
  const serve = async (body: string, type: string) => {
    srv = http.createServer((_q, s) => { s.setHeader('content-type', type); s.end(body); });
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(srv.address() as any).port}/swagger/`;
  };
  const YAML3 = `openapi: 3.0.3
info: {title: Yaml API, version: "1"}
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
    Pet:
      type: object
      properties:
        name: {type: string}
`;
  const YAML2 = `swagger: "2.0"
info: {title: Old Yaml, version: "1"}
paths:
  /things:
    get:
      operationId: getThings
      produces: [application/json]
      responses:
        "200": {description: ok, schema: {type: array, items: {type: string}}}
`;
  it.each([['application/yaml'], ['text/plain'], ['application/octet-stream']])('parses an OpenAPI 3 YAML document (%s) incl. $ref', async (type) => {
    const url = await serve(YAML3, type);
    const r = await parseSpec(await fetchSpec(url));
    expect(r.title).toBe('Yaml API');
    expect(r.endpoints[0]).toMatchObject({ name: 'getPet', group: 'pets', response: { type: 'object', properties: { name: { type: 'string' } } } });
  });
  it('parses a Swagger 2.0 YAML document', async () => {
    const url = await serve(YAML2, 'application/x-yaml');
    const r = await parseSpec(await fetchSpec(url));
    expect(r.endpoints.map((e) => e.name)).toEqual(['getThings']);
    expect(r.endpoints[0].response).toMatchObject({ type: 'array' });
  });
  it('JSON still works, including JSON served as text/yaml', async () => {
    expect(await fetchSpec(await serve('{"a":1}', 'application/json'))).toEqual({ a: 1 });
    srv!.close();
    expect(await fetchSpec(await serve('{"a":1}', 'text/yaml'))).toEqual({ a: 1 });
  });
  it('HTML page -> clear error naming the URL, no spec guess when none is discoverable', async () => {
    const url = await serve('  <!DOCTYPE html>\n<html><body>hi</body></html>', 'text/html');
    const err = (await fetchSpec(url).catch((e) => e)) as Error;
    expect(err.message).toBe(`Got an HTML page from ${url}, not an OpenAPI document. If this is a Swagger UI page, use the spec URL it loads (e.g. /openapi.json, /openapi.yaml, /swagger/doc.json, /v3/api-docs).`);
  });
  it.each([
    [`SwaggerUIBundle({ url: '../openapi.yaml', dom_id: '#x' })`, '/openapi.yaml'],
    [`SwaggerUIBundle({ "url": "/v3/api-docs" })`, '/v3/api-docs'],
    [`<redoc spec-url="spec.json"></redoc>`, '/swagger/spec.json'],
    [`<rapi-doc spec-url='https://other.example/o.yaml'></rapi-doc>`, 'https://other.example/o.yaml'],
  ])('HTML page suggests a discovered spec URL (%s)', async (snippet, expected) => {
    const url = await serve(`<html><script>${snippet}</script></html>`, 'text/html; charset=utf-8');
    const err = (await fetchSpec(url).catch((e) => e)) as Error;
    const abs = new URL(expected, url).href;
    expect(err.message).toContain(`Got an HTML page from ${url}`);
    expect(err.message).toMatch(new RegExp(`Found a possible spec URL: ${abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  });
  it('invalid YAML names the URL; non-object results are errors', async () => {
    const url = await serve('openapi: 3.0.0\npaths: [unclosed\n  - x: : :', 'application/yaml');
    await expect(fetchSpec(url)).rejects.toThrow(new RegExp(`Spec at ${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not valid JSON or YAML`));
    srv!.close();
    const url2 = await serve('just a string', 'application/yaml');
    await expect(fetchSpec(url2)).rejects.toThrow(/not valid JSON or YAML.*object/);
  });
  it('YAML alias bombs are refused', async () => {
    const many = 'a: &a x\nb: [' + Array(2000).fill('*a').join(',') + ']';
    await expect(fetchSpec(await serve(many, 'application/yaml'))).rejects.toThrow(/not valid JSON or YAML/);
  });
});
