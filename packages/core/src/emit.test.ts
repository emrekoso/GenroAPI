import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { schemaToTs, schemaToZod, emitFrontend, frontendPath, groupSlug } from './index.js';
import type { Endpoint, GenOptions } from './index.js';

const o: GenOptions = { servicePrefix: '/entity', query: false, zod: false, zustand: false, backend: 'none', go: { package: 'routers', teaImport: 'example.com/tea' } };
const ep = (p: Partial<Endpoint>): Endpoint => ({ id: 'x', method: 'get', path: '/a', name: 'a', group: 'entity', pathParams: [], queryParams: [], isSse: false, goMode: 'proxy', enabled: true, ...p });

const obj = { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, name: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['a', 'b'] } } };

describe('paths helpers', () => {
  it('frontendPath / groupSlug', () => {
    expect(frontendPath(ep({ name: 'getX', path: '/x/{id}/y/{k}' }))).toBe('/getX/{id}/{k}');
    expect(groupSlug('My-Group_1')).toBe('mygroup1');
    expect(groupSlug('---')).toBe('api');
  });
});

describe('schemaToTs', () => {
  it('object/array/enum/nullable', () => {
    expect(schemaToTs(obj, 'Thing')).toMatchInlineSnapshot(`
      "export type Thing = {
        id: number;
        name?: string | null;
        tags?: Array<string>;
        kind?: "a" | "b";
      };"
    `);
  });
  it('union, intersection, null-in-type, record', () => {
    expect(schemaToTs({ oneOf: [{ type: 'string' }, { type: 'number' }] }, 'U')).toBe('export type U = string | number;');
    expect(schemaToTs({ allOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object', properties: { b: { type: 'boolean' } } }] }, 'I'))
      .toBe('export type I = {\n  a?: string;\n} & {\n  b?: boolean;\n};');
    expect(schemaToTs({ type: ['string', 'null'] }, 'N')).toBe('export type N = string | null;');
    expect(schemaToTs({ type: 'object', additionalProperties: { type: 'number' } }, 'R')).toBe('export type R = Record<string, number>;');
  });
  it('unsupported and unresolved ref become unknown with comment', () => {
    expect(schemaToTs({ type: 'file' }, 'F')).toBe('export type F = unknown /* unsupported type "file" */;');
    expect(schemaToTs({ $ref: '#/components/schemas/Other' }, 'X')).toBe('export type X = unknown /* TODO: unresolved $ref Other */;');
  });
  it('circular ref uses the named alias', () => {
    const s = { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } };
    expect(schemaToTs(s, 'Node')).toBe('export type Node = {\n  children?: Array<Node>;\n};');
  });
});

describe('schemaToZod', () => {
  it('object/array/enum/nullable', () => {
    expect(schemaToZod(obj, 'Thing')).toMatchInlineSnapshot(`
      "export const ThingSchema = z.object({
        id: z.number(),
        name: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        kind: z.enum(["a", "b"]).optional(),
      });"
    `);
  });
  it('union, intersection, unsupported', () => {
    expect(schemaToZod({ anyOf: [{ type: 'string' }, { type: 'boolean' }] }, 'U')).toBe('export const USchema = z.union([z.string(), z.boolean()]);');
    expect(schemaToZod({ type: 'file' }, 'F')).toBe('export const FSchema = z.unknown() /* unsupported type "file" */;');
    expect(schemaToZod({ allOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] }, 'I'))
      .toBe('export const ISchema = z.intersection(z.intersection(z.string(), z.number()), z.boolean());');
  });
  it('circular ref uses z.lazy', () => {
    const s = { type: 'object', properties: { children: { type: 'array', items: { $ref: '#/components/schemas/Node' } } } };
    expect(schemaToZod(s, 'Node')).toBe('export const NodeSchema: z.ZodTypeAny = z.object({\n  children: z.array(z.lazy(() => NodeSchema)).optional(),\n});');
  });
});

const platforms = ep({
  name: 'getPlatforms', path: '/entity/platforms', summary: 'List platforms',
  queryParams: [{ name: 'limit', ident: 'limit', required: false, schema: { type: 'integer' } }],
  response: { type: 'array', items: { type: 'string' } },
});
const byId = ep({
  name: 'updatePlatform', method: 'put', path: '/entity/platforms/{id}',
  pathParams: [{ name: 'id', ident: 'id', required: true, schema: { type: 'string' } }],
  body: { type: 'object', required: ['n'], properties: { n: { type: 'string' } } },
});
const sse = ep({ name: 'watchEvents', path: '/events/{room}', isSse: true, pathParams: [{ name: 'room', ident: 'room', required: true, schema: { type: 'string' } }] });

describe('emitFrontend', () => {
  it('emits types + service (no zod)', () => {
    const files = emitFrontend('entity', [byId, platforms, sse, ep({ name: 'off', enabled: false })], o);
    expect(files.map((f) => f.path)).toEqual(['entity.service.gen.ts', 'entity.types.gen.ts']);
    expect(files.every((f) => f.kind === 'frontend' && f.content.startsWith('// Code generated by GenroAPI. DO NOT EDIT.\n'))).toBe(true);
    expect(files[0].content).toMatchInlineSnapshot(`
      "// Code generated by GenroAPI. DO NOT EDIT.

      import axios from 'axios';
      import type { GetPlatformsParams, GetPlatformsResponse, UpdatePlatformRequest } from './entity.types.gen';

      /** List platforms */
      export async function getPlatforms(params?: GetPlatformsParams, signal?: AbortSignal): Promise<GetPlatformsResponse> {
        const res = await axios.get<GetPlatformsResponse>(\`/entity/platforms\`, { params, signal });
        return res.data;
      }

      export async function updatePlatform(id: string, body: UpdatePlatformRequest, signal?: AbortSignal): Promise<void> {
        await axios.put(\`/entity/platforms/\${encodeURIComponent(id)}\`, body, { signal });
      }

      export function subscribeWatchEvents(room: string, onMessage: (data: unknown) => void, onError?: (e: Event) => void): () => void {
        const es = new EventSource(\`/events/\${encodeURIComponent(room)}\`);
        es.onmessage = (ev: MessageEvent) => {
          onMessage(JSON.parse(ev.data) as unknown);
        };
        if (onError) es.onerror = onError;
        return () => es.close();
      }
      "
    `);
    expect(files[1].content).toMatchInlineSnapshot(`
      "// Code generated by GenroAPI. DO NOT EDIT.

      export interface GetPlatformsParams {
        limit?: number;
      }

      export type GetPlatformsResponse = Array<string>;

      export type UpdatePlatformRequest = {
        n: string;
      };
      "
    `);
    expect(files[0].content).not.toContain('zod');
  });

  it('with zod validates via Schema.parse', () => {
    const files = emitFrontend('entity', [platforms, byId], { ...o, zod: true });
    expect(files.map((f) => f.path)).toEqual(['entity.service.gen.ts', 'entity.types.gen.ts', 'entity.zod.gen.ts']);
    expect(files[2].content).toBe("// Code generated by GenroAPI. DO NOT EDIT.\n\nimport { z } from 'zod';\n\nexport const GetPlatformsResponseSchema = z.array(z.string());\n");
    expect(files[0].content).toContain("import { GetPlatformsResponseSchema } from './entity.zod.gen';");
    expect(files[0].content).toContain('const res = await axios.get(`/entity/platforms`, { params, signal });\n  return GetPlatformsResponseSchema.parse(res.data);');
  });

  it('uses the Go frontend path when the Go proxy registers the route', () => {
    const og = { ...o, backend: 'go' as const };
    const files = emitFrontend('entity', [byId, ep({ name: 'raw', path: '/entity/raw/{k}', goMode: 'none', pathParams: [{ name: 'k', ident: 'k', required: true, schema: { type: 'string' } }] })], og);
    expect(files[0].content).toContain('axios.put(`/updatePlatform/${encodeURIComponent(id)}`, body, { signal })');
    expect(files[0].content).toContain('axios.get(`/entity/raw/${encodeURIComponent(k)}`, { signal })');
  });

  it('generated service type-checks against a stub axios', () => {
    const files = emitFrontend('entity', [byId, platforms, sse, ep({ name: 'req', path: '/r', queryParams: [{ name: 'q', ident: 'q', required: true, schema: { type: 'string' } }] })], o);
    const dir = mkdtempSync(join(tmpdir(), 'genroapi-tsc-'));
    for (const f of files) writeFileSync(join(dir, f.path), f.content);
    writeFileSync(join(dir, 'axios-stub.d.ts'), `declare module 'axios' {
  interface Cfg { params?: unknown; signal?: AbortSignal }
  interface Res<T> { data: T }
  const axios: {
    get<T = unknown>(url: string, cfg?: Cfg): Promise<Res<T>>;
    delete<T = unknown>(url: string, cfg?: Cfg): Promise<Res<T>>;
    post<T = unknown>(url: string, body?: unknown, cfg?: Cfg): Promise<Res<T>>;
    put<T = unknown>(url: string, body?: unknown, cfg?: Cfg): Promise<Res<T>>;
    patch<T = unknown>(url: string, body?: unknown, cfg?: Cfg): Promise<Res<T>>;
  };
  export default axios;
}
`);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true }, include: ['*.ts'] }));
    const tsc = resolve(__dirname, '../../../node_modules/typescript/bin/tsc');
    expect(() => execFileSync(process.execPath, [tsc, '-p', dir], { stdio: 'pipe' })).not.toThrow();
  });
});
