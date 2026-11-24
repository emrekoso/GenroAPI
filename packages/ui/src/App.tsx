import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Endpoint, GenOptions, GeneratedFile } from '@genroapi/core';
import * as api from './api';
import { SpecForm, prefixValid } from './components/SpecForm';
import { EndpointTable, nameErrors } from './components/EndpointTable';
import { OptionsPanel, goOptionProblems } from './components/OptionsPanel';
import { PreviewTabs } from './components/PreviewTabs';
import { WriteDialog } from './components/WriteDialog';

const DEFAULT_OPTIONS: GenOptions = {
  servicePrefix: '', query: false, zod: false, zustand: false, backend: 'none',
  go: { package: 'routers', teaImport: 'teadash/functions/Tea' },
};
const PREVIEW_DELAY = 300;
const SAVE_DELAY = 500;

export default function App() {
  const [url, setUrl] = useState('');
  const [prefix, setPrefix] = useState('');
  const [opts, setOpts] = useState<Omit<GenOptions, 'servicePrefix'>>(DEFAULT_OPTIONS);
  const [outDirs, setOutDirs] = useState<api.OutDirs>({ frontend: '', backend: '' });
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [components, setComponents] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  // The exact inputs (by identity) the displayed files were generated from.
  const [shown, setShown] = useState<{ e: Endpoint[]; o: GenOptions; c: unknown } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState<GeneratedFile[] | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [cwd, setCwd] = useState<string | undefined>(undefined);

  const options: GenOptions = useMemo(() => ({ ...opts, servicePrefix: prefix }), [opts, prefix]);
  const errors = useMemo(() => nameErrors(endpoints), [endpoints]);
  const go = options.backend === 'go';
  const nameBlocked = Object.keys(errors).length > 0;
  const goProblems = goOptionProblems(options);
  const settingsBlocked = !prefixValid(prefix, go) || Object.keys(goProblems).length > 0;
  const blocked = nameBlocked || settingsBlocked;
  const blocker = nameBlocked ? 'Fix the endpoint name errors to refresh the preview.' : settingsBlocked ? 'Fix the highlighted settings to refresh the preview.' : null;
  const showError = useCallback((m: string) => setError(m), []);

  // Load persisted config once; failures are silent.
  useEffect(() => {
    let alive = true;
    api.getConfig().then(c => {
      if (!alive || !c || typeof c !== 'object') return;
      if (typeof c.url === 'string') setUrl(c.url);
      if (typeof c.prefix === 'string') setPrefix(c.prefix);
      if (c.options && typeof c.options === 'object') {
        const { servicePrefix: _ignored, ...o } = c.options;
        setOpts(p => ({ ...p, ...o, go: { ...p.go, ...(o.go ?? {}) } }));
      }
      if (c.outDirs && typeof c.outDirs === 'object') setOutDirs(p => ({ ...p, ...c.outDirs }));
    }).catch(() => {}).finally(() => { if (alive) setConfigReady(true); });
    return () => { alive = false; };
  }, []);

  // Where relative output dirs resolve to; purely informational, so failures are silent.
  useEffect(() => {
    let alive = true;
    api.getInfo().then(i => { if (alive && typeof i?.cwd === 'string') setCwd(i.cwd); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Debounced config save.
  useEffect(() => {
    if (!configReady) return;
    const t = setTimeout(() => { api.putConfig({ url, prefix, options: opts, outDirs }).catch(() => {}); }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [configReady, url, prefix, opts, outDirs]);

  // Debounced preview.
  const loaded = endpoints.length > 0;
  useEffect(() => {
    if (!loaded || blocked) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setPreviewing(true);
      api.preview(endpoints, options, components, ctl.signal)
        .then(r => { setFiles(r.files); setShown({ e: endpoints, o: options, c: components }); setPreviewing(false); })
        .catch(e => { if (ctl.signal.aborted) return; setPreviewing(false); setError(e.message); });
    }, PREVIEW_DELAY);
    return () => { clearTimeout(t); ctl.abort(); setPreviewing(false); };
  }, [loaded, blocked, endpoints, options, components]);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.loadSpec(url.trim());
      setEndpoints(s.endpoints);
      setComponents(s.components ?? {});
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const patch = (id: string, p: Partial<Endpoint>) => setEndpoints(es => es.map(e => (e.id === id ? { ...e, ...p } : e)));
  const enableAll = (ids: string[], enabled: boolean) => { const s = new Set(ids); setEndpoints(es => es.map(e => (s.has(e.id) ? { ...e, enabled } : e))); };

  const dirs: api.OutDirs = go ? { frontend: outDirs.frontend.trim(), backend: (outDirs.backend ?? '').trim() } : { frontend: outDirs.frontend.trim() };
  const dirsValid = dirs.frontend !== '' && (!go || !!dirs.backend);
  // Out of date as soon as any input changes (identity comparison, so no render ever sees stale files as current).
  const stale = !shown || shown.e !== endpoints || shown.o !== options || shown.c !== components;
  const canWrite = dirsValid && files.length > 0 && !blocked && !stale && !previewing;

  const dirsKey = JSON.stringify(dirs);
  const stableDirs = useMemo(() => JSON.parse(dirsKey) as api.OutDirs, [dirsKey]);

  return (
    <main>
      <header><h1>GenroAPI</h1><p className="help">Swagger to TypeScript client and Go proxy generator</p></header>
      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <SpecForm url={url} prefix={prefix} loading={loading} prefixRequired={go} onUrl={setUrl} onPrefix={setPrefix} onLoad={load} />
      <OptionsPanel options={options} outDirs={outDirs} cwd={cwd}
        onOptions={o => { const { servicePrefix: _p, ...rest } = o; setOpts(rest); }} onOutDirs={setOutDirs} />
      {loaded && <>
        <EndpointTable endpoints={endpoints} showGo={go} errors={errors} onChange={patch} onEnableAll={enableAll} />
        <PreviewTabs files={files} loading={previewing} blocker={blocker} stale={stale} />
        <div className="row end">
          <button type="button" className="primary" disabled={!canWrite} onClick={() => setWriting(files)}>Write…</button>
        </div>
      </>}
      {writing && <WriteDialog files={writing} outDirs={stableDirs} goPackage={options.go.package} onClose={() => setWriting(null)} onError={showError} />}
    </main>
  );
}
