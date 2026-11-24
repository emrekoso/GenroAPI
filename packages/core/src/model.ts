export type GoMode = 'proxy'|'unsecure'|'cache'|'stream'|'passthrough'|'none';
export type Method = 'get'|'post'|'put'|'patch'|'delete';
export type JsonSchema = Record<string, unknown>;
export interface Param { name: string; ident: string; required: boolean; schema: JsonSchema }
export interface Endpoint { id: string; method: Method; path: string; name: string; group: string;
  summary?: string; pathParams: Param[]; queryParams: Param[]; body?: JsonSchema;
  response?: JsonSchema; isSse: boolean; goMode: GoMode; cacheTtl?: string; enabled: boolean }
export interface GenOptions { servicePrefix: string; query: boolean; zod: boolean; zustand: boolean;
  backend: 'none'|'go'; go: { package: string; teaImport: string } }
export interface GeneratedFile { path: string; content: string; kind: 'frontend'|'backend' }
