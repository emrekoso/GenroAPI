import type { JsonSchema } from './model.js';
import { toIdent } from './naming.js';

type Lit = string | number | boolean | null;
export type Node =
  | { k: 'unknown'; comment?: string }
  | { k: 'prim'; t: 'string' | 'number' | 'boolean' | 'null' }
  | { k: 'enum'; vals: Lit[] }
  | { k: 'array'; item: Node }
  | { k: 'object'; props: { key: string; node: Node; req: boolean }[]; extra?: Node }
  | { k: 'union'; items: Node[] }
  | { k: 'inter'; items: Node[] }
  | { k: 'nullable'; inner: Node }
  | { k: 'ref'; name: string };

type S = Record<string, any>;

/** Named component schemas: `known` are ref names that resolve to hoisted types; `used` collects the ones referenced. */
export interface Ctx { known: Set<string>; used: Set<string> }

const safe = (s: string): string => s.replace(/\*\//g, '* /');

export function refName(ref: string): string {
  const id = toIdent(ref.split('/').pop() ?? '');
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Shared JSON-Schema walker used by both the TS and Zod emitters.
 * `self` is the name of the type being defined: a `$ref` to it is a circular
 * reference (the parser keeps those as `$ref`). Any other `$ref` cannot be
 * resolved (component schemas are not exposed by parseSpec) and becomes `unknown`.
 */
export function walk(s: JsonSchema | undefined, self?: string, ctx?: Ctx): Node {
  if (!s || typeof s !== 'object') return { k: 'unknown' };
  const x = s as S;
  if (typeof x.$ref === 'string') {
    const name = refName(x.$ref);
    if (ctx?.known.has(name)) { ctx.used.add(name); return { k: 'ref', name }; }
    return name === self ? { k: 'ref', name } : { k: 'unknown', comment: `TODO: unresolved $ref ${safe(name)}` };
  }
  let nullable = x.nullable === true;
  let types: string[] = Array.isArray(x.type) ? x.type : x.type ? [x.type] : [];
  if (types.includes('null') && types.length > 1) { nullable = true; types = types.filter((t) => t !== 'null'); }
  const wrap = (n: Node): Node => (nullable ? { k: 'nullable', inner: n } : n);

  if (Array.isArray(x.enum) && x.enum.length) return wrap({ k: 'enum', vals: x.enum as Lit[] });
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(x[key]) && x[key].length) {
      const items = x[key].map((i: S) => walk(i, self, ctx));
      return wrap(items.length === 1 ? items[0] : { k: 'union', items });
    }
  }
  if (Array.isArray(x.allOf) && x.allOf.length) {
    const items = x.allOf.map((i: S) => walk(i, self, ctx));
    return wrap(items.length === 1 ? items[0] : { k: 'inter', items });
  }
  if (types.length > 1) return wrap({ k: 'union', items: types.map((t) => walk({ ...x, type: t, nullable: false }, self, ctx)) });

  const t = types[0] ?? (x.properties ? 'object' : x.items ? 'array' : undefined);
  switch (t) {
    case 'string': return wrap({ k: 'prim', t: 'string' });
    case 'number':
    case 'integer': return wrap({ k: 'prim', t: 'number' });
    case 'boolean': return wrap({ k: 'prim', t: 'boolean' });
    case 'null': return { k: 'prim', t: 'null' };
    case 'array': return wrap({ k: 'array', item: walk(x.items, self, ctx) });
    case 'object': {
      const required = new Set<string>(Array.isArray(x.required) ? x.required : []);
      const props = Object.entries<S>(x.properties ?? {}).map(([key, v]) => ({ key, node: walk(v, self, ctx), req: required.has(key) }));
      let extra: Node | undefined;
      if (x.additionalProperties && typeof x.additionalProperties === 'object') extra = walk(x.additionalProperties, self, ctx);
      else if (x.additionalProperties === true || (!props.length && x.additionalProperties !== false)) extra = { k: 'unknown' };
      return wrap({ k: 'object', props, extra });
    }
    case undefined: return { k: 'unknown' };
    default: return { k: 'unknown', comment: `unsupported type ${safe(JSON.stringify(t))}` };
  }
}

export function hasRef(n: Node): boolean {
  switch (n.k) {
    case 'ref': return true;
    case 'array': return hasRef(n.item);
    case 'nullable': return hasRef(n.inner);
    case 'union': case 'inter': return n.items.some(hasRef);
    case 'object': return n.props.some((p) => hasRef(p.node)) || (!!n.extra && hasRef(n.extra));
    default: return false;
  }
}

export const propKey = (k: string): string => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));
export const lit = (v: Lit): string => JSON.stringify(v);
