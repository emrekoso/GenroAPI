export interface ResolvedDir { path: string; warning?: string }

const isWindows = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
const isAbsolute = (p: string, win: boolean) => (win ? /^([A-Za-z]:[\\/]|\\\\|[\\/])/.test(p) : p.startsWith('/'));

/**
 * Mirrors how the server resolves an output dir (`path.resolve(cwd, dir)`), so the UI can show where files will land.
 * Returns undefined for an empty value. `~` is not expanded by the server, so it is reported as a warning.
 */
export function resolveOutDir(cwd: string, dir: string): ResolvedDir | undefined {
  const raw = dir.trim();
  if (raw === '') return undefined;
  const win = isWindows(cwd) || isWindows(raw);
  const sep = win ? '\\' : '/';
  const split = (p: string) => p.split(win ? /[\\/]+/ : /\/+/).filter(Boolean);

  let root: string;
  let parts: string[];
  if (isAbsolute(raw, win)) {
    const m = win ? /^([A-Za-z]:|\\\\[^\\/]+[\\/][^\\/]+)?/.exec(raw) : null;
    root = win ? (m?.[1] ?? '') + sep : '/';
    parts = split(win && m?.[1] ? raw.slice(m[1].length) : raw);
  } else {
    const m = win ? /^([A-Za-z]:|\\\\[^\\/]+[\\/][^\\/]+)?/.exec(cwd) : null;
    root = win ? (m?.[1] ?? '') + sep : '/';
    parts = [...split(win && m?.[1] ? cwd.slice(m[1].length) : cwd), ...split(raw)];
  }
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  const path = root + out.join(sep);
  const warning = raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')
    ? "'~' is not expanded. Use an absolute path such as /Users/you/out." : undefined;
  return warning ? { path, warning } : { path };
}
