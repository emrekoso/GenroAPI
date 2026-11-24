export function resolveUpstream(specPath: string, prefix: string): string {
  const p = '/' + specPath.replace(/^\/+/, '');
  const pre = prefix.replace(/^\/+|\/+$/g, '');
  if (!pre) return p;
  const full = '/' + pre;
  if (p === full || p.startsWith(full + '/')) return p;
  return full + p;
}
