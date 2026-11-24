import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { inside } from './writer.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticFile { body: Buffer; type: string; cache: string }

/**
 * Resolve a raw request URL to a file inside `uiDir`, or null (-> 404).
 * Decodes once; refuses `.`/`..`/empty/dot-prefixed segments, NUL, backslashes, and anything whose realpath leaves uiDir.
 */
export async function loadStatic(uiDirReal: string, rawUrl: string): Promise<StaticFile | null> {
  const q = rawUrl.search(/[?#]/);
  const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { return null; }
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\\')) return null;
  if (path === '/') path = '/index.html';
  const segs = path.slice(1).split('/');
  if (segs.some(s => s === '' || s.startsWith('.'))) return null;
  try {
    const real = await realpath(join(uiDirReal, ...segs));
    if (!inside(uiDirReal, real) || !(await stat(real)).isFile()) return null;
    const type = TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream';
    const hashed = segs[0] === 'assets' && segs.length > 1;
    return { body: await readFile(real), type, cache: hashed ? 'public, max-age=31536000, immutable' : 'no-cache' };
  } catch { return null; }
}
