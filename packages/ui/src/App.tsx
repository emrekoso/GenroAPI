import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Endpoint, GenOptions, GeneratedFile } from '@genroapi/core';
import * as api from './api';
import { SpecForm, prefixValid, type InputMode } from './components/SpecForm';
import { nameErrors } from './components/EndpointTable';
import { Board } from './components/Board';
import { SaveBar } from './components/SaveBar';
import { groupModel } from './groupViz';
import { groupErrors as findGroupErrors, normalizeGroups } from './groups';
import { OptionsPanel, goOptionProblems } from './components/OptionsPanel';
import { PreviewTabs } from './components/PreviewTabs';
import { WriteDialog } from './components/WriteDialog';

const DEFAULT_OPTIONS: GenOptions = {
  servicePrefix: '', query: false, zod: false, zustand: false, backend: 'none',
  go: { package: 'routers', teaImport: 'teadash/functions/Tea' },
};
const PREVIEW_DELAY = 300;
const SAVE_DELAY = 500;

/** Smoothly scroll an element into view once React has painted; instant when the user prefers reduced motion. */
function scrollToId(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }));
}

export default function App() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<InputMode>('url');
  const [specText, setSpecText] = useState('');
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
  const [focus, setFocus] = useState<{ prefix: string; n: number } | null>(null);

  const options: GenOptions = useMemo(() => ({ ...opts, servicePrefix: prefix }), [opts, prefix]);
  const model = useMemo(() => groupModel(endpoints, options), [endpoints, options]);
  const errors = useMemo(() => nameErrors(endpoints), [endpoints]);
  const go = options.backend === 'go';
  const groupErrs = useMemo(() => findGroupErrors(endpoints), [endpoints]);
  const nameBlocked = Object.keys(errors).length > 0;
  const groupBlocked = Object.keys(groupErrs).length > 0;
  const goProblems = goOptionProblems(options);
  const settingsBlocked = !prefixValid(prefix, go) || Object.keys(goProblems).length > 0;
  const blocked = nameBlocked || groupBlocked || settingsBlocked;
  const blocker = nameBlocked ? 'Fix the endpoint name errors to refresh the preview.' : groupBlocked ? 'Every enabled endpoint needs a group.' : settingsBlocked ? 'Fix the highlighted settings to refresh the preview.' : null;
  const showError = useCallback((m: string) => setError(m), []);

  // Load persisted config once; failures are silent.
  useEffect(() => {
    let alive = true;
    api.getConfig().then(c => {
      if (!alive || !c || typeof c !== 'object') return;
      if (typeof c.url === 'string') setUrl(c.url);
      if (c.inputMode === 'url' || c.inputMode === 'text') setMode(c.inputMode);
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
    const t = setTimeout(() => { api.putConfig({ url, inputMode: mode, prefix, options: opts, outDirs }).catch(() => {}); }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [configReady, url, mode, prefix, opts, outDirs]);

  // Debounced preview.
  const loaded = endpoints.length > 0;
  useEffect(() => {
    if (!loaded || blocked) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setPreviewing(true);
      api.preview(normalizeGroups(endpoints), options, components, ctl.signal)
        .then(r => { setFiles(r.files); setShown({ e: endpoints, o: options, c: components }); setPreviewing(false); })
        .catch(e => { if (ctl.signal.aborted) return; setPreviewing(false); setError(e.message); });
    }, PREVIEW_DELAY);
    return () => { clearTimeout(t); ctl.abort(); setPreviewing(false); };
  }, [loaded, blocked, endpoints, options, components]);

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.loadSpec(mode === 'url' ? { url: url.trim() } : { text: specText });
      setEndpoints(s.endpoints);
      setComponents(s.components ?? {});
      setError(null);
      // Hand the user to the choices that come next, instead of leaving them at the top of the page.
      scrollToId('s1');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const patch = (id: string, p: Partial<Endpoint>) => setEndpoints(es => es.map(e => (e.id === id ? { ...e, ...p } : e)));
  const groupAll = (ids: string[], group: string) => { const s = new Set(ids); setEndpoints(es => es.map(e => (s.has(e.id) ? { ...e, group } : e))); };
  const enableAll = (ids: string[], enabled: boolean) => { const s = new Set(ids); setEndpoints(es => es.map(e => (s.has(e.id) ? { ...e, enabled } : e))); };

  const dirs: api.OutDirs = go ? { frontend: outDirs.frontend.trim(), backend: (outDirs.backend ?? '').trim() } : { frontend: outDirs.frontend.trim() };
  const dirsValid = dirs.frontend !== '' && (!go || !!dirs.backend);
  // Out of date as soon as any input changes (identity comparison, so no render ever sees stale files as current).
  const stale = !shown || shown.e !== endpoints || shown.o !== options || shown.c !== components;
  const canWrite = dirsValid && files.length > 0 && !blocked && !stale && !previewing;

  const dirsKey = JSON.stringify(dirs);
  const stableDirs = useMemo(() => JSON.parse(dirsKey) as api.OutDirs, [dirsKey]);

  const step = (n: number, id: string, title: string, lead: string) => (
    <div className="step-head"><span className="n" aria-hidden="true">{n}</span><h2 id={id}>{title}</h2><p>{lead}</p></div>
  );

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="7" cy="9" r="5" fill="var(--g1)" /><circle cx="7" cy="25" r="5" fill="var(--g4)" /><circle cx="27" cy="17" r="6" fill="var(--g2)" /><path d="M11 10 C 19 10, 19 17, 22 17 M11 24 C 19 24, 19 17, 22 17" stroke="var(--ink)" strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
          <span className="brand-name">GenroAPI</span>
        </div>
        <div className="local"><i />Runs on your computer. Your files stay there.</div>
      </header>
      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn ghost" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <SpecForm mode={mode} text={specText} onMode={setMode} onText={setSpecText} onError={showError} url={url} prefix={prefix} loading={loading} prefixRequired={go} onUrl={setUrl} onPrefix={setPrefix} onLoad={load} />
      <section className="step" aria-labelledby="s1">
        {step(1, 's1', 'Choose what else to generate', 'You always get data shapes and the functions that call your API. Switch on extras only if your project uses them.')}
        <OptionsPanel options={options} onOptions={o => { const { servicePrefix: _p, ...rest } = o; setOpts(rest); }} />
      </section>
      <section className="step" aria-labelledby="s2">
        {step(2, 's2', 'Pick endpoints and sort them into groups', 'Each endpoint is one thing your server can do. Tick the ones you need. A colour is a group, and each group becomes its own set of files. Change an endpoint\'s group and its wire moves.')}
        {loaded
          ? <Board endpoints={endpoints} model={model} showGo={go} errors={errors} groupErrors={groupErrs} selectedPrefix={focus?.prefix ?? null}
              onSelectFile={prefix => { setFocus(f => ({ prefix, n: (f?.n ?? 0) + 1 })); scrollToId('preview'); }} onChange={patch} onEnableAll={enableAll} onGroupAll={groupAll} />
          : <div className="empty">Load a spec above. Its endpoints appear here, wired to the files they become.</div>}
      </section>
      <section className="step" aria-labelledby="s3">
        {step(3, 's3', 'Read the result, then save it', 'This is exactly what will be written. It updates as you change anything above. Choose a group on the right to jump to its files.')}
        {loaded
          ? <PreviewTabs files={files} loading={previewing} blocker={blocker} stale={stale} colourOf={model.colourOfPath} focus={focus} />
          : <div className="empty">The generated code appears here, ready to read before anything is saved.</div>}
        <SaveBar go={go} outDirs={outDirs} cwd={cwd} canWrite={canWrite} fileCount={files.length} onOutDirs={setOutDirs} onWrite={() => setWriting(files)} />
      </section>
      {writing && <WriteDialog files={writing} outDirs={stableDirs} goPackage={options.go.package} onClose={() => setWriting(null)} onError={showError} />}
      <footer>GenroAPI writes only files named *.gen.ts and *.gen.go, and only where you tell it to.</footer>
    </main>
  );
}
