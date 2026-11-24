import { RESERVED_WORDS } from './reserved.js';

const RESERVED = new Set(RESERVED_WORDS);

export function toIdent(s: string): string {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let out = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join('');
  if (!out) out = '_';
  if (/^[0-9]/.test(out)) out = '_' + out;
  if (RESERVED.has(out)) out = '_' + out;
  return out;
}

export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(base + i)) i++;
  return base + i;
}
