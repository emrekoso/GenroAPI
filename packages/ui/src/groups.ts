import type { Endpoint } from '@genroapi/core';

const collapse = (g: string) => g.trim().replace(/\s+/g, ' ');

/**
 * Canonical group names for generation: whitespace is trimmed and collapsed, and spellings that differ only in case
 * are merged into the first one seen (otherwise "Pets" and "pets" would become two files with clashing names).
 * Done when sending, not while typing, so users can still type spaces.
 */
export function normalizeGroups(endpoints: Endpoint[]): Endpoint[] {
  const canon = new Map<string, string>();
  return endpoints.map(e => {
    const g = collapse(e.group);
    if (g === '') return { ...e, group: '' };
    const key = g.toLowerCase();
    if (!canon.has(key)) canon.set(key, g);
    return { ...e, group: canon.get(key)! };
  });
}

/** Every enabled endpoint needs a group; disabled ones are ignored. */
export function groupErrors(endpoints: Endpoint[]): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const e of endpoints) if (e.enabled && collapse(e.group) === '') errs[e.id] = 'Group is required';
  return errs;
}

/** Distinct normalised group names (for suggestions), sorted. */
export function groupNames(endpoints: Endpoint[]): string[] {
  return [...new Set(normalizeGroups(endpoints).map(e => e.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
