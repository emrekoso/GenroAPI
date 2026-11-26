import type { Endpoint, GenOptions } from '@genroapi/core';
// Deep import: the package root pulls in Node-only parser code that must not be bundled into the UI.
import { groupSlug } from '@genroapi/core/src/paths';
import { groupNames, normalizeGroups } from './groups';

/** One colour per group; they cycle when a spec has more than four groups. */
export const PALETTE = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)'];

export interface FileKind { kind: 'types' | 'service' | 'zod' | 'query' | 'store' | 'go'; file: string; lang: 'ts' | 'go'; desc: string }
export interface GroupStack { group: string; slug: string; colour: string; count: number; files: FileKind[] }

export interface GroupModel {
  /** Endpoints with canonical group names, in the same order as the input. */
  norm: Endpoint[];
  stacks: GroupStack[];
  colourOfGroup(g: string): string;
  /** Colour for a generated file path (`<slug>.<kind>.gen.ts`), or undefined when no group matches. */
  colourOfPath(path: string): string | undefined;
  /** Group of an endpoint id (canonical name). */
  groupOf: Map<string, string>;
}

/** The files each group produces for the current options (names follow the README table). */
export function filesFor(slug: string, o: Pick<GenOptions, 'query' | 'zod' | 'zustand' | 'backend'>): FileKind[] {
  const out: FileKind[] = [
    { kind: 'types', file: `${slug}.types.gen.ts`, lang: 'ts', desc: 'The shape of every request and response' },
    { kind: 'service', file: `${slug}.service.gen.ts`, lang: 'ts', desc: 'Functions that call your API' },
  ];
  if (o.zod) out.push({ kind: 'zod', file: `${slug}.zod.gen.ts`, lang: 'ts', desc: 'Checks that incoming data has the right shape' });
  if (o.query) out.push({ kind: 'query', file: `${slug}.query.gen.ts`, lang: 'ts', desc: 'React hooks that fetch and cache data' });
  if (o.zustand) out.push({ kind: 'store', file: `${slug}.store.gen.ts`, lang: 'ts', desc: 'A store with data, loading and error state' });
  if (o.backend === 'go') out.push({ kind: 'go', file: `${slug}.gen.go`, lang: 'go', desc: 'Go routes that forward calls to your server' });
  return out;
}

export function groupModel(endpoints: Endpoint[], o: Pick<GenOptions, 'query' | 'zod' | 'zustand' | 'backend'>): GroupModel {
  const norm = normalizeGroups(endpoints);
  const names = groupNames(endpoints);
  const colourOfGroup = (g: string) => PALETTE[Math.max(0, names.indexOf(g)) % PALETTE.length];
  const groupOf = new Map(norm.map(e => [e.id, e.group]));
  const stacks = names
    .map(group => ({ group, count: norm.filter(e => e.enabled && e.group === group).length }))
    .filter(g => g.count > 0)
    .map(({ group, count }) => {
      const slug = groupSlug(group);
      return { group, slug, colour: colourOfGroup(group), count, files: filesFor(slug, o) };
    });
  const colourOfPath = (path: string) => stacks.find(s => path.startsWith(`${s.slug}.`))?.colour;
  return { norm, stacks, colourOfGroup, colourOfPath, groupOf };
}
