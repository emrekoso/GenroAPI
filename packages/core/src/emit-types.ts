import type { JsonSchema } from './model.js';
import { walk, propKey, lit, type Node } from './schema.js';

const pad = (d: number): string => '  '.repeat(d);

export function renderTs(n: Node, d = 0): string {
  switch (n.k) {
    case 'unknown': return n.comment ? `unknown /* ${n.comment} */` : 'unknown';
    case 'prim': return n.t;
    case 'enum': return n.vals.map(lit).join(' | ');
    case 'ref': return n.name;
    case 'array': return `Array<${renderTs(n.item, d)}>`;
    case 'nullable': {
      const inner = renderTs(n.inner, d);
      return `${n.inner.k === 'inter' ? `(${inner})` : inner} | null`;
    }
    case 'union': return n.items.map((i) => renderTs(i, d)).join(' | ');
    case 'inter': return n.items.map((i) => (i.k === 'union' || i.k === 'nullable' || i.k === 'enum' ? `(${renderTs(i, d)})` : renderTs(i, d))).join(' & ');
    case 'object': {
      const rec = n.extra ? `Record<string, ${renderTs(n.extra, d)}>` : '';
      if (!n.props.length) return rec || 'Record<string, never>';
      const body = n.props.map((p) => `${pad(d + 1)}${propKey(p.key)}${p.req ? '' : '?'}: ${renderTs(p.node, d + 1)};`).join('\n');
      const obj = `{\n${body}\n${pad(d)}}`;
      return rec ? `${obj} & ${rec}` : obj;
    }
  }
}

export function schemaToTs(s: JsonSchema, name: string): string {
  return `export type ${name} = ${renderTs(walk(s, name))};`;
}
