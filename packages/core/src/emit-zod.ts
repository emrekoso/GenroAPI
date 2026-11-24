import type { JsonSchema } from './model.js';
import { walk, hasRef, propKey, lit, type Node, type Ctx } from './schema.js';

const pad = (d: number): string => '  '.repeat(d);

export function renderZod(n: Node, d = 0): string {
  switch (n.k) {
    case 'unknown': return n.comment ? `z.unknown() /* ${n.comment} */` : 'z.unknown()';
    case 'prim': return `z.${n.t}()`;
    case 'enum':
      if (n.vals.every((v) => typeof v === 'string')) return `z.enum([${n.vals.map(lit).join(', ')}])`;
      return n.vals.length === 1 ? `z.literal(${lit(n.vals[0])})` : `z.union([${n.vals.map((v) => `z.literal(${lit(v)})`).join(', ')}])`;
    case 'ref': return `z.lazy(() => ${n.name}Schema)`;
    case 'array': return `z.array(${renderZod(n.item, d)})`;
    case 'nullable': return `${renderZod(n.inner, d)}.nullable()`;
    case 'union': return `z.union([${n.items.map((i) => renderZod(i, d)).join(', ')}])`;
    case 'inter': return n.items.slice(1).reduce((acc, i) => `z.intersection(${acc}, ${renderZod(i, d)})`, renderZod(n.items[0], d));
    case 'object': {
      if (!n.props.length) return `z.record(z.string(), ${n.extra ? renderZod(n.extra, d) : 'z.unknown()'})`;
      const body = n.props.map((p) => `${pad(d + 1)}${propKey(p.key)}: ${renderZod(p.node, d + 1)}${p.req ? '' : '.optional()'},`).join('\n');
      return `z.object({\n${body}\n${pad(d)}})${n.extra ? `.catchall(${renderZod(n.extra, d)})` : ''}`;
    }
  }
}

/** Emits `export const <name>Schema = ...;` (annotated with ZodTypeAny when it is self-referential). */
export function schemaToZod(s: JsonSchema, name: string, ctx?: Ctx, lazy = false): string {
  const node = walk(s, name, ctx);
  const z = renderZod(node);
  return `export const ${name}Schema${hasRef(node) || lazy ? ': z.ZodTypeAny' : ''} = ${lazy ? `z.lazy(() => ${z})` : z};`;
}
