import type { Endpoint } from './model.js';

/** Route the generated Go proxy registers (and the frontend calls): `/<name>` + `{param}` segments from the spec path. */
export function frontendPath(e: Endpoint): string {
  const params = [...e.path.matchAll(/\{([^}]+)\}/g)].map((m) => `/{${m[1]}}`);
  return `/${e.name}${params.join('')}`;
}

/** Longest group slug; plan() appends a numeric suffix on collisions, so file names stay well under the server's 200-char limit. */
export const MAX_SLUG = 60;

/** File-name slug for a group: lowercase alphanumerics only (capped at MAX_SLUG), fallback `api`. */
export function groupSlug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, MAX_SLUG) || 'api';
}
