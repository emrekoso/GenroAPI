import SwaggerParser from '@apidevtools/swagger-parser';
import swagger2openapi from 'swagger2openapi';
import { parse as parseYaml } from 'yaml';
import type { Endpoint, JsonSchema, Method, Param } from './model.js';
import { toIdent, uniqueName } from './naming.js';

type Obj = Record<string, any>;
const METHODS: Method[] = ['get', 'post', 'put', 'patch', 'delete'];

export interface FetchOpts { timeoutMs?: number; maxBytes?: number }
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const shown = (u: string): string => (u.length > 120 ? `${u.slice(0, 117)}...` : u);

/** Fetch an http(s) spec as JSON: 30 s timeout and 20 MB body cap by default (checked up front and while streaming). */
export async function fetchSpec(url: string, opts: FetchOpts = {}): Promise<object> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const where = shown(url);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid spec URL ${where}: expected an http:// or https:// URL`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" in ${where}: only http:// and https:// spec URLs are allowed`);
  const fail = (why: string): Error => new Error(`Failed to fetch spec from ${where}: ${why}`);
  const timedOut = (e: unknown): boolean => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
  const tooLarge = (): Error => fail(`response too large (limit ${maxBytes} bytes)`);

  let text: string;
  let ctype = '';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw fail(`${res.status} ${res.statusText}`);
    ctype = (res.headers?.get('content-type') ?? '').toLowerCase();
    const len = Number(res.headers?.get('content-length'));
    if (Number.isFinite(len) && len > maxBytes) throw tooLarge();
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel().catch(() => {}); throw tooLarge(); }
        chunks.push(value);
      }
      text = Buffer.concat(chunks).toString('utf8');
    } else {
      text = await res.text();
      if (Buffer.byteLength(text) > maxBytes) throw tooLarge();
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Failed to fetch spec from ')) throw e;
    if (timedOut(e)) throw fail(`timed out after ${timeoutMs} ms`);
    throw fail(e instanceof Error ? e.message : String(e));
  }
  return parseBody(text, ctype, url, where);
}

const HTML_HINT = 'If this is a Swagger UI page, use the spec URL it loads (e.g. /openapi.json, /openapi.yaml, /swagger/doc.json, /v3/api-docs).';

