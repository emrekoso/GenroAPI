import { describe, it, expect } from 'vitest';
import type { Endpoint, GenOptions, GeneratedFile } from './index.js';

describe('model', () => {
  it('types compile', () => {
    const e: Endpoint = { id: 'a', method: 'get', path: '/a', name: 'a', group: 'g', pathParams: [], queryParams: [], isSse: false, goMode: 'proxy', enabled: true };
    const o: GenOptions = { servicePrefix: '', query: false, zod: false, zustand: false, backend: 'none', go: { package: 'p', teaImport: 't' } };
    const f: GeneratedFile = { path: 'x', content: '', kind: 'frontend' };
    expect([e.id, o.backend, f.kind]).toEqual(['a', 'none', 'frontend']);
  });
});
