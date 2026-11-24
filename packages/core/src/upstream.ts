const segments = (s: string): string[] => s.split('/').filter(Boolean);

/**
 * Upstream path the Go proxy calls: `<prefix><specPath>`. The prefix is trimmed, whitespace-free and slash-normalised,
 * repeated slashes in the path are collapsed (a trailing slash is kept), and the prefix is not repeated when the spec
 * path already starts with it (on a segment boundary).
 */
export function resolveUpstream(specPath: string, prefix: string): string {
  const raw = specPath.trim();
  const path = segments(raw);
  const pre = segments(prefix.replace(/\s+/g, ''));
  const present = pre.length > 0 && pre.length <= path.length && pre.every((s, i) => path[i] === s);
  const joined = (present ? path : [...pre, ...path]).join('/');
  return '/' + joined + (joined && raw.endsWith('/') ? '/' : '');
}
