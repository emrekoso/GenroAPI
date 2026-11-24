import Fastify, { type FastifyInstance } from 'fastify';
import { fetchSpec, parseSpec, plan, RESERVED_WORDS, type Endpoint, type GenOptions, type GeneratedFile, type JsonSchema } from '@genroapi/core';
import { diffFiles, writeFiles, WriterError, type OutDirs } from './writer.js';
import { realpath } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { loadStatic } from './static.js';
import { readConfig, writeConfig } from './config.js';

export interface ServerOpts { cwd?: string; uiDir?: string }

class BadRequest extends Error {}
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (msg: string): never => { throw new BadRequest(msg); };

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const GO_MODES = ['proxy', 'unsecure', 'cache', 'stream', 'passthrough', 'none'];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const isIdent = (v: unknown): v is string => typeof v === 'string' && IDENT_RE.test(v) && !RESERVED_WORDS.includes(v);

function validOptions(o: unknown): GenOptions {
  if (!isObj(o)) return bad('options must be an object');
  if (typeof o.servicePrefix !== 'string') bad('options.servicePrefix is required');
  for (const k of ['query', 'zod', 'zustand']) if (typeof o[k] !== 'boolean') bad(`options.${k} must be a boolean`);
  if (o.backend !== 'none' && o.backend !== 'go') bad("options.backend must be 'none' or 'go'");
  const go = o.go;
  if (!isObj(go) || typeof go.package !== 'string' || typeof go.teaImport !== 'string') bad('options.go must be {package, teaImport}');
  if (o.backend === 'go') {
    const g = go as Record<string, string>;
    if (!/^[a-z_][a-z0-9_]*$/.test(g.package)) bad('options.go.package must be a valid Go package name (lowercase letters, digits, underscore)');
    if (g.teaImport === '' || /["'`\\\r\n]/.test(g.teaImport)) bad('options.go.teaImport must be a non-empty import path without quotes, backslashes or newlines');
  }
  return o as unknown as GenOptions;
}

function validParams(e: Record<string, unknown>, k: 'pathParams' | 'queryParams'): void {
  const list = e[k];
  if (!Array.isArray(list)) bad(`endpoint.${k} must be an array`);
  for (const p of list as unknown[]) {
    if (!isObj(p) || typeof p.name !== 'string' || typeof p.required !== 'boolean') bad(`endpoint.${k} items must be {name, ident, required, schema}`);
    if (!isIdent((p as Record<string, unknown>).ident)) bad(`endpoint.${k} items need a valid identifier in "ident"`);
  }
}

function validEndpoints(v: unknown): Endpoint[] {
  if (!Array.isArray(v)) return bad('endpoints must be an array');
  const seen = new Set<string>();
  for (const e of v) {
    if (!isObj(e)) return bad('each endpoint must be an object');
    for (const k of ['name', 'path', 'method', 'group']) if (typeof e[k] !== 'string') bad(`endpoint.${k} must be a string`);
    validParams(e, 'pathParams');
    validParams(e, 'queryParams');
    if (!METHODS.includes(e.method as string)) bad(`endpoint.method must be one of ${METHODS.join(', ')}`);
    if (!GO_MODES.includes(e.goMode as string)) bad(`endpoint.goMode must be one of ${GO_MODES.join(', ')}`);
    if (typeof e.enabled !== 'boolean') bad('endpoint.enabled must be a boolean');
    if (e.isSse !== undefined && typeof e.isSse !== 'boolean') bad('endpoint.isSse must be a boolean');
    if (e.cacheTtl !== undefined && typeof e.cacheTtl !== 'string') bad('endpoint.cacheTtl must be a string');
    if (e.enabled) {
      // Go routes are `/<name>` for the whole router, so enabled names must be valid identifiers and globally unique.
      if (!isIdent(e.name)) bad(`Invalid endpoint name ${JSON.stringify(String(e.name).slice(0, 60))}: must be a JS identifier and not a reserved word`);
      if (seen.has(e.name as string)) bad(`Duplicate endpoint name ${JSON.stringify(e.name)}`);
      seen.add(e.name as string);
    }
  }
  return v as Endpoint[];
}

function validFiles(v: unknown): GeneratedFile[] {
  if (!Array.isArray(v)) return bad('files must be an array');
  for (const f of v) if (!isObj(f) || typeof f.path !== 'string' || typeof f.content !== 'string' || (f.kind !== 'frontend' && f.kind !== 'backend')) bad('each file must be {path, content, kind}');
  return v as GeneratedFile[];
}

function validOutDirs(v: unknown): OutDirs {
  if (!isObj(v) || typeof v.frontend !== 'string' || v.frontend === '') return bad('outDirs.frontend is required');
  if (v.backend !== undefined && typeof v.backend !== 'string') bad('outDirs.backend must be a string');
  return v as unknown as OutDirs;
}

export function buildServer(opts: ServerOpts = {}): FastifyInstance {
  const cwd = opts.cwd ?? process.cwd();
  const app: FastifyInstance = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });

  // Only JSON bodies are parsed; any other content type is rejected with 415 (forces a CORS preflight for cross-site pages).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, body === '' ? {} : JSON.parse(body as string)); }
    catch { const e: any = new Error('Invalid JSON body'); e.statusCode = 400; done(e); }
  });

  // DNS-rebinding / cross-site protection: no CORS headers are ever set.
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? '';
    const m = /^(localhost|127\.0\.0\.1)(?::(\d+))?$/.exec(host);
    if (!m || (req.socket.localPort !== undefined && Number(m[2] ?? 80) !== req.socket.localPort))
      return reply.code(403).send({ error: 'Forbidden host' });
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return reply.code(403).send({ error: 'Forbidden origin' });
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof BadRequest || err instanceof WriterError) return reply.code(400).send({ error: err.message });
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(code).send({ error: err.message });
  });

  app.post('/api/spec', async (req, reply) => {
    const body = req.body;
    if (!isObj(body) || typeof body.url !== 'string' || body.url === '') return bad('url is required');
    try { return await parseSpec(await fetchSpec(body.url)); }
    catch (e) { return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) }); }
  });

  app.post('/api/preview', async req => {
    const b = req.body;
    if (!isObj(b)) return bad('body must be an object');
    const endpoints = validEndpoints(b.endpoints);
    const options = validOptions(b.options);
    if (b.components !== undefined && !isObj(b.components)) bad('components must be an object');
    return { files: plan(endpoints, options, b.components as Record<string, JsonSchema> | undefined) };
  });

  app.post('/api/diff', async req => {
    const b = req.body;
    if (!isObj(b)) return bad('body must be an object');
    return diffFiles(validFiles(b.files), validOutDirs(b.outDirs), cwd);
  });

  app.post('/api/write', async req => {
    const b = req.body;
    if (!isObj(b)) return bad('body must be an object');
    const files = validFiles(b.files);
    const outDirs = validOutDirs(b.outDirs);
    if (!Array.isArray(b.overwrite) || b.overwrite.some(x => typeof x !== 'string')) bad('overwrite must be an array of strings');
    return writeFiles(files, outDirs, b.overwrite as string[], cwd);
  });

  // The directory relative output dirs are resolved against; the UI shows it so users can see where files will land.
  app.get('/api/info', async () => ({ cwd: resolvePath(cwd) }));

  app.get('/api/config', async () => readConfig(cwd));
  app.put('/api/config', async req => {
    if (!isObj(req.body)) return bad('config must be a JSON object');
    await writeConfig(cwd, req.body);
    return req.body;
  });

  if (opts.uiDir) {
    const uiDir = opts.uiDir;
    let uiReal: Promise<string> | undefined;
    const serve = async (req: { raw: { url?: string } }, reply: any) => {
      const url = req.raw.url ?? '/';
      if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) return reply.code(404).send({ error: 'Not found' });
      const f = await loadStatic(await (uiReal ??= realpath(uiDir)), url);
      if (!f) return reply.code(404).send({ error: 'Not found' });
      return reply.header('cache-control', f.cache).header('content-security-policy', CSP).type(f.type).send(f.body);
    };
    app.get('/', serve);
    app.get('/*', serve);
  }

  return app;
}

export async function startServer(port = 0, opts: ServerOpts = {}): Promise<{ url: string; close(): Promise<void> }> {
  const app = buildServer(opts);
  await app.listen({ host: '127.0.0.1', port });
  const actual = (app.server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${actual}`, close: () => app.close() };
}
