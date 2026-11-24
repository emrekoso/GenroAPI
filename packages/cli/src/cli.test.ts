import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, shutdown } from './cli.js';
import { nodeCheckMessage } from './nodecheck.js';

describe('I1 node version check', () => {
  it.each(['16.20.2', '18.19.0', '20.11.1', '22.18.9', '22.0.0'])('%s is too old', v => {
    expect(nodeCheckMessage(v)).toBe(`GenroAPI needs Node >=22.19 (found ${v}). Use nvm/fnm to switch.`);
  });
  it.each(['22.19.0', '22.23.3', '23.0.0', '24.3.0', '100.0.0'])('%s is fine', v => {
    expect(nodeCheckMessage(v)).toBeNull();
  });
  it('garbage versions are rejected rather than crashing', () => {
    expect(nodeCheckMessage('')).toContain('needs Node >=22.19');
  });
});

describe('--cwd', () => {
  const sink = () => { const o: string[] = [], e: string[] = []; return { o, e, io: { out: (s: string) => { o.push(s); }, err: (s: string) => { e.push(s); } } }; };
  it('nonexistent dir -> clear error, exit 1, no server', async () => {
    const s = sink();
    const h = await run(['--no-open', '--cwd', join(tmpdir(), 'genroapi-does-not-exist-xyz')], s.io);
    expect(h.exitCode).toBe(1);
    expect(h.url).toBeUndefined();
    expect(s.e.join('')).toContain('--cwd');
    expect(s.e.join('')).toContain('genroapi-does-not-exist-xyz');
    expect(s.o.join('')).toBe('');
  });
  it('a file instead of a directory -> exit 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genroapi-cwd-'));
    try {
      writeFileSync(join(dir, 'f'), 'x');
      const s = sink();
      const h = await run(['--no-open', '--cwd', join(dir, 'f')], s.io);
      expect(h.exitCode).toBe(1);
      expect(s.e.join('')).toContain('not a directory');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('shutdown', () => {
  it('exits 0 after a clean close', async () => {
    const codes: number[] = [];
    await shutdown({ close: async () => {} }, c => codes.push(c), () => {});
    expect(codes).toEqual([0]);
  });
  it('a failing close exits non-zero and reports it', async () => {
    const codes: number[] = [], msgs: string[] = [];
    await shutdown({ close: async () => { throw new Error('boom'); } }, c => codes.push(c), m => msgs.push(m));
    expect(codes).toEqual([1]);
    expect(msgs.join('')).toContain('boom');
  });
});
