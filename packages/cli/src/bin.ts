import { nodeCheckMessage } from './nodecheck.js';

// Must run before core/server are loaded: older Nodes fail on them (e.g. ERR_REQUIRE_ESM) before any message can print.
const tooOld = nodeCheckMessage(process.versions.node);
if (tooOld) { process.stderr.write(`${tooOld}\n`); process.exit(1); }

const { run, shutdown } = await import('./cli.js');
const h = await run(process.argv.slice(2));
if (h.url === undefined) process.exit(h.exitCode ?? 0);
const stop = () => { void shutdown(h, code => process.exit(code), m => process.stderr.write(m)); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
