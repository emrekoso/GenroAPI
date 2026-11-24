import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GeneratedFile } from '@genroapi/core';
import { diffFiles, writeFiles, WriterError } from './writer.js';

let root: string, fe: string, be: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'genroapi-w-'));
  fe = join(root, 'fe'); be = join(root, 'be');
  await mkdir(fe); await mkdir(be);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const f = (path: string, content: string, kind: 'frontend' | 'backend' = 'frontend'): GeneratedFile => ({ path, content, kind });

describe('diffFiles', () => {
  it('classifies new/same/changed and routes by kind', async () => {
    await writeFile(join(fe, 'same.ts'), 'a\n');
    await writeFile(join(fe, 'chg.ts'), 'one\ntwo\n');
    await writeFile(join(be, 'go.go'), 'x\n');
    const r = await diffFiles(
      [f('new.ts', 'n\n'), f('same.ts', 'a\n'), f('chg.ts', 'one\nTWO\n'), f('go.go', 'x\n', 'backend')],
      { frontend: fe, backend: be }, root);
    expect(r.map(x => [x.path, x.status])).toEqual([['new.ts', 'new'], ['same.ts', 'same'], ['chg.ts', 'changed'], ['go.go', 'same']]);
    const chg = r[2].diff!;
    expect(chg).toContain('-two');
    expect(chg).toContain('+TWO');
    expect(r[0].diff).toBeUndefined();
  });
});

describe('writeFiles', () => {
  it('writes new (creating dirs), skips same, writes changed only when in overwrite', async () => {
    const out = join(fe, 'deep', 'er');
    await mkdir(fe, { recursive: true });
    await writeFile(join(fe, 'same.ts'), 'a');
    await writeFile(join(fe, 'chg.ts'), 'old');
    await writeFile(join(fe, 'chg2.ts'), 'old2');
    const files = [f('same.ts', 'a'), f('chg.ts', 'new'), f('chg2.ts', 'new2')];
    const r = await writeFiles(files, { frontend: fe }, [], root);
    expect(r).toEqual({ written: [], skipped: ['same.ts', 'chg.ts', 'chg2.ts'] });
    expect(await readFile(join(fe, 'chg.ts'), 'utf8')).toBe('old');
    const r2 = await writeFiles([...files, f('fresh.ts', 'z')], { frontend: fe }, ['chg.ts'], root);
    expect(r2).toEqual({ written: ['chg.ts', 'fresh.ts'], skipped: ['same.ts', 'chg2.ts'] });
    expect(await readFile(join(fe, 'chg.ts'), 'utf8')).toBe('new');
    expect(await readFile(join(fe, 'chg2.ts'), 'utf8')).toBe('old2');
    const r3 = await writeFiles([f('a.ts', 'q')], { frontend: out }, [], root);
    expect(r3.written).toEqual(['a.ts']);
    expect(await readFile(join(out, 'a.ts'), 'utf8')).toBe('q');
    expect((await readdir(fe)).filter(n => n.includes('.tmp'))).toEqual([]);
  });

  it('resolves relative outDirs against cwd', async () => {
    await writeFiles([f('r.ts', 'r')], { frontend: 'rel/out' }, [], root);
    expect(await readFile(join(root, 'rel/out/r.ts'), 'utf8')).toBe('r');
  });

  it.each(['../x', '/abs/x', 'a/b.ts', 'a\\b.ts', '', '.', '..'])('rejects unsafe name %j and writes nothing', async bad => {
    await expect(writeFiles([f('good.ts', 'g'), f(bad, 'b')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });

  it('refuses a symlink that escapes the outDir, writing nothing', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(fe, 'link.ts'));
    await expect(writeFiles([f('good.ts', 'g'), f('link.ts', 'evil')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(fe)).toEqual(['link.ts']);
  });

  it('refuses a symlinked outDir parent escape', async () => {
    // outDir itself is fine even if symlinked; file symlink to a file outside is refused
    const target = join(root, 'secret.txt');
    await writeFile(target, 'secret');
    await symlink(target, join(fe, 'ln.ts'));
    await expect(writeFiles([f('ln.ts', 'evil')], { frontend: fe }, ['ln.ts'], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readFile(target, 'utf8')).toBe('secret');
  });

  it('rejects backend file without outDirs.backend', async () => {
    await expect(writeFiles([f('a.go', 'x', 'backend'), f('ok.ts', 'o')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });
});
