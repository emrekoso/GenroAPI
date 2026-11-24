import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '@genroapi/server';

export interface IO { out(s: string): void; err(s: string): void }
export interface Handle { close(): Promise<void>; url?: string; exitCode?: number }

const here = dirname(fileURLToPath(import.meta.url));

const USAGE = `Usage: genroapi [options]

Generate a typed TypeScript client (and optional Go proxy routes) from a Swagger/OpenAPI spec.

Options:
  --port <n>      Port to listen on (default: 0 = pick a free port)
  --no-open       Do not open the browser
  --cwd <dir>     Directory containing genroapi.config.json (default: current directory)
  --ui-dir <dir>  Directory with the built UI (default: bundled UI)
  --help          Show this help
  --version       Show the version
`;

interface Args { port: number; open: boolean; cwd: string; uiDir?: string; help: boolean; version: boolean }

/** Tiny hand-rolled parser; throws Error(message) on bad input. */
function parseArgs(argv: string[]): Args {
  const a: Args = { port: 0, open: true, cwd: process.cwd(), help: false, version: false };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help': a.help = true; break;
      case '--version': a.version = true; break;
      case '--no-open': a.open = false; break;
      case '--cwd': a.cwd = resolve(value(i, arg)); i++; break;
      case '--ui-dir': a.uiDir = resolve(value(i, arg)); i++; break;
      case '--port': {
        const v = value(i, arg); i++;
        if (!/^\d+$/.test(v) || Number(v) > 65535) throw new Error(`Invalid port: ${v}`);
        a.port = Number(v); break;
      }
      default: throw new Error(arg.startsWith('-') ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    }
  }
  return a;
}

/** UI lookup: `<cli>/dist/ui` (published layout, copied by the build) then `packages/ui/dist` (monorepo checkout). */
function defaultUiDir(): string {
  const candidates = [join(here, 'ui'), join(here, '..', '..', 'ui', 'dist')];
  return candidates.find(c => existsSync(join(c, 'index.html'))) ?? candidates[1];
}

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // non-fatal: the URL is printed anyway
    child.unref();
  } catch { /* non-fatal */ }
}

const noop = async () => {};

export async function run(
  argv: string[],
  io: IO = { out: s => { process.stdout.write(s); }, err: s => { process.stderr.write(s); } },
): Promise<Handle> {
  let args: Args;
  try { args = parseArgs(argv); }
  catch (e) { io.err(`genroapi: ${(e as Error).message}\n\n${USAGE}`); return { close: noop, exitCode: 2 }; }
  if (args.help) { io.out(USAGE); return { close: noop, exitCode: 0 }; }
  if (args.version) {
    io.out(`${JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version}\n`);
    return { close: noop, exitCode: 0 };
  }
  if (!existsSync(args.cwd)) { io.err(`genroapi: --cwd directory does not exist: ${args.cwd}\n`); return { close: noop, exitCode: 1 }; }
  if (!statSync(args.cwd).isDirectory()) { io.err(`genroapi: --cwd is not a directory: ${args.cwd}\n`); return { close: noop, exitCode: 1 }; }
  const uiDir = args.uiDir ?? defaultUiDir();
  if (!existsSync(join(uiDir, 'index.html'))) {
    io.err(`genroapi: UI build not found at ${uiDir}\nRun \`npm run build -w packages/ui\` (or \`npm run build\`) first, or pass --ui-dir <dir>.\n`);
    return { close: noop, exitCode: 1 };
  }
  let server;
  try { server = await startServer(args.port, { cwd: args.cwd, uiDir }); }
  catch (e) { io.err(`genroapi: cannot start server: ${(e as Error).message}\n`); return { close: noop, exitCode: 1 }; }
  io.out(`GenroAPI running at ${server.url}\n`);
  if (args.open) openBrowser(server.url);
  return { close: server.close, url: server.url };
}

/** Close the server and exit: 0 on success, 1 (with a message) if closing fails. */
export async function shutdown(h: { close(): Promise<void> }, exit: (code: number) => void, err: (msg: string) => void): Promise<void> {
  try { await h.close(); exit(0); }
  catch (e) { err(`genroapi: error while shutting down: ${e instanceof Error ? e.message : String(e)}\n`); exit(1); }
}
