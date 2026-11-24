import { mkdir, readFile, realpath, lstat, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import type { GeneratedFile } from '@genroapi/core';

export interface OutDirs { frontend: string; backend?: string }
export type Status = 'new' | 'same' | 'changed';
export interface DiffEntry { path: string; status: Status; diff?: string }

/** Invalid request (unsafe path, missing outDir, ...). Maps to HTTP 400. */
export class WriterError extends Error {}

interface Target { file: GeneratedFile; target: string; status: Status; old?: string }

const inside = (dir: string, p: string) => { const r = relative(dir, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };

/** realpath of the deepest existing ancestor, with the not-yet-existing remainder appended. */
async function canonicalDir(dir: string): Promise<string> {
  const rest: string[] = [];
  let cur = dir;
  for (;;) {
    try { return join(await realpath(cur), ...rest.reverse()); }
    catch (e: any) {
      if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e;
      const up = dirname(cur);
      if (up === cur) throw new WriterError(`Cannot resolve output directory ${dir}`);
      rest.push(basename(cur)); cur = up;
    }
  }
}

function checkName(name: unknown): string {
  if (typeof name !== 'string' || name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0') || isAbsolute(name))
    throw new WriterError(`Invalid file name ${JSON.stringify(name)}: must be a plain file name`);
  return name;
}

/** Validate every file first (names, outDirs, symlink escapes), then classify against disk. Throws before any write. */
async function resolveTargets(files: GeneratedFile[], outDirs: OutDirs, cwd: string): Promise<Target[]> {
  const dirs = new Map<string, string>();
  const dirFor = async (kind: 'frontend' | 'backend') => {
    const raw = outDirs[kind];
    if (typeof raw !== 'string' || raw === '') throw new WriterError(`No ${kind} output directory given`);
    let d = dirs.get(kind);
    if (!d) { d = await canonicalDir(resolve(cwd, raw)); dirs.set(kind, d); }
    return d;
  };
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const file of files) {
    const name = checkName(file.path);
    if (file.kind !== 'frontend' && file.kind !== 'backend') throw new WriterError(`Invalid kind for ${name}`);
    if (typeof file.content !== 'string') throw new WriterError(`Invalid content for ${name}`);
    const dir = await dirFor(file.kind);
    const target = join(dir, name);
    if (!inside(dir, target)) throw new WriterError(`${name} resolves outside the output directory`);
    if (seen.has(target)) throw new WriterError(`Duplicate file ${name}`);
    seen.add(target);
    let status: Status = 'new';
    let old: string | undefined;
    let st;
    try { st = await lstat(target); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; }
    if (st) {
      let real: string;
      try { real = await realpath(target); } catch { throw new WriterError(`${name} is a broken symlink`); }
      if (!inside(dir, real)) throw new WriterError(`${name} resolves outside the output directory`);
      if (!(await lstat(real)).isFile()) throw new WriterError(`${name} exists and is not a file`);
      old = await readFile(real, 'utf8');
      status = old === file.content ? 'same' : 'changed';
    }
    out.push({ file, target, status, old });
  }
  return out;
}

export async function diffFiles(files: GeneratedFile[], outDirs: OutDirs, cwd: string): Promise<DiffEntry[]> {
  const ts = await resolveTargets(files, outDirs, cwd);
  return ts.map(({ file, status, old }) => {
    const e: DiffEntry = { path: file.path, status };
    if (status === 'changed') e.diff = createTwoFilesPatch(file.path, file.path, old!, file.content, 'existing', 'generated');
    return e;
  });
}

export async function writeFiles(files: GeneratedFile[], outDirs: OutDirs, overwrite: string[], cwd: string): Promise<{ written: string[]; skipped: string[] }> {
  const ts = await resolveTargets(files, outDirs, cwd);
  const allow = new Set(overwrite);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const { file, target, status } of ts) {
    if (status === 'same' || (status === 'changed' && !allow.has(file.path))) { skipped.push(file.path); continue; }
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try { await writeFile(tmp, file.content, { flag: 'wx' }); await rename(tmp, target); }
    catch (e) { await rm(tmp, { force: true }); throw e; }
    written.push(file.path);
  }
  return { written, skipped };
}
