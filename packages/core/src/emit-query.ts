import type { Endpoint, GenOptions, GeneratedFile } from './model.js';
import { groupSlug } from './paths.js';
import { walk } from './schema.js';
import { renderTs } from './emit-types.js';
import { pathIdents } from './emit-axios.js';
import { cap, HEADER } from './emit-common.js';

const cmp = (a: Endpoint, b: Endpoint): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.method < b.method ? -1 : a.method > b.method ? 1 : 0);

/** TanStack Query v5 hooks for a group: GET -> useXQuery, other methods -> useXMutation. SSE endpoints are skipped. */
export function emitQuery(group: string, eps: Endpoint[], _o: GenOptions): GeneratedFile {
  const slug = groupSlug(group);
  const active = eps.filter((e) => e.enabled && !e.isSse).sort(cmp);
  const fnImports = new Set<string>();
  const typeImports = new Set<string>();
  const rq = new Set<string>();
  const hooks: string[] = [];

  for (const e of active) {
    const P = cap(e.name);
    const idents = pathIdents(e);
    const pathArgs = e.pathParams.map((p) => ({ id: idents.get(p.name)!, type: renderTs(walk(p.schema)) }));
    const args = [...pathArgs];
    if (e.body) { args.push({ id: 'body', type: `${P}Request` }); typeImports.add(`${P}Request`); }
    let paramsOptional = false;
    if (e.queryParams.length) {
      paramsOptional = !e.queryParams.some((p) => p.required);
      args.push({ id: 'params', type: `${P}Params` });
      typeImports.add(`${P}Params`);
    }
    const R = e.response ? `${P}Response` : 'void';
    if (e.response) typeImports.add(`${P}Response`);
    fnImports.add(e.name);
    const sig = (a: { id: string; type: string }): string => `${a.id}${a.id === 'params' && paramsOptional ? '?' : ''}: ${a.type}`;

    if (e.method === 'get') {
      rq.add('useQuery').add('type UseQueryOptions');
      const key = [`'${group}'`, `'${e.name}'`, ...args.map((a) => a.id)].join(', ');
      hooks.push(`export function use${P}Query(${[...args.map(sig), `options?: Omit<UseQueryOptions<${R}>, 'queryKey' | 'queryFn'>`].join(', ')}) {
  return useQuery({
    queryKey: [${key}],
    queryFn: ({ signal }) => ${e.name}(${[...args.map((a) => a.id), 'signal'].join(', ')}),
    ...options,
  });
}`);
    } else {
      rq.add('useMutation').add('type UseMutationOptions');
      const vars = args.length ? `{ ${args.map((a) => `${sig(a)};`).join(' ')} }` : 'void';
      hooks.push(`export function use${P}Mutation(options?: Omit<UseMutationOptions<${R}, Error, ${vars}>, 'mutationFn'>) {
  return useMutation({
    mutationFn: (${args.length ? `vars: ${vars}` : ''}) => ${e.name}(${args.map((a) => `vars.${a.id}`).join(', ')}),
    ...options,
  });
}`);
    }
  }

  const imports: string[] = [];
  if (rq.size) imports.push(`import { ${[...rq].sort((a, b) => (a.startsWith('type ') === b.startsWith('type ') ? (a < b ? -1 : 1) : a.startsWith('type ') ? 1 : -1)).join(', ')} } from '@tanstack/react-query';`);
  if (fnImports.size) imports.push(`import { ${[...fnImports].sort().join(', ')} } from './${slug}.service.gen';`);
  if (typeImports.size) imports.push(`import type { ${[...typeImports].sort().join(', ')} } from './${slug}.types.gen';`);
  return { path: `${slug}.query.gen.ts`, kind: 'frontend', content: `${HEADER}\n\n${hooks.length ? `${imports.join('\n')}\n\n${hooks.join('\n\n')}\n` : 'export {};\n'}` };
}
