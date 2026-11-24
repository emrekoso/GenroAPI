import type { Endpoint, GenOptions, GeneratedFile } from '@genroapi/core';

export interface SpecResult { title: string; endpoints: Endpoint[]; components: Record<string, unknown> }
export interface OutDirs { frontend: string; backend?: string }
export interface DiffEntry { path: string; status: 'new' | 'same' | 'changed'; diff?: string }
export interface WriteResult { written: string[]; skipped: string[] }

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data: any;
  try { data = await res.json(); } catch { data = undefined; }
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const loadSpec = (url: string) => call<SpecResult>('POST', '/api/spec', { url });
export const preview = (endpoints: Endpoint[], options: GenOptions, components: unknown, signal?: AbortSignal) =>
  call<{ files: GeneratedFile[] }>('POST', '/api/preview', { endpoints, options, components }, signal);
export const diff = (files: GeneratedFile[], outDirs: OutDirs) => call<DiffEntry[]>('POST', '/api/diff', { files, outDirs });
export const write = (files: GeneratedFile[], outDirs: OutDirs, overwrite: string[]) =>
  call<WriteResult>('POST', '/api/write', { files, outDirs, overwrite });
export const getConfig = () => call<Record<string, any>>('GET', '/api/config');
export const putConfig = (cfg: Record<string, unknown>) => call<unknown>('PUT', '/api/config', cfg);
export const getInfo = () => call<{ cwd: string }>('GET', '/api/info');
