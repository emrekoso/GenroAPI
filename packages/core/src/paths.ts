import type { Endpoint } from './model.js';

/** Route the generated Go proxy registers (and the frontend calls): `/<name>` + `{param}` segments from the spec path. */
export function frontendPath(e: Endpoint): string {
  const params = [...e.path.matchAll(/\{([^}]+)\}/g)].map((m) => `/{${m[1]}}`);
  return `/${e.name}${params.join('')}`;
}

/** File-name slug for a group: lowercase alphanumerics only, fallback `api`. */
export function groupSlug(group: string): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'api';
}
