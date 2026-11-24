import SwaggerParser from '@apidevtools/swagger-parser';
import swagger2openapi from 'swagger2openapi';
import type { Endpoint, JsonSchema, Method, Param } from './model.js';
import { toIdent, uniqueName } from './naming.js';

type Obj = Record<string, any>;
const METHODS: Method[] = ['get', 'post', 'put', 'patch', 'delete'];

export async function fetchSpec(url: string): Promise<object> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Failed to fetch spec from ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`Failed to fetch spec from ${url}: ${res.status} ${res.statusText}`);
  try {
    return (await res.json()) as object;
  } catch (e) {
    throw new Error(`Spec at ${url} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function lookup(root: Obj, ref: string): any {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').reduce((o: any, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
}

// Inline $refs except circular ones, which stay as {"$ref": ...}.
function resolve(node: any, root: Obj, stack: string[] = []): any {
  if (Array.isArray(node)) return node.map(n => resolve(n, root, stack));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    if (stack.includes(node.$ref)) return { $ref: node.$ref };
    const target = lookup(root, node.$ref);
    if (target === undefined) return { $ref: node.$ref };
    return resolve(target, root, [...stack, node.$ref]);
  }
  const out: Obj = {};
  for (const [k, v] of Object.entries(node)) out[k] = resolve(v, root, stack);
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

export async function parseSpec(spec: object): Promise<{ title: string; endpoints: Endpoint[] }> {
  let doc = structuredClone(spec) as Obj;
  if (doc.swagger) doc = (await swagger2openapi.convertObj(doc as any, { patch: true, warnOnly: true })).openapi as Obj;
  doc = (await SwaggerParser.bundle(doc as any)) as Obj;

  const endpoints: Endpoint[] = [];
  const taken = new Set<string>();
  for (const [path, rawItem] of Object.entries<Obj>(doc.paths ?? {})) {
    const item = resolve(rawItem, doc);
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
        if (content['text/event-stream']) { isSse = true; break; }
        if (!response && content['application/json']?.schema) response = content['application/json'].schema;
      }
      if (isSse) response = undefined;

      const base = op.operationId ? toIdent(op.operationId) : pathName(method, path);
      const name = uniqueName(base, taken);
      taken.add(name);
      const firstSeg = path.split('/').filter(Boolean)[0];
      const group = op.tags?.[0] ?? (firstSeg ? toIdent(firstSeg) : 'root');

      endpoints.push({ id: `${method} ${path}`, method, path, name, group, summary: op.summary, pathParams, queryParams, body, response, isSse, goMode: isSse ? 'stream' : 'proxy', enabled: true });
    }
  }
  return { title: doc.info?.title ?? 'API', endpoints };
}
