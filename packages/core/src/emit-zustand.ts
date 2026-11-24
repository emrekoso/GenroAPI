import type { Endpoint, GenOptions, GeneratedFile, JsonSchema } from './model.js';
import { toIdent } from './naming.js';
import { groupSlug } from './paths.js';
import { walk } from './schema.js';
import { renderTs } from './emit-types.js';
import { pathIdents, typeNames } from './emit-axios.js';
import { cap, HEADER } from './emit-common.js';

const cmp = (a: Endpoint, b: Endpoint): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** One Zustand store per group: data/loading/error state plus a fetch action per GET endpoint (SSE skipped). */
export function emitZustand(group: string, eps: Endpoint[], _o: GenOptions, components: Record<string, JsonSchema> = {}): GeneratedFile {
  const slug = groupSlug(group);
  const active = eps.filter((e) => e.enabled && !e.isSse && e.method === 'get').sort(cmp);
  const storeName = `use${cap(toIdent(group).replace(/^_+/, ''))}Store`;
  const names = typeNames(eps, components);
  const typeImports = new Set<string>();
  const stateLines: string[] = [];
  const initLines: string[] = [];
  const actions: string[] = [];

  for (const e of active) {
    const P = cap(e.name);
    const T = names.get(e)!;
    const idents = pathIdents(e);
    const args = e.pathParams.map((p) => `${idents.get(p.name)}: ${renderTs(walk(p.schema))}`);
    const argNames = e.pathParams.map((p) => idents.get(p.name)!);
    if (e.body) { args.push(`body: ${T.req}`); argNames.push('body'); typeImports.add(T.req); }
    if (e.queryParams.length) {
      args.push(`params${e.queryParams.some((p) => p.required) ? '' : '?'}: ${T.params}`);
      argNames.push('params');
      typeImports.add(T.params);
    }
    const R = e.response ? T.resp : 'void';
    if (e.response) typeImports.add(T.resp);
    stateLines.push(`  ${e.name}: { data?: ${R}; loading: boolean; error?: string };`, `  fetch${P}: (${args.join(', ')}) => Promise<void>;`);
    initLines.push(`  ${e.name}: { loading: false },`);
    actions.push(`  fetch${P}: async (${args.join(', ')}) => {
    __set((s) => ({ ${e.name}: { ...s.${e.name}, loading: true, error: undefined } }));
    try {
      const data = await svc.${e.name}(${argNames.join(', ')});
      __set({ ${e.name}: { data, loading: false } });
    } catch (e) {
      __set((s) => ({ ${e.name}: { ...s.${e.name}, loading: false, error: e instanceof Error ? e.message : String(e) } }));
    }
  },`);
  }
  if (!active.length) return { path: `${slug}.store.gen.ts`, kind: 'frontend', content: `${HEADER}\n\nexport {};\n` };

  const imports = [`import { create } from 'zustand';`, `import * as svc from './${slug}.service.gen';`];
  if (typeImports.size) imports.push(`import type { ${[...typeImports].sort().join(', ')} } from './${slug}.types.gen';`);
  const content = `${HEADER}

${imports.join('\n')}

interface StoreState {
${stateLines.join('\n')}
}

export const ${storeName} = create<StoreState>()((__set) => ({
${initLines.join('\n')}
${actions.join('\n')}
}));
`;
  return { path: `${slug}.store.gen.ts`, kind: 'frontend', content };
}
