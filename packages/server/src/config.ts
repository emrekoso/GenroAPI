import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'genroapi.config.json';

export async function readConfig(cwd: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(join(cwd, FILE), 'utf8')); }
  catch (e: any) {
    if (e?.code === 'ENOENT') return {};
    throw new Error(`Cannot read ${FILE}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function writeConfig(cwd: string, cfg: Record<string, unknown>): Promise<void> {
  const p = join(cwd, FILE);
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n');
  await rename(tmp, p);
}
