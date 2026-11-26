import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const ep = (id: string, method: string, path: string, name: string, group = 'pets') => ({
  id, method, path, name, group, pathParams: [], queryParams: [], isSse: false, goMode: 'proxy', enabled: true,
});
const SPEC = { title: 'Pets', components: {}, endpoints: [ep('e1', 'get', '/pets', 'listPets'), ep('e2', 'post', '/pets', 'createPet')] };

type Call = { method: string; url: string; body?: any };
let calls: Call[];
let routes: Record<string, (body: any) => { status?: number; json: unknown }>;

const FRONT = { path: 'pets.ts', content: 'export const a = 1;', kind: 'frontend' };
const GO = { path: 'pets.go', content: 'package routers\nfunc PetsRouter(r *gin.Engine) {}\n', kind: 'backend' };

beforeEach(() => {
  calls = [];
  routes = {
    'GET /api/config': () => ({ json: {} }),
    'PUT /api/config': b => ({ json: b }),
    'POST /api/spec': () => ({ json: SPEC }),
    'POST /api/preview': () => ({ json: { files: [FRONT, GO] } }),
    'POST /api/diff': () => ({ json: [{ path: 'pets.ts', status: 'changed', diff: '-old\n+new' }, { path: 'pets.go', status: 'new' }] }),
    'POST /api/write': () => ({ json: { written: ['pets.go'], skipped: ['pets.ts'] } }),
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });
    const r = routes[`${method} ${url}`]?.(body) ?? { status: 404, json: { error: 'nope' } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.json } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const previews = () => calls.filter(c => c.url === '/api/preview');
const lastPreview = () => previews().at(-1)!.body;

async function load(user = userEvent.setup()) {
  render(<App />);
  await user.type(screen.getByLabelText('Swagger URL'), 'http://x/swagger.json');
  await user.type(screen.getByLabelText('Service prefix'), '/periodic');
  await user.click(screen.getByRole('button', { name: 'Load endpoints' }));
  await screen.findByLabelText('Name of GET /pets');
  return user;
}
const waitPreview = (n = 1) => waitFor(() => expect(previews().length).toBeGreaterThanOrEqual(n), { timeout: 2000 });

describe('UI', () => {
  it('Load needs a URL; the prefix is optional with backend None and required (no whitespace) with Go', async () => {
    const user = userEvent.setup();
    render(<App />);
    const btn = screen.getByRole('button', { name: 'Load endpoints' });
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText('Swagger URL'), 'http://x');
    expect(btn).toBeEnabled(); // backend none: prefix not needed
    await user.click(screen.getByLabelText('Also create Go routes'));
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText('Service prefix'), '/');
    expect(btn).toBeDisabled();
    await user.type(screen.getByLabelText('Service prefix'), 'peri odic');
    expect(btn).toBeDisabled();
    expect(screen.getByText(/must not contain spaces/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Service prefix'));
    await user.type(screen.getByLabelText('Service prefix'), 'periodic');
    expect(btn).toBeEnabled();
    await user.click(screen.getByLabelText('Also create Go routes'));
    expect(btn).toBeEnabled();
  });

  it('explains the Go routing model and that the prefix only affects the Go upstream path', async () => {
    render(<App />);
    expect(screen.getByText(/Calls use `\/<name>` routes served by your Go proxy; endpoints with Go mode `none`, or backend `None`, call the raw spec path on the same origin\./)).toBeInTheDocument();
    expect(screen.getByText(/only used for the Go upstream path/i)).toBeInTheDocument();
  });

  it('loads and previews without a prefix when backend is None; Go blocks preview/write until a prefix is set', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Swagger URL'), 'http://x/swagger.json');
    await user.click(screen.getByRole('button', { name: 'Load endpoints' }));
    await screen.findByLabelText('Name of GET /pets');
    await waitPreview();
    expect(lastPreview().options.servicePrefix).toBe('');
    await user.type(screen.getByLabelText('Frontend output dir'), 'web');
    const write = screen.getByRole('button', { name: /^Write/ });
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    await user.click(screen.getByLabelText('Also create Go routes'));
    expect(write).toBeDisabled();
    const n = previews().length;
    await new Promise(r => setTimeout(r, 600));
    expect(previews().length).toBe(n); // prefix missing for Go: no preview request
    expect(screen.getByText(/Fix the highlighted settings/)).toBeInTheDocument();
  });

  it('renaming an endpoint updates preview request payload', async () => {
    const user = await load();
    await waitPreview();
    const input = screen.getByLabelText('Name of GET /pets');
    await user.clear(input);
    await user.type(input, 'fetchPets');
    await waitFor(() => expect(lastPreview().endpoints.find((e: any) => e.id === 'e1').name).toBe('fetchPets'), { timeout: 2000 });
    expect(lastPreview().options.servicePrefix).toBe('/periodic');
  });

  it('toggling Zod sends zod:true', async () => {
    const user = await load();
    await waitPreview();
    expect(lastPreview().options.zod).toBe(false);
    await user.click(screen.getByLabelText('Zod'));
    await waitFor(() => expect(lastPreview().options.zod).toBe(true), { timeout: 2000 });
  });

  it('backend=none hides Go mode column', async () => {
    const user = await load();
    expect(screen.queryByLabelText('Go mode of GET /pets')).toBeNull();
    await user.click(screen.getByLabelText('Also create Go routes'));
    expect(screen.getByLabelText('Go mode of GET /pets')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Also create Go routes'));
    expect(screen.queryByLabelText('Go mode of GET /pets')).toBeNull();
  });

  it('blocks duplicate and empty names and does not send them to preview', async () => {
    const user = await load();
    await waitPreview();
    const n = previews().length;
    const input = screen.getByLabelText('Name of POST /pets');
    await user.clear(input);
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    await user.type(input, 'listPets');
    expect(screen.getAllByText(/Duplicate name/).length).toBe(2);
    await new Promise(r => setTimeout(r, 600));
    expect(previews().length).toBe(n);
    await user.clear(input);
    await user.type(input, 'makePet');
    expect(screen.queryByText(/Duplicate name/)).toBeNull();
    await waitFor(() => expect(previews().length).toBeGreaterThan(n), { timeout: 2000 });
  });

  it.each(['get-users', 'delete', '1abc', 'a b'])('blocks invalid identifier %j and does not preview it', async bad => {
    const user = await load();
    await waitPreview();
    const n = previews().length;
    const input = screen.getByLabelText('Name of GET /pets');
    await user.clear(input);
    await user.type(input, bad);
    expect(screen.getByText(bad === 'delete' ? /reserved word/i : /valid identifier/i)).toBeInTheDocument();
    await new Promise(r => setTimeout(r, 600));
    expect(previews().length).toBe(n);
    expect(screen.getByRole('button', { name: /^Write/ })).toBeDisabled();
  });

  it('names are unique across groups (Go routes are global)', async () => {
    routes['POST /api/spec'] = () => ({ json: { ...SPEC, endpoints: [ep('e1', 'get', '/pets', 'list', 'pets'), ep('e2', 'get', '/owners', 'list', 'owners')] } });
    const user = await load();
    expect(screen.getAllByText(/Duplicate name/).length).toBe(2);
    await user.click(screen.getByLabelText('Enable GET /owners'));
    expect(screen.queryByText(/Duplicate name/)).toBeNull();
  });

  it('marks the preview out of date synchronously and blocks Write until the new preview arrives', async () => {
    const user = await load();
    await user.type(screen.getByLabelText('Frontend output dir'), 'web');
    const write = screen.getByRole('button', { name: /^Write/ });
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    expect(screen.queryByText(/Preview out of date/)).toBeNull();
    const input = screen.getByLabelText('Name of GET /pets');
    await user.type(input, 'X');
    expect(write).toBeDisabled();
    expect(screen.getByText(/Preview out of date/)).toBeInTheDocument();
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    expect(screen.queryByText(/Preview out of date/)).toBeNull();
    // an invalid state leaves the old files visibly stale instead of silently shown
    await user.clear(input);
    expect(write).toBeDisabled();
    expect(screen.getByText(/Preview out of date/)).toBeInTheDocument();
  });

  it('blocks an empty Go package name and sends the package the user typed', async () => {
    const user = await load();
    await user.click(screen.getByLabelText('Also create Go routes'));
    await user.type(screen.getByLabelText('Frontend output dir'), 'web');
    await user.type(screen.getByLabelText('Backend output dir'), 'srv');
    const write = screen.getByRole('button', { name: /^Write/ });
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    await user.clear(screen.getByLabelText('Go package name'));
    expect(write).toBeDisabled();
    expect(screen.getByText(/valid Go package name/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Go package name'), 'handlers');
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    await user.click(write);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('handlers.PetsRouter(router)')).toBeInTheDocument();
  });

  it('shows cache TTL field only for cache mode', async () => {
    const user = await load();
    await user.click(screen.getByLabelText('Also create Go routes'));
    expect(screen.queryByLabelText('Cache TTL of GET /pets')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Go mode of GET /pets'), 'cache');
    const ttl = screen.getByLabelText('Cache TTL of GET /pets');
    expect(ttl).toHaveAttribute('placeholder', '5m  (or a Go expression)');
    await user.type(ttl, '5m');
    await waitFor(() => expect(lastPreview().endpoints[0]).toMatchObject({ goMode: 'cache', cacheTtl: '5m' }), { timeout: 2000 });
    await user.selectOptions(screen.getByLabelText('Go mode of GET /pets'), 'proxy');
    expect(screen.queryByLabelText('Cache TTL of GET /pets')).toBeNull();
  });

  it('requires backend dir only for Go', async () => {
    const user = await load();
    await waitPreview();
    const write = screen.getByRole('button', { name: /^Write/ });
    expect(write).toBeDisabled();
    await user.type(screen.getByLabelText('Frontend output dir'), 'web/src/api');
    await waitFor(() => expect(write).toBeEnabled());
    await user.click(screen.getByLabelText('Also create Go routes'));
    await waitFor(() => expect(write).toBeDisabled());
    await user.type(screen.getByLabelText('Backend output dir'), 'server/routers');
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
  });

  it('shows server error in a dismissible banner', async () => {
    routes['POST /api/spec'] = () => ({ status: 502, json: { error: 'cannot fetch spec' } });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Swagger URL'), 'http://x');
    await user.type(screen.getByLabelText('Service prefix'), '/p');
    await user.click(screen.getByRole('button', { name: 'Load endpoints' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cannot fetch spec');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a long server message (HTML page hint) verbatim in the banner', async () => {
    const msg = 'Got an HTML page from http://h/swagger/, not an OpenAPI document. If this is a Swagger UI page, use the spec URL it loads (e.g. /openapi.json, /openapi.yaml, /swagger/doc.json, /v3/api-docs). Found a possible spec URL: http://h/openapi.yaml';
    routes['POST /api/spec'] = () => ({ status: 502, json: { error: msg } });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Swagger URL'), 'http://h/swagger/');
    await user.click(screen.getByRole('button', { name: 'Load endpoints' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(msg)).toBeInTheDocument();
  });

  it('changed file requires checkbox before overwrite sent; shows router line', async () => {
    const user = await load();
    await user.type(screen.getByLabelText('Frontend output dir'), 'web');
    await user.click(screen.getByLabelText('Also create Go routes'));
    await user.type(screen.getByLabelText('Backend output dir'), 'srv');
    const write = screen.getByRole('button', { name: /^Write/ });
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    await user.click(write);
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText('changed');
    expect(within(dlg).getByText('new')).toBeInTheDocument();
    expect(within(dlg).getByText(/\+new/)).toBeInTheDocument();
    expect(within(dlg).getByText('routers.PetsRouter(router)')).toBeInTheDocument();
    const box = within(dlg).getByLabelText('Overwrite pets.ts');
    expect(box).not.toBeChecked();
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await within(dlg).findByText(/Written/);
    expect(calls.filter(c => c.url === '/api/write')[0].body.overwrite).toEqual([]);
    expect(calls.find(c => c.url === '/api/diff')!.body.outDirs).toEqual({ frontend: 'web', backend: 'srv' });
  });

  it('sends only checked files in overwrite', async () => {
    const user = await load();
    await user.type(screen.getByLabelText('Frontend output dir'), 'web');
    const write = screen.getByRole('button', { name: /^Write/ });
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    await user.click(write);
    const dlg = await screen.findByRole('dialog');
    await user.click(await within(dlg).findByLabelText('Overwrite pets.ts'));
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await within(dlg).findByText(/Written/);
    expect(calls.find(c => c.url === '/api/write')!.body.overwrite).toEqual(['pets.ts']);
    expect(calls.find(c => c.url === '/api/diff')!.body.outDirs).toEqual({ frontend: 'web' });
  });

  it('Escape closes the dialog', async () => {
    const user = await load();
    await user.type(screen.getByLabelText('Frontend output dir'), 'web');
    const write = screen.getByRole('button', { name: /^Write/ });
    await waitFor(() => expect(write).toBeEnabled(), { timeout: 2000 });
    await user.click(write);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('debounces preview for rapid edits', async () => {
    const user = await load();
    await waitPreview();
    await new Promise(r => setTimeout(r, 500));
    const n = previews().length;
    const input = screen.getByLabelText('Name of GET /pets');
    await user.clear(input);
    await user.type(input, 'abcdef');
    await new Promise(r => setTimeout(r, 700));
    expect(previews().length).toBe(n + 1);
    expect(lastPreview().endpoints[0].name).toBe('abcdef');
  });

  it('persists settings via /api/config and restores on start', async () => {
    routes['GET /api/config'] = () => ({ json: { url: 'http://saved', prefix: '/saved', options: { zod: true }, outDirs: { frontend: 'fe' } } });
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Swagger URL')).toHaveValue('http://saved'));
    expect(screen.getByLabelText('Service prefix')).toHaveValue('/saved');
    expect(screen.getByLabelText('Zod')).toBeChecked();
    expect(screen.getByLabelText('Frontend output dir')).toHaveValue('fe');
    await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true), { timeout: 2000 });
  });

  describe('resolved output path hint', () => {
    it('shows where each output dir resolves to, following the typed value', async () => {
      routes['GET /api/info'] = () => ({ json: { cwd: '/Users/me/project' } });
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByLabelText('Also create Go routes'));
      await user.type(screen.getByLabelText('Frontend output dir'), 'src/api');
      await user.type(screen.getByLabelText('Backend output dir'), '/abs/routers');
      expect(await screen.findByText('/Users/me/project/src/api')).toBeInTheDocument();
      expect(screen.getByText('/abs/routers')).toBeInTheDocument();
      await user.clear(screen.getByLabelText('Frontend output dir'));
      await user.type(screen.getByLabelText('Frontend output dir'), '../elsewhere');
      expect(await screen.findByText('/Users/me/elsewhere')).toBeInTheDocument();
    });

    it('warns that ~ is not expanded', async () => {
      routes['GET /api/info'] = () => ({ json: { cwd: '/Users/me/project' } });
      const user = userEvent.setup();
      render(<App />);
      await user.type(screen.getByLabelText('Frontend output dir'), '~/out');
      expect(await screen.findByText(/'~' is not expanded/)).toBeInTheDocument();
    });

    it('shows nothing (and no error) when the server does not report a working directory', async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.type(screen.getByLabelText('Frontend output dir'), 'src/api');
      await waitFor(() => expect(calls.some(c => c.url === '/api/info')).toBe(true));
      expect(screen.queryByText(/→/)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('groups', () => {
    const groupOf = (body: any, id: string) => body.endpoints.find((e: any) => e.id === id).group;

    it('lets the user type a group per endpoint; the preview gets the normalised value', async () => {
      const user = await load();
      await waitPreview(1);
      const n = previews().length;
      const input = screen.getByLabelText('Group of GET /pets');
      expect(input).toHaveValue('pets');
      await user.clear(input);
      await user.type(input, '  My   api ');
      await waitPreview(n + 1);
      expect(groupOf(lastPreview(), 'e1')).toBe('My api');
      expect(groupOf(lastPreview(), 'e2')).toBe('pets');
    });

    it('merges groups that differ only in case so they do not become two files', async () => {
      const user = await load();
      await waitPreview(1);
      const n = previews().length;
      const input = screen.getByLabelText('Group of POST /pets');
      await user.clear(input);
      await user.type(input, 'PETS');
      await waitPreview(n + 1);
      expect(groupOf(lastPreview(), 'e1')).toBe('pets');
      expect(groupOf(lastPreview(), 'e2')).toBe('pets');
    });

    it('blocks the preview and writing while an enabled endpoint has an empty group', async () => {
      const user = await load();
      await waitPreview(1);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Write…' })).toBeDisabled(), { timeout: 100 }).catch(() => {});
      await user.type(screen.getByLabelText('Frontend output dir'), 'src/api');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Write…' })).toBeEnabled(), { timeout: 2000 });
      const n = previews().length;
      await user.clear(screen.getByLabelText('Group of GET /pets'));
      expect(screen.getAllByText('Group is required')).toHaveLength(1);
      expect(screen.getByText('Every enabled endpoint needs a group.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Write…' })).toBeDisabled();
      await new Promise(r => setTimeout(r, 600));
      expect(previews().length).toBe(n);
    });

    it('suggests the existing groups', async () => {
      await load();
      const options = [...document.querySelectorAll('datalist#group-options option')].map(o => o.getAttribute('value'));
      expect(options).toEqual(['pets']);
    });

    it('moves only the endpoints currently shown by the filter to a typed group', async () => {
      const user = await load();
      await waitPreview(1);
      const n = previews().length;
      await user.type(screen.getByLabelText('Filter endpoints'), 'createPet');
      const apply = screen.getByRole('button', { name: 'Apply group' });
      expect(apply).toBeDisabled();
      await user.type(screen.getByLabelText('Move shown endpoints to group'), 'orders');
      expect(apply).toBeEnabled();
      await user.click(apply);
      await user.clear(screen.getByLabelText('Filter endpoints'));
      await waitPreview(n + 1);
      expect(groupOf(lastPreview(), 'e2')).toBe('orders');
      expect(groupOf(lastPreview(), 'e1')).toBe('pets');
    });
  });

  describe('preview colouring', () => {
    it('colours the previewed file while keeping its text intact, and switches language per file', async () => {
      const user = await load();
      await waitPreview(1);
      const panel = await screen.findByRole('tabpanel');
      expect(panel.textContent).toContain('export const a = 1;');
      expect(panel.querySelector('.tok-keyword')?.textContent).toBe('export');
      expect(panel.querySelector('.tok-number')?.textContent).toBe('1');
      await user.click(screen.getByRole('tab', { name: 'pets.go' }));
      const goPanel = screen.getByRole('tabpanel');
      expect([...goPanel.querySelectorAll('.tok-keyword')].map(n => n.textContent)).toEqual(['package', 'func']);
      expect(goPanel.querySelector('pre')?.textContent).toBe(GO.content);
    });

    it('renders spec-derived markup as text, never as HTML', async () => {
      routes['POST /api/preview'] = () => ({ json: { files: [{ path: 'x.ts', content: 'const a = "<img src=x onerror=alert(1)>";', kind: 'frontend' }] } });
      await load();
      const panel = await screen.findByRole('tabpanel');
      expect(panel.querySelector('img')).toBeNull();
      expect(panel.textContent).toContain('<img src=x onerror=alert(1)>');
    });
  });
});