/** Best-effort: a spec reference inside a Swagger UI / Redoc / RapiDoc page, resolved against the page URL (suggested only, never fetched). */
function discoverSpecUrl(html: string, pageUrl: string): string | undefined {
  const m = /\bspec-url\s*=\s*["']([^"']+)["']/i.exec(html) ?? /["']?\burl["']?\s*:\s*["']([^"']+)["']/.exec(html);
  if (!m) return undefined;
  try {
    const u = new URL(m[1], pageUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch { return undefined; }
}

function parseBody(text: string, ctype: string, url: string, where: string): object {
  const body = text.replace(/^\uFEFF/, '').trim();
  if (ctype.includes('text/html') || /^<!doctype\s+html|^<html[\s>]/i.test(body)) {
    const guess = discoverSpecUrl(body, url);
    throw new Error(`Got an HTML page from ${where}, not an OpenAPI document. ${HTML_HINT}${guess ? ` Found a possible spec URL: ${guess}` : ''}`);
  }
  let value: unknown;
  const looksJson = body.startsWith('{') || body.startsWith('[');
  if (looksJson && !ctype.includes('yaml')) {
    try { value = JSON.parse(body); } catch { /* fall through to YAML (JSON is mostly valid YAML; its error is clearer) */ }
  }
  if (value === undefined) {
    try {
      // yaml v2 core schema: no custom tags, no code execution; alias expansion is bounded.
      value = parseYaml(body, { maxAliasCount: 100 });
    } catch (e) {
      throw new Error(`Spec at ${where} is not valid JSON or YAML: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Spec at ${where} is not valid JSON or YAML describing an object (got ${Array.isArray(value) ? 'a list' : value === null ? 'nothing' : typeof value})`);
  return value as object;
}

function lookup(root: Obj, ref: string): any {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').reduce((o: any, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

// Inline $refs except circular ones, which stay as {"$ref": ...}.
function resolve(node: any, root: Obj, stack: string[] = [], circ?: Set<string>): any {
  if (Array.isArray(node)) return node.map(n => resolve(n, root, stack, circ));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    if (stack.includes(node.$ref)) { circ?.add(node.$ref); return { $ref: node.$ref }; }
    const target = lookup(root, node.$ref);
    if (target === undefined) return { $ref: node.$ref };
    return resolve(target, root, [...stack, node.$ref], circ);
  }
  const out: Obj = {};
  for (const [k, v] of Object.entries(node)) out[k] = resolve(v, root, stack, circ);
  return out;
}

function pathName(method: string, path: string): string {
  const segs = path.split('/').filter(Boolean).map(s => {
    const m = /^\{(.+)\}$/.exec(s);
    const id = toIdent(m ? m[1] : s);
    const cap = id.charAt(0).toUpperCase() + id.slice(1);
    return m ? 'By' + cap : cap;
  });
  return method + segs.join('');
}

export async function parseSpec(spec: object): Promise<{ title: string; endpoints: Endpoint[]; components: Record<string, JsonSchema> }> {
  let doc = structuredClone(spec) as Obj;
  if (!doc || (!doc.openapi && !doc.swagger)) throw new Error('Not an OpenAPI/Swagger document (missing "openapi" or "swagger" field)');
  if (doc.swagger) doc = (await swagger2openapi.convertObj(doc as any, { patch: true, warnOnly: true })).openapi as Obj;
  // External $refs (local files, URLs) are never resolved: the spec URL is untrusted input.
  try { doc = (await SwaggerParser.bundle(doc as any, { resolve: { file: false, http: false } } as any)) as unknown as Obj; }
  catch (e) { throw new Error(`Cannot process spec: ${e instanceof Error ? e.message : String(e)} (external file/URL $refs are not resolved; inline them or use internal #/ refs)`); }

  const circ = new Set<string>();
  const endpoints: Endpoint[] = [];
  const taken = new Set<string>();
  for (const [path, rawItem] of Object.entries<Obj>(doc.paths ?? {})) {
    const item = resolve(rawItem, doc, [], circ);
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const params: Obj[] = [...(item.parameters ?? []), ...(op.parameters ?? [])];
      const toParam = (p: Obj): Param => ({ name: p.name, ident: toIdent(p.name), required: p.in === 'path' ? true : !!p.required, schema: (p.schema ?? {}) as JsonSchema });
      const pathParams = params.filter(p => p.in === 'path').map(toParam);
      const queryParams = params.filter(p => p.in === 'query').map(toParam);

      const body: JsonSchema | undefined = op.requestBody?.content?.['application/json']?.schema;

      let response: JsonSchema | undefined;
      let isSse = false;
      const codes = Object.keys(op.responses ?? {}).filter(c => /^2/.test(c)).sort();
      for (const c of codes) {
        const content = op.responses[c]?.content ?? {};
        if (content['text/event-stream']) { isSse = true; response = content['text/event-stream'].itemSchema ?? content['text/event-stream'].schema; break; }
        if (!response && content['application/json']?.schema) response = content['application/json'].schema;
      }

      const base = op.operationId ? toIdent(op.operationId) : pathName(method, path);
      const name = uniqueName(base, taken);
      taken.add(name);
      const firstSeg = path.split('/').filter(Boolean)[0];
      const group = op.tags?.[0] ?? (firstSeg ? toIdent(firstSeg) : 'root');

      endpoints.push({ id: `${method} ${path}`, method, path, name, group, summary: op.summary, pathParams, queryParams, body, response, isSse, goMode: isSse ? 'stream' : 'proxy', enabled: true });
    }
  }
  // Circular component schemas stay as $ref in endpoints; expose them by name (nested circular refs stay $ref).
  const components: Record<string, JsonSchema> = {};
  const done = new Set<string>();
  for (let todo = [...circ]; todo.length; todo = [...circ].filter(r => !done.has(r))) {
    for (const ref of todo) {
      done.add(ref);
      components[ref.split('/').pop()!] = resolve(lookup(doc, ref), doc, [ref], circ) as JsonSchema;
    }
  }
  return { title: doc.info?.title ?? 'API', endpoints, components };
}
