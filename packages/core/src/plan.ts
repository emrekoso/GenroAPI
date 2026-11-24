import type { Endpoint, GenOptions, GeneratedFile, JsonSchema } from './model.js';
import { groupSlug } from './paths.js';
import { emitFrontend } from './emit-axios.js';
import { emitQuery } from './emit-query.js';
import { emitZustand } from './emit-zustand.js';
import { emitGo } from './go.js';

/** Group enabled endpoints, run every enabled emitter, return all files sorted by path. */
export function plan(eps: Endpoint[], o: GenOptions, components: Record<string, JsonSchema> = {}): GeneratedFile[] {
  const groups = new Map<string, Endpoint[]>();
  for (const e of eps) {
    if (!e.enabled) continue;
    const list = groups.get(e.group);
    if (list) list.push(e); else groups.set(e.group, [e]);
  }
  const takenSlugs = new Set<string>();
  const files: GeneratedFile[] = [];
  for (const name of [...groups.keys()].sort()) {
    // Distinct groups sharing a slug get a numeric suffix so file and Go func names never clash.
    let key = name;
    for (let i = 2; takenSlugs.has(groupSlug(key)); i++) key = `${name}${i}`;
    takenSlugs.add(groupSlug(key));
    const g = groups.get(name)!;
    files.push(...emitFrontend(key, g, o, components));
    if (o.query) files.push(emitQuery(key, g, o));
    if (o.zustand) files.push(emitZustand(key, g, o));
    if (o.backend === 'go') files.push(emitGo(key, g, o));
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
