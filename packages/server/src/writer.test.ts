import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GeneratedFile } from '@genroapi/core';
import { plan } from '@genroapi/core';
import { diffFiles, writeFiles, WriterError, inside, isAllowedName } from './writer.js';

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
    await writeFile(join(fe, 'same.gen.ts'), 'a\n');
    await writeFile(join(fe, 'chg.gen.ts'), 'one\ntwo\n');
    await writeFile(join(be, 'go.gen.go'), 'x\n');
    const r = await diffFiles(
      [f('new.gen.ts', 'n\n'), f('same.gen.ts', 'a\n'), f('chg.gen.ts', 'one\nTWO\n'), f('go.gen.go', 'x\n', 'backend')],
      { frontend: fe, backend: be }, root);
    expect(r.map(x => [x.path, x.status])).toEqual([['new.gen.ts', 'new'], ['same.gen.ts', 'same'], ['chg.gen.ts', 'changed'], ['go.gen.go', 'same']]);
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
    await writeFile(join(fe, 'same.gen.ts'), 'a');
    await writeFile(join(fe, 'chg.gen.ts'), 'old');
    await writeFile(join(fe, 'chg2.gen.ts'), 'old2');
    const files = [f('same.gen.ts', 'a'), f('chg.gen.ts', 'new'), f('chg2.gen.ts', 'new2')];
    const r = await writeFiles(files, { frontend: fe }, [], root);
    expect(r).toEqual({ written: [], skipped: ['same.gen.ts', 'chg.gen.ts', 'chg2.gen.ts'] });
    expect(await readFile(join(fe, 'chg.gen.ts'), 'utf8')).toBe('old');
    const r2 = await writeFiles([...files, f('fresh.gen.ts', 'z')], { frontend: fe }, ['chg.gen.ts'], root);
    expect(r2).toEqual({ written: ['chg.gen.ts', 'fresh.gen.ts'], skipped: ['same.gen.ts', 'chg2.gen.ts'] });
    expect(await readFile(join(fe, 'chg.gen.ts'), 'utf8')).toBe('new');
    expect(await readFile(join(fe, 'chg2.gen.ts'), 'utf8')).toBe('old2');
    const r3 = await writeFiles([f('a.gen.ts', 'q')], { frontend: out }, [], root);
    expect(r3.written).toEqual(['a.gen.ts']);
    expect(await readFile(join(out, 'a.gen.ts'), 'utf8')).toBe('q');
    expect((await readdir(fe)).filter(n => n.includes('.tmp'))).toEqual([]);
  });

  it('resolves relative outDirs against cwd', async () => {
    await writeFiles([f('r.gen.ts', 'r')], { frontend: 'rel/out' }, [], root);
    expect(await readFile(join(root, 'rel/out/r.gen.ts'), 'utf8')).toBe('r');
  });

  it.each(['../x', '/abs/x', 'a/b.gen.ts', 'a\\b.gen.ts', '', '.', '..'])('rejects unsafe name %j and writes nothing', async bad => {
    await expect(writeFiles([f('good.gen.ts', 'g'), f(bad, 'b')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });

  it('refuses a symlink that escapes the outDir, writing nothing', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(fe, 'link.gen.ts'));
    await expect(writeFiles([f('good.gen.ts', 'g'), f('link.gen.ts', 'evil')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(fe)).toEqual(['link.gen.ts']);
  });

  it('refuses a symlinked outDir parent escape', async () => {
    // outDir itself is fine even if symlinked; file symlink to a file outside is refused
    const target = join(root, 'secret.txt');
    await writeFile(target, 'secret');
    await symlink(target, join(fe, 'ln.gen.ts'));
    await expect(writeFiles([f('ln.gen.ts', 'evil')], { frontend: fe }, ['ln.gen.ts'], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readFile(target, 'utf8')).toBe('secret');
  });

  it('rejects backend file without outDirs.backend', async () => {
    await expect(writeFiles([f('a.gen.go', 'x', 'backend'), f('ok.gen.ts', 'o')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });
});

describe('hardening', () => {
  it('long name: 400-class error and nothing written', async () => {
    await expect(writeFiles([f('good.gen.ts', 'g'), f('a'.repeat(250), 'x')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });
  it('case-insensitive / NFC duplicates are rejected, nothing written', async () => {
    await expect(writeFiles([f('A.gen.ts', '1'), f('a.gen.ts', '2')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });
  it('outDir that is an existing file -> WriterError', async () => {
    await writeFile(join(root, 'afile'), 'x');
    await expect(writeFiles([f('a.gen.ts', '1')], { frontend: join(root, 'afile') }, [], root)).rejects.toBeInstanceOf(WriterError);
    await expect(diffFiles([f('a.gen.ts', '1')], { frontend: join(root, 'afile', 'sub') }, root)).rejects.toBeInstanceOf(WriterError);
  });
  it('inside() is exact about parent-escape', () => {
    expect(inside('/a/b', '/a/b/..foo.ts')).toBe(true);
    expect(inside('/a/b', '/a/b/../x')).toBe(false);
    expect(inside('/a/b', '/a/b')).toBe(false);
    expect(inside('/a/b', '/a/bc/x')).toBe(false);
  });
  it.each(['x.ts', 'x.txt', 'x.gen.js', '..foo.gen.ts', 'a b.gen.ts', '.gen.ts', 'x.gen.ts.exe'])('allowlist rejects %j', n => {
    expect(isAllowedName(n)).toBe(false);
  });
  it('allowlist accepts every name plan() emits (no drift from emitters)', () => {
    const ep = { id: 'getPets', method: 'get', path: '/pets/{id}', name: 'getPets', group: 'Pets & Co', summary: 's',
      pathParams: [{ name: 'id', ident: 'id', required: true, schema: { type: 'string' } }], queryParams: [],
      isSse: false, goMode: 'proxy', enabled: true };
    const eps = [ep, { ...ep, id: 'x', name: 'x', group: 'other_group', method: 'post', body: { type: 'object' } }] as any;
    const files = plan(eps, { servicePrefix: '/api', query: true, zod: true, zustand: true, backend: 'go', go: { package: 'p', teaImport: 't' } }, { Pet: { type: 'object' } });
    expect(files.some(x => x.kind === 'backend')).toBe(true);
    expect(files.length).toBeGreaterThan(4);
    for (const x of files) expect(isAllowedName(x.path), x.path).toBe(true);
  });
  it('allowlist rejection writes nothing', async () => {
    await expect(writeFiles([f('good.gen.ts', 'g'), f('README.md', 'x')], { frontend: fe }, [], root)).rejects.toBeInstanceOf(WriterError);
    expect(await readdir(fe)).toEqual([]);
  });
});
